// Discovery alert triggers — generates internal alert records from watchlist transitions + snapshots.
// Runtime file (discovery-alerts.json) is gitignored under src/data/; never committed.
// No Telegram or external notifications here — pure data records for future consumption.
//
// Key invariants:
//  - WATCH_TO_BUY_CANDIDATE requires pricingDataAvailable===true (mirrors BUY_CANDIDATE safety rule).
//  - PRICING_UNLOCKED fires only when transition was FROM WATCH_PRICING_BLOCKED.
//  - SHARP_DRAWDOWN_QUALITY is defined but never fired until P3-3g provides dataQualityScore.
//  - Dedupe: same-day key, cooldown window (per-type), and maxPerWeek count — all three enforced.
//  - Alert generation / write failures must not crash the engine — callers must wrap in try/catch.

import { readJsonFile, writeJsonFile } from '../utils/file-store';
import { readDiscoverySnapshots } from './snapshots';
import { readWatchlist, WATCHLIST_STALE_AFTER_RUNS } from './watchlist';
import type {
  DiscoveryAlert,
  DiscoveryAlertType,
  DiscoveryAlertsFile,
  DiscoverySnapshot,
  Opportunity,
  WatchlistEntry,
  WatchlistTransition,
} from '../types';

const DISCOVERY_ALERTS_FILENAME = 'discovery-alerts.json';
const DEFAULT_MAX_AGE_DAYS = 30;

export const SCORE_ALERT_THRESHOLD = 6.5;
export const DRAWDOWN_SWEET_SPOT_MIN = 15;
export const DRAWDOWN_SWEET_SPOT_MAX = 25;
export const PERSISTENT_CANDIDATE_MIN_RUNS = 5;

type AlertCooldownConfig = {
  cooldownHours: number;
  maxPerWeek: number;
};

export const DISCOVERY_ALERT_COOLDOWNS: Record<DiscoveryAlertType, AlertCooldownConfig> = {
  WATCH_TO_BUY_CANDIDATE:  { cooldownHours: 24,  maxPerWeek: 3 },
  PRICING_UNLOCKED:        { cooldownHours: 48,  maxPerWeek: 1 },
  SCORE_CROSSED_THRESHOLD: { cooldownHours: 48,  maxPerWeek: 2 },
  DRAWDOWN_SWEET_SPOT:     { cooldownHours: 72,  maxPerWeek: 1 },
  QUALITY_GATES_PASSED:    { cooldownHours: 24,  maxPerWeek: 2 },
  PERSISTENT_CANDIDATE:    { cooldownHours: 168, maxPerWeek: 1 },
  SHARP_DRAWDOWN_QUALITY:  { cooldownHours: 24,  maxPerWeek: 2 },
  RANKING_TOP5_ENTRY:      { cooldownHours: 24,  maxPerWeek: 3 },
  PRICING_DEGRADED:        { cooldownHours: 168, maxPerWeek: 1 },
  STALE_CANDIDATE:         { cooldownHours: 720, maxPerWeek: 1 },
} as const;

function defaultAlertsFile(): DiscoveryAlertsFile {
  return {
    lastUpdatedAt: new Date(0).toISOString(),
    maxAgeDays: DEFAULT_MAX_AGE_DAYS,
    alerts: [],
  };
}

export function readDiscoveryAlerts(): DiscoveryAlertsFile {
  return readJsonFile<DiscoveryAlertsFile>(DISCOVERY_ALERTS_FILENAME, defaultAlertsFile());
}

export function writeDiscoveryAlerts(file: DiscoveryAlertsFile): void {
  writeJsonFile(DISCOVERY_ALERTS_FILENAME, file);
}

/**
 * Pure helper. Removes alerts whose createdAt is older than maxAgeDays from `now`.
 * `now` is injectable for deterministic testing.
 */
export function pruneDiscoveryAlerts(
  alerts: DiscoveryAlert[],
  maxAgeDays: number,
  now: Date = new Date(),
): DiscoveryAlert[] {
  const cutoffMs = now.getTime() - maxAgeDays * 24 * 60 * 60 * 1000;
  return alerts.filter((a) => new Date(a.createdAt).getTime() >= cutoffMs);
}

/**
 * Pure helper. Removes duplicate alerts by dedupeKey, keeping the first occurrence.
 * Useful for combining arrays that may overlap (e.g. after a retry or import).
 */
