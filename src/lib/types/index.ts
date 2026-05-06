// ============================================================
// Core Type Definitions for App Finanzas
// All engine states, asset types, config shapes, and data models
// ============================================================

// --- Asset Types ---

export type AssetType = 'stock' | 'etf';

export type ConvictionScore = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;

export type ThesisRisk = 'none' | 'low' | 'medium' | 'high';

export type Confidence = 'low' | 'medium' | 'high';

// --- Decision States ---

/** States for existing portfolio holdings (CORE_PORTFOLIO_ENGINE) */
export type PortfolioState =
  | 'DO_NOTHING'
  | 'WAIT'
  | 'BUY_SMALL'
  | 'BUY_PARTIAL'
  | 'BUY_MORE'
  | 'REVIEW'
  | 'REDUCE';

/** States for external opportunity scanner (OPPORTUNITY_SCANNER) */
export type OpportunityState =
  | 'WATCH'
  | 'READY_TO_BUY'
  | 'BUY'
  | 'HOLD'
  | 'REVIEW_FOR_TRIM'
  | 'EXIT'
  | 'AVOID';

/** States for capital allocation (CAPITAL_ALLOCATOR) */
export type AllocationState =
  | 'BEST_USE_OF_CASH'
  | 'SECOND_BEST'
  | 'HOLD_CASH';

// --- Price Validation ---

/**
 * Who delivered the raw price data.
 * 'cache' = value served from in-memory / file cache within TTL
 * 'mock'  = test/development fixture
 * 'none'  = no provider was reached (all failed or quota exceeded)
 */
export type PriceProviderId = 'eodhd' | 'twelvedata' | 'yahoo' | 'cache' | 'mock' | 'none';

/**
 * What processing or conversion was applied to the raw price.
 * direct_eur_quote    — provider returned EUR natively (no conversion needed)
 * usd_converted       — USD price multiplied by EUR/USD rate; result is EUR-equivalent
 * usd_no_fx           — USD price available but no valid FX rate; P&L blocked
 * gbp_converted       — GBP price (pounds) multiplied by GBP/EUR rate
 * gbp_pence_converted — GBX or GBp (pence) divided by 100 then multiplied by GBP/EUR rate
 * proxy_drawdown_only — USD proxy for a EUR instrument; only drawdown % is valid
 * cached_last_valid   — stale cache value used after live fetch failed; may be outdated
 * unavailable         — no usable data from any source
 */
export type PriceMethod =
  | 'direct_eur_quote'
  | 'usd_converted'
  | 'usd_no_fx'
  | 'gbp_converted'
  | 'gbp_pence_converted'
  | 'proxy_drawdown_only'
  | 'cached_last_valid'
  | 'unavailable';

/**
 * How a price value will be used. Different purposes require different accuracy guarantees.
 * exact_pnl            — must be EUR-denominated and not a proxy
 * buy_recommendation   — must be in known currency for sizing math
 * drawdown             — percentage is currency-independent; proxies are allowed
 * display              — shown to user; best-effort, no hard currency requirement
 */
export type PricingPurpose = 'exact_pnl' | 'buy_recommendation' | 'drawdown' | 'display';

/**
 * Per-instrument audit object produced alongside each price fetch.
 * provider  — who delivered the raw data
 * method    — what conversion/processing was applied
 * Consumers use suitableFor* flags instead of re-deriving currency logic.
 */
export interface PriceValidation {
  symbol: string;
  provider: PriceProviderId;
  method: PriceMethod;
  fetchedCurrency: string | null;        // exact currency string returned by provider
  expectedCurrency: string | null;       // currency we expected from instrument config
  currencyConfirmed: boolean;            // fetchedCurrency matches expectedCurrency
  suitableForExactPnl: boolean;          // EUR-denominated result, not a proxy
  suitableForBuyRecommendation: boolean; // usable for EUR buy-size math
  suitableForDrawdown: boolean;          // drawdown % is valid (proxy allowed)
  isProxy: boolean;                      // USD proxy for a EUR instrument (e.g. QQQ→CNDX)
  note?: string;
}

// --- Price Data ---

export interface PriceData {
  symbol: string;
  currentPrice: number;
  currency: string;
  timestamp: Date;
  change1d?: number;        // percent change last day
  volume?: number;
  marketCap?: number;
}

export interface HistoricalPrice {
  date: string;             // ISO date string YYYY-MM-DD
  close: number;
  high: number;
  low: number;
  volume: number;
}

export interface HistoricalPrices {
  symbol: string;
  prices: HistoricalPrice[];
}

export interface RecentHighs {
  symbol: string;
  high30d: number;
  high60d: number;
  high90d: number;
  currentPrice: number;
  drawdown30d: number;      // percent, positive means below high
  drawdown60d: number;
  drawdown90d: number;
  validation?: PriceValidation; // populated by providers that support it; absent = legacy/unknown
}

// --- Portfolio Config (from config/portfolio.json) ---

