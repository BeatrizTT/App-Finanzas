// Discovery watchlist lifecycle — persistent state tracking for discovered opportunities.
// Runtime file (watchlist.json) is gitignored under src/data/; never committed.
//
// Key invariants:
//  - BUY_CANDIDATE requires pricingDataAvailable===true AND currentPrice!=null AND BUY/READY state.
//  - Terminal states (REJECTED, BOUGHT) are never auto-transitioned.
//  - pricingUnlockedAt and promotedToBuyAt are set once and never overwritten.
//  - STALE fires after WATCHLIST_STALE_AFTER_RUNS consecutive absent runs.
//  - "Absent" means not surfaced in the current discoveredOpportunities output (top 5 after scoring).
//    An asset may still be in the extended universe but ranked below the display threshold.
//
// Pure lifecycle functions (deriveWatchlistState, updateWatchlistFromDiscoveries) have
// no file I/O and are fully testable without the file-store.

import { readJsonFile, writeJsonFile } from '../utils/file-store';
import type {
  WatchlistEntry,
  WatchlistFile,
  WatchlistState,
  WatchlistTransition,
  Opportunity,
} from '../types';

export const WATCHLIST_FILENAME = 'watchlist.json';

// Number of consecutive discovery runs an asset must be absent before it is marked STALE.
export const WATCHLIST_STALE_AFTER_RUNS = 5;

function defaultWatchlistFile(): WatchlistFile {
  return {
    lastUpdatedAt: new Date(0).toISOString(),
    entries: [],
  };
}

export function readWatchlist(): WatchlistFile {
  return readJsonFile<WatchlistFile>(WATCHLIST_FILENAME, defaultWatchlistFile());
}

export function writeWatchlist(file: WatchlistFile): void {
  writeJsonFile(WATCHLIST_FILENAME, file);
}

/**
 * Pure function. Derives the WatchlistState for an opportunity given the existing entry (if any).
 *
 * Rules applied in order:
 * 1. REJECTED / BOUGHT are terminal — preserved unconditionally.
 * 2. BUY_CANDIDATE requires EUR-usable pricing (pricingDataAvailable===true AND currentPrice!=null)
 *    AND a buy-ready opportunity state (BUY or READY_TO_BUY).
 * 3. Without buy-safe pricing → WATCH_PRICING_BLOCKED (even if state is BUY).
 * 4. Buy-safe pricing + not yet buy-ready → WATCH_RESEARCH.
 */
export function deriveWatchlistState(
  opp: Opportunity,
  existing: WatchlistEntry | null,
): WatchlistState {
  if (existing !== null &&
    (existing.watchlistState === 'REJECTED' || existing.watchlistState === 'BOUGHT')) {
    return existing.watchlistState;
  }

  const pricingOk = opp.pricingDataAvailable === true && opp.currentPrice != null;
  const isBuyReady = opp.state === 'BUY' || opp.state === 'READY_TO_BUY';

  if (pricingOk && isBuyReady) return 'BUY_CANDIDATE';
  if (!pricingOk) return 'WATCH_PRICING_BLOCKED';
  return 'WATCH_RESEARCH';
}

function buildFirstDiscoveryReason(state: WatchlistState): string {
  if (state === 'BUY_CANDIDATE') return 'First discovery — immediately actionable with buy-safe pricing';
  if (state === 'WATCH_PRICING_BLOCKED') return 'First discovery — EUR-usable price not available';
  return 'First discovery — monitoring with EUR-usable price';
}

function buildTransitionReason(
  existing: WatchlistEntry,
  newState: WatchlistState,
): string {
  const prev = existing.watchlistState;

  if (newState === 'BUY_CANDIDATE') {
    if (prev === 'WATCH_PRICING_BLOCKED') return 'Pricing unlocked and opportunity reached buy-ready state';
    if (prev === 'STALE') return 'Reappeared with buy-safe pricing and buy-ready state';
    return 'Opportunity reached buy-ready state with buy-safe pricing';
  }

  if (newState === 'WATCH_RESEARCH') {
    if (prev === 'WATCH_PRICING_BLOCKED') return 'EUR-usable price now available';
    if (prev === 'STALE') return 'Reappeared with EUR-usable price available';
    if (prev === 'BUY_CANDIDATE') return 'Opportunity state dropped below buy-ready threshold';
    return `Transitioned to WATCH_RESEARCH from ${prev}`;
  }

  if (newState === 'WATCH_PRICING_BLOCKED') {
    if (prev === 'BUY_CANDIDATE' || prev === 'WATCH_RESEARCH') return 'EUR-usable price no longer available';
    if (prev === 'STALE') return 'Reappeared but EUR-usable price still unavailable';
    return `Pricing blocked (from ${prev})`;
  }

  return `Transitioned from ${prev} to ${newState}`;
}

function buildNewEntry(
  opp: Opportunity,
  state: WatchlistState,
  runId: string,
): WatchlistEntry {
  return {
    ticker: opp.ticker,
    name: opp.name,
    type: opp.type,
    watchlistState: state,
    firstSeenAt: runId,
    lastSeenAt: runId,
    lastUpdatedAt: runId,
    consecutiveRunsSeen: 1,
    consecutiveRunsAbsent: 0,
    highestScore: opp.score.total,
    latestScore: opp.score.total,
    latestOpportunityState: opp.state,
    latestPricingMethod: opp.pricingMethod,
    latestPricingDataAvailable: opp.pricingDataAvailable,
    pricingUnlockedAt: opp.pricingDataAvailable === true ? runId : null,
    promotedToBuyAt: state === 'BUY_CANDIDATE' ? runId : null,
    latestReasons: [...opp.reasons],
    latestConfidence: opp.confidence,
    dataQualityScore: null,
    watchlistVersion: 1,
  };
}