export function dedupeDiscoveryAlerts(alerts: DiscoveryAlert[]): DiscoveryAlert[] {
  const seen = new Set<string>();
  return alerts.filter((a) => {
    if (seen.has(a.dedupeKey)) return false;
    seen.add(a.dedupeKey);
    return true;
  });
}

/**
 * Pure helper. Returns true if a new alert of (ticker, type) at runId should be suppressed.
 *
 * Checks (in order):
 * 1. Same-day dedup: same dedupeKey already exists in existingAlerts.
 * 2. Active cooldown: any existing alert of the same ticker+type has a future cooldownUntil.
 * 3. maxPerWeek: count of same ticker+type in the past 7 days reached the configured limit.
 */
export function isAlertSuppressed(
  ticker: string,
  type: DiscoveryAlertType,
  runId: string,
  existingAlerts: DiscoveryAlert[],
): boolean {
  const runDate = runId.slice(0, 10); // YYYY-MM-DD
  const dedupeKey = `${ticker}__${type}__${runDate}`;
  const config = DISCOVERY_ALERT_COOLDOWNS[type];
  const runTime = new Date(runId).getTime();

  if (existingAlerts.some((a) => a.dedupeKey === dedupeKey)) return true;

  const sameType = existingAlerts.filter((a) => a.ticker === ticker && a.type === type);

  if (sameType.some((a) => a.cooldownUntil != null && new Date(a.cooldownUntil).getTime() > runTime)) {
    return true;
  }

  const weekAgo = runTime - 7 * 24 * 60 * 60 * 1000;
  const thisWeekCount = sameType.filter((a) => new Date(a.createdAt).getTime() >= weekAgo).length;
  if (thisWeekCount >= config.maxPerWeek) return true;

  return false;
}

/**
 * Pure helper. Returns the most-recent snapshot per ticker from all runs BEFORE currentRunId.
 * Snapshots are stored oldest-first; iterating forward means the last write per ticker wins.
 */
export function buildPreviousSnapshotByTicker(
  snapshots: DiscoverySnapshot[],
  currentRunId: string,
): Record<string, DiscoverySnapshot> {
  const result: Record<string, DiscoverySnapshot> = {};
  for (const snap of snapshots) {
    if (snap.runId !== currentRunId) {
      result[snap.ticker] = snap;
    }
  }
  return result;
}

/**
 * Pure function. Generates discovery alert records from transitions + current state.
 *
 * Trigger rules:
 *  HIGH severity
 *  - WATCH_TO_BUY_CANDIDATE : transition.to===BUY_CANDIDATE && pricingDataAvailable===true
 *  - PRICING_UNLOCKED       : transition.from===WATCH_PRICING_BLOCKED && pricingDataAvailable===true
 *  MEDIUM severity
 *  - SCORE_CROSSED_THRESHOLD: previousScore < 6.5 AND currentScore >= 6.5
 *  - DRAWDOWN_SWEET_SPOT    : drawdown90d enters 15–25% range (was outside)
 *  - QUALITY_GATES_PASSED   : all gates pass now, at least one failed before
 *  - PERSISTENT_CANDIDATE   : consecutiveRunsSeen >= 5 AND score >= 6.5 (weekly cooldown)
 *  LOW severity
 *  - RANKING_TOP5_ENTRY     : firstSeenAt === runId (new entry this run)
 *  - PRICING_DEGRADED       : transition.to===WATCH_PRICING_BLOCKED from non-blocked state
 *  - STALE_CANDIDATE        : transition.to===STALE
 *  RESERVED (not fired until P3-3g)
 *  - SHARP_DRAWDOWN_QUALITY : requires dataQualityScore >= 9 (always null until P3-3g)
 *
 * Dedupe is applied against existingAlerts (same-day, cooldown, maxPerWeek).
 * Within-run dedup prevents multiple same-key alerts from the same run.
 *
 * @param transitions            Watchlist transitions from this engine run.
 * @param currentEntries         Watchlist entries after this run's update.
 * @param currentOpportunities   Discovered opportunities from this engine run.
 * @param previousSnapshotByTicker Most-recent snapshot per ticker from prior runs.
 * @param existingAlerts         Alerts already stored (for dedupe/cooldown checks).
 * @param runId                  ISO timestamp of this engine run.
 */