export interface PortfolioHolding {
  id: string;               // unique identifier, e.g. "nvda" or "eqqq"
  name: string;             // human-readable name
  ticker?: string;          // trading ticker (e.g. "NVDA", "QQQ")
  isin: string;             // ISIN code
  type: AssetType;
  dcaMonthlyEur: number;    // monthly DCA amount in EUR (0 if none)
  avgPrice: number;         // average purchase price in original currency
  units?: number;           // number of units held (optional, for position sizing)
  core: boolean;            // true = core long-term holding
  convictionScore: ConvictionScore;
  tags: string[];           // e.g. ["semis", "AI", "growth"]
  noBuyOverride?: boolean;  // manual: temporarily block buys
  manualThesisRisk?: ThesisRisk;  // manual: escalate risk level
  maxWeightPercent?: number;      // max allowed portfolio weight %
  currency?: string;        // asset currency (USD, EUR) - defaults to USD
  targetPrice?: number;        // target sell price in asset currency (optional)
}

export interface ClosedPosition {
  isin: string;
  ticker?: string;
  name: string;
  realizedPnl: number;
}

export interface PortfolioConfig {
  holdings: PortfolioHolding[];
  cashAvailableEur: number;
  targetCashReserveEur: number;
  closedPositions?: ClosedPosition[];
  totalRealizedPnl?: number;
}

// --- Universe Config (from config/universe.json) ---

export interface UniverseAsset {
  ticker: string;
  name: string;
  type: AssetType;
  tags: string[];
  qualityScore: number;     // 1-10, used as base quality signal
  isSeed: boolean;          // true = priority seed, false = extended discovery
  isin?: string;
  currency?: string;
  region?: string;          // 'us' | 'eu' | 'global'
  minMarketCapBillions?: number;
}

export interface UniverseConfig {
  seedStocks: UniverseAsset[];
  seedEtfs: UniverseAsset[];
  extendedStocks: UniverseAsset[];
  extendedEtfs: UniverseAsset[];
  // Discovery quality gates (applied to extended universe only)
  discoveryGates: {
    minQualityScore: number;
    minDrawdownForAlert: number;   // minimum drawdown to surface
    maxDrawdownForAlert: number;   // avoid structural collapse above this
    minLiquidityScore: number;
    maxVolatilityPenalty: number;
  };
}

// --- Rules Config (from config/rules.json) ---

export interface DrawdownZone {
  minPct: number;
  maxPct: number;
  baseState: PortfolioState;
  highConvictionState?: PortfolioState;  // override for conviction >= 8
}

export interface ConcentrationLimits {
  maxSingleStockWeightPct: number;
  maxSingleEtfWeightPct: number;
  maxSectorWeightPct: number;
  maxThemeWeightPct: number;
  maxSemisWeightPct: number;
  maxAiWeightPct: number;
  maxTechWeightPct: number;
  highConcentrationPenaltyThreshold: number;  // above this, penalize scores
}

export interface RulesConfig {
  drawdownZones: DrawdownZone[];
  concentration: ConcentrationLimits;
  minDrawdownForOpportunity: number;
  maxDrawdownForBuy: number;
  trendBreakdownPenalty: number;
  relativeStrengthBonus: number;
  highConvictionThreshold: number;      // conviction >= this triggers high-conviction state
  dcaActiveBonus: number;               // bonus score when DCA is active
  etfDiversificationBonus: number;      // bonus score for ETFs reducing concentration
  maxDrawdownForBuyMore: number;        // above this, downgrade BUY_MORE
  reviewDrawdownThreshold: number;      // above this, force REVIEW
  thesisRiskAdjustment: Record<string, number>;
  marketRegimeAdjustment: {
    bullish: number;
    neutral: number;
    bearish: number;
  };
}

// --- Scoring Weights Config (from config/scoring-weights.json) ---

export interface ScoringWeights {
  assetQuality: number;         // 0-1 weight
  drawdownOpportunity: number;
  trendQuality: number;
  relativeStrength: number;
  diversificationFit: number;
  sectorFit: number;
  riskReward: number;
  portfolioFit: number;
  marketRegimeFit: number;
  // Total must = 1.0 (validated at load time)
}

export interface ScoringConfig {
  weights: ScoringWeights;
  stateThresholds: {
    avoid: number;
    watch: number;
    readyToBuy: number;
    buy: number;
    hold: number;
    reviewForTrim: number;
  };
  drawdownScoring: Record<string, number>;     // key: "0_5", "5_10", etc.
  discoveryScorePenalty: number;               // penalty for non-seed assets
}

// --- Allocation Config (from config/allocation.json) ---

export interface AllocationTier {
  state: PortfolioState | OpportunityState;
  minPctOfDeployable: number;   // min % of deployable cash
  maxPctOfDeployable: number;   // max % of deployable cash
}

export interface AllocationConfig {
  deployableAmounts: number[];
  tiers: AllocationTier[];
  etfConcentrationBonus: number;
  maxSingleTradeEur: number;
  minSingleTradeEur: number;
  concentrationPenaltyReduction: number;  // factor to reduce size when concentrated
  highConvictionMultiplier: number;        // size multiplier for conviction >= 9
}

// --- Manual Overrides (from config/overrides.json) ---