/**
 * Pure function. Processes all discovered opportunities against the current watchlist.
 *
 * Returns updated entries and a list of WatchlistTransitions for use by the future alert
 * engine (P3-3d). No alerts are sent here — transitions are pure data.
 *
 * @param currentOpportunities - The discoveredOpportunities from this engine run (top 5).
 * @param existingFile         - Current watchlist contents.
 * @param runId                - ISO timestamp of the engine run (used as the time-series key).
 * @param staleAfterRuns       - Consecutive absent runs before an entry becomes STALE.
 */
export function updateWatchlistFromDiscoveries(
  currentOpportunities: Opportunity[],
  existingFile: WatchlistFile,
  runId: string,
  staleAfterRuns: number = WATCHLIST_STALE_AFTER_RUNS,
): { entries: WatchlistEntry[]; transitions: WatchlistTransition[] } {
  const transitions: WatchlistTransition[] = [];
  const updatedEntries: WatchlistEntry[] = [];

  const currentTickers = new Set(currentOpportunities.map((o) => o.ticker));
  const existingByTicker = new Map(existingFile.entries.map((e) => [e.ticker, e]));

  // --- Opportunities surfaced this run ---
  for (const opp of currentOpportunities) {
    const existing = existingByTicker.get(opp.ticker) ?? null;
    const newState = deriveWatchlistState(opp, existing);
    const isTerminal = existing !== null &&
      (existing.watchlistState === 'REJECTED' || existing.watchlistState === 'BOUGHT');

    if (existing === null) {
      transitions.push({ ticker: opp.ticker, from: null, to: newState, reason: buildFirstDiscoveryReason(newState), occurredAt: runId });
      updatedEntries.push(buildNewEntry(opp, newState, runId));
    } else if (isTerminal) {
      // Terminal: watchlistState frozen; update observational metadata only
      updatedEntries.push({
        ...existing,
        lastSeenAt: runId,
        highestScore: Math.max(existing.highestScore, opp.score.total),
        latestScore: opp.score.total,
        latestOpportunityState: opp.state,
        latestPricingMethod: opp.pricingMethod,
        latestPricingDataAvailable: opp.pricingDataAvailable,
        latestReasons: [...opp.reasons],
        latestConfidence: opp.confidence,
      });
    } else {
      // Non-terminal existing entry
      const stateChanged = existing.watchlistState !== newState;
      if (stateChanged) {
        transitions.push({ ticker: opp.ticker, from: existing.watchlistState, to: newState, reason: buildTransitionReason(existing, newState), occurredAt: runId });
      }

      // pricingUnlockedAt / promotedToBuyAt: set once, never overwritten
      const pricingUnlockedAt = existing.pricingUnlockedAt
        ?? (opp.pricingDataAvailable === true ? runId : null);
      const promotedToBuyAt = existing.promotedToBuyAt
        ?? (newState === 'BUY_CANDIDATE' ? runId : null);

      updatedEntries.push({
        ...existing,
        watchlistState: newState,
        lastSeenAt: runId,
        lastUpdatedAt: stateChanged ? runId : existing.lastUpdatedAt,
        consecutiveRunsSeen: existing.consecutiveRunsSeen + 1,
        consecutiveRunsAbsent: 0,
        highestScore: Math.max(existing.highestScore, opp.score.total),
        latestScore: opp.score.total,
        latestOpportunityState: opp.state,
        latestPricingMethod: opp.pricingMethod,
        latestPricingDataAvailable: opp.pricingDataAvailable,
        pricingUnlockedAt,
        promotedToBuyAt,
        latestReasons: [...opp.reasons],
        latestConfidence: opp.confidence,
      });
    }
  }

  // --- Entries absent from this run ---
  for (const [ticker, existing] of existingByTicker) {
    if (currentTickers.has(ticker)) continue;

    const isTerminal = existing.watchlistState === 'REJECTED' || existing.watchlistState === 'BOUGHT';
    if (isTerminal) {
      updatedEntries.push(existing);
      continue;
    }

    const newAbsent = existing.consecutiveRunsAbsent + 1;
    // Only fire the STALE transition once (when state wasn't already STALE)
    const shouldGoStale = newAbsent >= staleAfterRuns && existing.watchlistState !== 'STALE';
    const newState: WatchlistState = shouldGoStale ? 'STALE' : existing.watchlistState;

    if (shouldGoStale) {
      transitions.push({
        ticker,
        from: existing.watchlistState,
        to: 'STALE',
        reason: `Not surfaced in discovery for ${newAbsent} consecutive runs (threshold: ${staleAfterRuns})`,
        occurredAt: runId,
      });
    }

    updatedEntries.push({
      ...existing,
      watchlistState: newState,
      consecutiveRunsAbsent: newAbsent,
      consecutiveRunsSeen: 0,
      lastUpdatedAt: shouldGoStale ? runId : existing.lastUpdatedAt,
    });
  }

  return { entries: updatedEntries, transitions };
}

/**
 * Full persistence cycle for the engine:
 * reads watchlist → updates from discoveries → writes → returns transitions.
 *
 * Callers must wrap in try/catch — any I/O error propagates unchanged.
 * Returns transitions so P3-3d can consume them without re-reading the store.
 */
export function persistWatchlist(
  opportunities: Opportunity[],
  runId: string,
): WatchlistTransition[] {
  const existing = readWatchlist();
  const { entries, transitions } = updateWatchlistFromDiscoveries(opportunities, existing, runId);
  writeWatchlist({ lastUpdatedAt: runId, entries });
  return transitions;
}
