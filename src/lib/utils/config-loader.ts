// Config file loader with validation
// Reads from config/ directory at project root

import fs from 'fs';
import path from 'path';
import type {
  PortfolioConfig,
  UniverseConfig,
  RulesConfig,
  ScoringConfig,
  AllocationConfig,
  OverridesConfig,
} from '../types';

const CONFIG_DIR = path.resolve(process.cwd(), 'config');

function loadConfig<T>(filename: string): T {
  const filePath = path.join(CONFIG_DIR, filename);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Config file not found: ${filePath}`);
  }
  const raw = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(raw) as T;
}

// Cached config instances (re-read on each engine run in dev, cached in prod)
let _portfolio: PortfolioConfig | null = null;
let _universe: UniverseConfig | null = null;
let _rules: RulesConfig | null = null;
let _scoring: ScoringConfig | null = null;
let _allocation: AllocationConfig | null = null;
let _overrides: OverridesConfig | null = null;

export function clearConfigCache(): void {
  _portfolio = null;
  _universe = null;
  _rules = null;
  _scoring = null;
  _allocation = null;
  _overrides = null;
}

export function getPortfolioConfig(): PortfolioConfig {
  if (!_portfolio) _portfolio = loadConfig<PortfolioConfig>('portfolio.json');
  return _portfolio;
}

export function getUniverseConfig(): UniverseConfig {
  if (!_universe) _universe = loadConfig<UniverseConfig>('universe.json');
  return _universe;
}

export function getRulesConfig(): RulesConfig {
  if (!_rules) _rules = loadConfig<RulesConfig>('rules.json');
  return _rules;
}

export function getScoringConfig(): ScoringConfig {
  if (!_scoring) _scoring = loadConfig<ScoringConfig>('scoring-weights.json');
  return _scoring;
}

export function getAllocationConfig(): AllocationConfig {
  if (!_allocation) _allocation = loadConfig<AllocationConfig>('allocation.json');
  return _allocation;
}

export function getOverridesConfig(): OverridesConfig {
  if (!_overrides) _overrides = loadConfig<OverridesConfig>('overrides.json');
  return _overrides;
}

/** Merge portfolio config with env var overrides */
export function getEffectivePortfolioConfig(): PortfolioConfig {
  const base = getPortfolioConfig();
  return {
    ...base,
    cashAvailableEur: process.env.CASH_AVAILABLE_EUR
      ? parseFloat(process.env.CASH_AVAILABLE_EUR)
      : base.cashAvailableEur,
    targetCashReserveEur: process.env.TARGET_CASH_RESERVE_EUR
      ? parseFloat(process.env.TARGET_CASH_RESERVE_EUR)
      : base.targetCashReserveEur,
  };
}

/** Apply manual overrides from overrides.json to individual holdings */
export function applyOverridesToPortfolio(portfolio: PortfolioConfig): PortfolioConfig {
  const overrides = getOverridesConfig();
  if (overrides.overrides.length === 0) return portfolio;

  const now = new Date();
  const holdings = portfolio.holdings.map((h) => {
    const override = overrides.overrides.find(
      (o) => o.assetId === h.id && (!o.expiresAt || new Date(o.expiresAt) > now)
    );
    if (!override) return h;
    return {
      ...h,
      noBuyOverride: override.type === 'no_buy' ? true : h.noBuyOverride,
      manualThesisRisk:
        override.type === 'thesis_risk' ? 'high' : h.manualThesisRisk,
    };
  });

  return { ...portfolio, holdings };
}