export interface ManualOverride {
  assetId: string;
  type: 'no_buy' | 'thesis_risk' | 'force_review' | 'skip_scanner';
  reason: string;
  expiresAt?: string;  // ISO date, optional expiry
}

export interface OverridesConfig {
  overrides: ManualOverride[];
  marketRegime: 'bullish' | 'neutral' | 'bearish';  // manual market regime flag
  globalNoBuy: boolean;  // if true, suppress all buy signals
}

// --- Engine Analysis Results ---

export interface DrawdownData {
  drawdown30d: number;
  drawdown60d: number;
  drawdown90d: number;
  maxDrawdown: number;   // highest of the three
  primaryWindow: '30d' | '60d' | '90d';
}

export interface ConcentrationData {
  totalPortfolioValue: number;
  sectorWeights: Record<string, number>;   // sector → % of portfolio
  themeWeights: Record<string, number>;    // theme → % of portfolio
  stockVsEtfRatio: { stocks: number; etfs: number };  // % each
  highConcentrationWarnings: string[];
}

export interface PortfolioAnalysis {
  holding: PortfolioHolding;
  currentPrice: number;
  avgPrice: number;
  unrealizedPnlPct: number;   // (current - avg) / avg * 100
  drawdown: DrawdownData;
  state: PortfolioState;
  suggestedAmountEur: { min: number; max: number };
  reasons: string[];
  concentrationPenalty: number;  // 0 = none, 1 = full penalty
  confidence: Confidence;
  priceError?: string;           // if price fetch failed
}

export interface OpportunityScore {
  total: number;              // 0-10
  breakdown: {
    assetQuality: number;
    drawdownOpportunity: number;
    trendQuality: number;
    relativeStrength: number;
    diversificationFit: number;
    sectorFit: number;
    riskReward: number;
    portfolioFit: number;
    marketRegimeFit: number;
  };
}

export interface Opportunity {
  ticker: string;
  name: string;
  type: AssetType;
  tags: string[];
  isin?: string;
  isSeedUniverse: boolean;         // false = found via extended discovery
  score: OpportunityScore;
  state: OpportunityState;
  currentPrice: number;
  currency: string;
  drawdown: DrawdownData;
  reasons: string[];
  suggestedAmountEur: { min: number; max: number };
  confidence: Confidence;
  qualityGates: {                  // for transparency on discovered assets
    liquidity: boolean;
    quality: boolean;
    volatility: boolean;
    portfolioFit: boolean;
    riskReward: boolean;
    notSpeculative: boolean;
  };
  priceError?: string;
}

export interface AllocationOption {
  rank: number;
  asset: string;
  assetName: string;
  type: AssetType;
  state: PortfolioState | OpportunityState;
  score: number;
  allocationState: AllocationState;
  isExistingHolding: boolean;
  amountEur: number;              // suggested amount for this tier
  percentOfDeployable: number;
  reason: string;
}

export interface AllocationRecommendation {
  forAmount: number;              // 500 | 1000 | 2000
  deployableAmount: number;       // cash available minus reserve
  options: AllocationOption[];    // ranked list, top = best
  holdCash: boolean;
  holdCashReason?: string;
  summary: string;
}

// --- Alert Types ---

export type AlertType =
  | 'portfolio_state_change'
  | 'new_opportunity'
  | 'etf_opportunity'
  | 'concentration_warning'
  | 'daily_digest'
  | 'tactical_review'
  | 'discovery'
  | 'cash_deployment_update';

export interface Alert {
  id: string;
  timestamp: string;             // ISO string
  type: AlertType;
  asset?: string;
  assetName?: string;
  assetType?: AssetType;
  oldState?: PortfolioState | OpportunityState;
  newState?: PortfolioState | OpportunityState | AllocationState;
  message: string;               // formatted Telegram message
  telegramSent: boolean;
  score?: number;
}

// --- Daily Engine Output ---

export interface DailyEngineOutput {
  runAt: string;                 // ISO timestamp
  marketRegime: 'bullish' | 'neutral' | 'bearish';
  eurUsdRate?: number;           // EUR/USD rate used for price conversion (e.g. 1.08)
  portfolioAnalyses: PortfolioAnalysis[];
  concentration: ConcentrationData;
  stockOpportunities: Opportunity[];
  etfOpportunities: Opportunity[];
  discoveredOpportunities: Opportunity[];
  allocationRecommendations: AllocationRecommendation[];
  alertsGenerated: Alert[];
  errors: string[];
  closedPositions?: ClosedPosition[];
  totalRealizedPnl?: number;
}

// --- Previous State Store (for change detection) ---

export interface PreviousStateEntry {
  assetId: string;
  state: PortfolioState | OpportunityState;
  score?: number;
  lastAlertAt?: string;
}

export interface PreviousStates {
  updatedAt: string;
  portfolio: Record<string, PreviousStateEntry>;
  opportunities: Record<string, PreviousStateEntry>;
}

// --- Alert History Store ---

export interface AlertHistoryStore {
  alerts: Alert[];
  lastDigestAt?: string;
}
