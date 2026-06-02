// Discovery snapshot persistence — rolling JSON store for discovered opportunities.
// Runtime file (discovery-snapshots.json) is gitignored; never committed.
// All I/O is synchronous and non-fatal: callers must wrap in try/catch.

import { readJsonFile, writeJsonFile } from '../utils/file-store';
import type {
  DiscoverySnapshot,
  DiscoverySnapshotsFile,
  Opportunity,
  OpportunityState,
} from '../types';

const DISCOVERY_SNAPSHOTS_FILENAME = 'discovery-snapshots.json';
const DEFAULT_MAX_AGE_DAYS = 30;

function defaultSnapshotsFile(): DiscoverySnapshotsFile {
  return {
    lastUpdatedAt: new Date(0).toISOString(),
    maxAgeDays: DEFAULT_MAX_AGE_DAYS,
    snapshots: [],
  };
}

export function readDiscoverySnapshots(): DiscoverySnapshotsFile {
  return readJsonFile<DiscoverySnapshotsFile>(
    DISCOVERY_SNAPSHOTS_FILENAME,
    defaultSnapshotsFile(),
  );
}

export function writeDiscoverySnapshots(file: DiscoverySnapshotsFile): void {
  writeJsonFile(DISCOVERY_SNAPSHOTS_FILENAME, file);
}

/**
 * Pure helper. Removes snapshots whose runId timestamp is older than maxAgeDays from `now`.
 * `now` is injectable for deterministic testing.
 */
export function pruneSnapshotsByAge(
  snapshots: DiscoverySnapshot[],
  maxAgeDays: number,
  now: Date = new Date(),
): DiscoverySnapshot[] {
  const cutoffMs = now.getTime() - maxAgeDays * 24 * 60 * 60 * 1000;
  return snapshots.filter((s) => new Date(s.runId).getTime() >= cutoffMs);
}

/**
 * Pure helper. Maps each Opportunity to a DiscoverySnapshot for the given run.
 *
 * currentPrice null is preserved as null — never coerced to 0.
 * dataQualityScore is always null until P3-3g implements the scoring model.
 *
 * @param opportunities - Discovered opportunities for this run (typically top 5).
 * @param runId - ISO timestamp of the engine run; doubles as the time-series key.
 * @param previousByTicker - Most-recent known state per ticker, for previousState population.
 */
export function buildDiscoverySnapshotsFromOpportunities(
  opportunities: Opportunity[],
  runId: string,
  previousByTicker: Record<string, OpportunityState> = {},
): DiscoverySnapshot[] {
  return opportunities.map((opp): DiscoverySnapshot => ({
    runId,
    ticker: opp.ticker,
    name: opp.name,
    type: opp.type,
    score: opp.score,
    state: opp.state,
    previousState: previousByTicker[opp.ticker] ?? null,
    pricingMethod: opp.pricingMethod,
    pricingDataAvailable: opp.pricingDataAvailable,
    currentPrice: opp.currentPrice,
    drawdown30d: opp.drawdown.drawdown30d,
    drawdown60d: opp.drawdown.drawdown60d,
    drawdown90d: opp.drawdown.drawdown90d,
    qualityGates: { ...opp.qualityGates },
    reasons: [...opp.reasons],
    suggestedAmountEur: { ...opp.suggestedAmountEur },
    confidence: opp.confidence,
    dataQualityScore: null,
    visibility: 'surfaced_top5',
    snapshotVersion: 1,
  }));
}

/**
 * Resolves the most-recent state per ticker from existing snapshots.
 * Snapshots are stored oldest-first; iterating forward means the last write per
 * ticker wins, giving us the most-recent known state.
 */
function buildPreviousByTicker(
  existingSnapshots: DiscoverySnapshot[],
): Record<string, OpportunityState> {
  const result: Record<string, OpportunityState> = {};
  for (const snap of existingSnapshots) {
    result[snap.ticker] = snap.state;
  }
  return result;
}

/**
 * Full persistence cycle for the engine:
 * reads existing store → derives previousByTicker → builds snapshots → appends → prunes → writes.
 *
 * Callers must wrap in try/catch — any I/O error propagates unchanged.
 */
export function persistDiscoverySnapshots(
  opportunities: Opportunity[],
  runId: string,
): void {
  if (opportunities.length === 0) return;

  const existing = readDiscoverySnapshots();
  const previousByTicker = buildPreviousByTicker(existing.snapshots);
  const newSnapshots = buildDiscoverySnapshotsFromOpportunities(
    opportunities,
    runId,
    previousByTicker,
  );

  const combined = [...existing.snapshots, ...newSnapshots];
  const pruned = pruneSnapshotsByAge(combined, existing.maxAgeDays);

  writeDiscoverySnapshots({
    lastUpdatedAt: runId,
    maxAgeDays: existing.maxAgeDays,
    snapshots: pruned,
  });
}