export function generateDiscoveryAlerts(
  transitions: WatchlistTransition[],
  currentEntries: WatchlistEntry[],
  currentOpportunities: Opportunity[],
  previousSnapshotByTicker: Record<string, DiscoverySnapshot>,
  existingAlerts: DiscoveryAlert[],
  runId: string,
): DiscoveryAlert[] {
  const generated: DiscoveryAlert[] = [];
  const pendingKeys = new Set<string>();

  function tryAdd(candidate: Omit<DiscoveryAlert, 'id' | 'dedupeKey' | 'cooldownUntil'>): void {
    const runDate = runId.slice(0, 10);
    const dedupeKey = `${candidate.ticker}__${candidate.type}__${runDate}`;

    if (pendingKeys.has(dedupeKey)) return;
    if (isAlertSuppressed(candidate.ticker, candidate.type, runId, existingAlerts)) return;

    const cooldownMs = DISCOVERY_ALERT_COOLDOWNS[candidate.type].cooldownHours * 60 * 60 * 1000;
    const cooldownUntil = new Date(new Date(runId).getTime() + cooldownMs).toISOString();

    pendingKeys.add(dedupeKey);
    generated.push({
      ...candidate,
      id: `${candidate.ticker}_${candidate.type}_${runId}`,
      dedupeKey,
      cooldownUntil,
    });
  }

  const entryByTicker = new Map(currentEntries.map((e) => [e.ticker, e]));
  const oppByTicker = new Map(currentOpportunities.map((o) => [o.ticker, o]));

  // --- Transition-based triggers ---
  for (const transition of transitions) {
    const entry = entryByTicker.get(transition.ticker);
    const opp = oppByTicker.get(transition.ticker);
    const prevSnap = previousSnapshotByTicker[transition.ticker] ?? null;

    // WATCH_TO_BUY_CANDIDATE — mirrors BUY_CANDIDATE safety: pricingDataAvailable required
    if (transition.to === 'BUY_CANDIDATE' && transition.from !== 'BUY_CANDIDATE') {
      if (opp?.pricingDataAvailable === true) {
        tryAdd({
          ticker: transition.ticker,
          name: entry?.name ?? transition.ticker,
          type: 'WATCH_TO_BUY_CANDIDATE',
          severity: 'high',
          createdAt: runId,
          runId,
          title: `${transition.ticker} became a buy candidate`,
          message: `${entry?.name ?? transition.ticker} is now actionable with EUR-usable pricing: ${transition.reason}. Pricing: ${opp.pricingMethod ?? 'unknown'}. Score: ${opp.score.total.toFixed(1)}.`,
          fromState: transition.from,
          toState: 'BUY_CANDIDATE',
          score: opp.score.total,
          previousScore: prevSnap?.score.total ?? null,
          scoreDelta: prevSnap != null ? opp.score.total - prevSnap.score.total : null,
          pricingMethod: opp.pricingMethod,
          pricingDataAvailable: true,
          alertVersion: 1,
        });
      }
    }

    // PRICING_UNLOCKED — was blocked, now has EUR-usable price
    if (transition.from === 'WATCH_PRICING_BLOCKED' && transition.to !== 'WATCH_PRICING_BLOCKED') {
      if (opp?.pricingDataAvailable === true) {
        tryAdd({
          ticker: transition.ticker,
          name: entry?.name ?? transition.ticker,
          type: 'PRICING_UNLOCKED',
          severity: 'high',
          createdAt: runId,
          runId,
          title: `EUR pricing unlocked for ${transition.ticker}`,
          message: `${entry?.name ?? transition.ticker} now has EUR-usable pricing (${opp.pricingMethod ?? 'unknown'}). FX conversion is available — buy sizing calculations can now proceed.`,
          fromState: transition.from,
          toState: transition.to,
          score: opp.score.total,
          pricingMethod: opp.pricingMethod,
          previousPricingMethod: prevSnap?.pricingMethod,
          pricingDataAvailable: true,
          alertVersion: 1,
        });
      }
    }

    // PRICING_DEGRADED — just became WATCH_PRICING_BLOCKED from a non-blocked state
    if (
      transition.to === 'WATCH_PRICING_BLOCKED' &&
      transition.from !== null &&
      transition.from !== 'WATCH_PRICING_BLOCKED'
    ) {
      tryAdd({
        ticker: transition.ticker,
        name: entry?.name ?? transition.ticker,
        type: 'PRICING_DEGRADED',
        severity: 'low',
        createdAt: runId,
        runId,
        title: `EUR pricing unavailable for ${transition.ticker}`,
        message: `${entry?.name ?? transition.ticker} lost EUR-usable pricing (was ${transition.from}). BUY_CANDIDATE promotion is blocked until pricing is restored.`,
        fromState: transition.from,
        toState: 'WATCH_PRICING_BLOCKED',
        score: opp?.score.total,
        pricingMethod: opp?.pricingMethod,
        previousPricingMethod: prevSnap?.pricingMethod,
        pricingDataAvailable: false,
        alertVersion: 1,
      });
    }

    // STALE_CANDIDATE — absent from top 5 for too long
    if (transition.to === 'STALE') {
      tryAdd({
        ticker: transition.ticker,
        name: entry?.name ?? transition.ticker,
        type: 'STALE_CANDIDATE',
        severity: 'low',
        createdAt: runId,
        runId,
        title: `${transition.ticker} is no longer in top 5`,
        message: `${entry?.name ?? transition.ticker} has not appeared in discovery output for ${WATCHLIST_STALE_AFTER_RUNS} consecutive runs. It will be re-evaluated automatically if it re-enters the top 5.`,
        fromState: transition.from,
        toState: 'STALE',
        score: entry?.latestScore,
        pricingDataAvailable: entry?.latestPricingDataAvailable,
        alertVersion: 1,
      });
    }
  }

  // --- Opportunity-based triggers ---
  for (const opp of currentOpportunities) {
    const entry = entryByTicker.get(opp.ticker);
    const prevSnap = previousSnapshotByTicker[opp.ticker] ?? null;

    // RANKING_TOP5_ENTRY — first time this ticker appears in the watchlist (created this run)
    if (entry?.firstSeenAt === runId) {
      tryAdd({
        ticker: opp.ticker,
        name: opp.name,
        type: 'RANKING_TOP5_ENTRY',
        severity: 'low',
        createdAt: runId,
        runId,
        title: `${opp.ticker} entered discovery top 5`,
        message: `${opp.name} appeared in the discovery top 5 for the first time. Score: ${opp.score.total.toFixed(1)} (${opp.state}).`,
        toState: entry.watchlistState,
        score: opp.score.total,
        pricingMethod: opp.pricingMethod,
        pricingDataAvailable: opp.pricingDataAvailable,
        alertVersion: 1,
      });
    }

    // SCORE_CROSSED_THRESHOLD — previousScore < 6.5 and currentScore >= 6.5
    if (prevSnap !== null) {
      const prev = prevSnap.score.total;
      const curr = opp.score.total;
      if (prev < SCORE_ALERT_THRESHOLD && curr >= SCORE_ALERT_THRESHOLD) {
        tryAdd({
          ticker: opp.ticker,
          name: opp.name,
          type: 'SCORE_CROSSED_THRESHOLD',
          severity: 'medium',
          createdAt: runId,
          runId,
          title: `${opp.ticker} score crossed ${SCORE_ALERT_THRESHOLD}`,
          message: `${opp.name} score rose from ${prev.toFixed(1)} to ${curr.toFixed(1)}, crossing the ${SCORE_ALERT_THRESHOLD} alert threshold.`,
          toState: entry?.watchlistState,
          score: curr,
          previousScore: prev,
          scoreDelta: curr - prev,
          pricingMethod: opp.pricingMethod,
          pricingDataAvailable: opp.pricingDataAvailable,
          alertVersion: 1,
        });
      }
    }

    // DRAWDOWN_SWEET_SPOT — drawdown90d just entered the 15–25% buy-on-dip zone
    const currDd = opp.drawdown.drawdown90d;
    const prevDd = prevSnap?.drawdown90d ?? null;
    const inSweet = currDd >= DRAWDOWN_SWEET_SPOT_MIN && currDd <= DRAWDOWN_SWEET_SPOT_MAX;
    const wasInSweet = prevDd !== null && prevDd >= DRAWDOWN_SWEET_SPOT_MIN && prevDd <= DRAWDOWN_SWEET_SPOT_MAX;
    if (inSweet && !wasInSweet) {
      tryAdd({
        ticker: opp.ticker,
        name: opp.name,
        type: 'DRAWDOWN_SWEET_SPOT',
        severity: 'medium',
        createdAt: runId,
        runId,
        title: `${opp.ticker} in drawdown sweet spot (${currDd.toFixed(1)}%)`,
        message: `${opp.name} 90d drawdown is ${currDd.toFixed(1)}% — within the ${DRAWDOWN_SWEET_SPOT_MIN}–${DRAWDOWN_SWEET_SPOT_MAX}% buy-on-dip sweet spot.${prevDd !== null ? ` Previously ${prevDd.toFixed(1)}%.` : ''}`,
        toState: entry?.watchlistState,
        score: opp.score.total,
        pricingMethod: opp.pricingMethod,
        pricingDataAvailable: opp.pricingDataAvailable,
        alertVersion: 1,
      });
    }

    // QUALITY_GATES_PASSED — all gates pass now, at least one failed before
    if (prevSnap !== null) {
      const allPass = Object.values(opp.qualityGates).every(Boolean);
      const prevAllPass = Object.values(prevSnap.qualityGates).every(Boolean);
      if (allPass && !prevAllPass) {
        tryAdd({
          ticker: opp.ticker,
          name: opp.name,
          type: 'QUALITY_GATES_PASSED',
          severity: 'medium',
          createdAt: runId,
          runId,
          title: `${opp.ticker} passed all quality gates`,
          message: `${opp.name} now passes all quality gates (liquidity, quality, volatility, portfolioFit, riskReward, notSpeculative). Previously at least one was failing.`,
          toState: entry?.watchlistState,
          score: opp.score.total,
          pricingDataAvailable: opp.pricingDataAvailable,
          alertVersion: 1,
        });
      }
    }

    // PERSISTENT_CANDIDATE — present for 5+ consecutive runs with score >= 6.5
    if (
      entry !== undefined &&
      entry.consecutiveRunsSeen >= PERSISTENT_CANDIDATE_MIN_RUNS &&
      opp.score.total >= SCORE_ALERT_THRESHOLD
    ) {
      tryAdd({
        ticker: opp.ticker,
        name: opp.name,
        type: 'PERSISTENT_CANDIDATE',
        severity: 'low',
        createdAt: runId,
        runId,
        title: `${opp.ticker} persistent in top 5 (${entry.consecutiveRunsSeen} runs)`,
        message: `${opp.name} has appeared in discovery top 5 for ${entry.consecutiveRunsSeen} consecutive runs with score ${opp.score.total.toFixed(1)}.`,
        toState: entry.watchlistState,
        score: opp.score.total,
        pricingDataAvailable: opp.pricingDataAvailable,
        alertVersion: 1,
      });
    }

    // SHARP_DRAWDOWN_QUALITY — reserved for P3-3g.
    // Fires when: dataQualityScore >= 9 AND drawdown90d increased >= 5pp vs previous snapshot.
    // dataQualityScore is always null until P3-3g implements the model — not fired here.
  }

  return generated;
}

/**
 * Full persistence cycle for the engine:
 * reads existing alerts → reads snapshots (prior state) → reads watchlist (current entries) →
 * generates alerts → appends → prunes → writes.
 *
 * Callers must wrap in try/catch — any I/O error propagates unchanged.
 * If no new alerts are generated and the store is empty, skips the write.
 */
export function persistDiscoveryAlerts(
  opportunities: Opportunity[],
  transitions: WatchlistTransition[],
  runId: string,
): void {
  const alertsFile = readDiscoveryAlerts();
  const snapshotsFile = readDiscoverySnapshots();
  const watchlistFile = readWatchlist();

  const prevSnapshotByTicker = buildPreviousSnapshotByTicker(snapshotsFile.snapshots, runId);

  const newAlerts = generateDiscoveryAlerts(
    transitions,
    watchlistFile.entries,
    opportunities,
    prevSnapshotByTicker,
    alertsFile.alerts,
    runId,
  );

  if (newAlerts.length === 0 && alertsFile.alerts.length === 0) return;

  const combined = [...alertsFile.alerts, ...newAlerts];
  const pruned = pruneDiscoveryAlerts(combined, alertsFile.maxAgeDays);
  writeDiscoveryAlerts({ lastUpdatedAt: runId, maxAgeDays: alertsFile.maxAgeDays, alerts: pruned });
}
