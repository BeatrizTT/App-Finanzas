# Architecture Decisions — App Finanzas

Recorded decisions with reasoning. Update when a decision is revisited.

---

## Pricing

### Yahoo Finance2 as primary pricing source — REVISITED
**Original decision**: Use `yahoo-finance2` as the default and primary price provider.
**Reason at the time**: Zero cost, covers US + EU + ETF tickers, no API key needed.
**Revisited**: Yahoo Finance2 aggressively rate-limits requests from cloud/datacenter IPs (Vercel serverless functions). The `yahoo-provider.ts` file itself notes this risk: "Uses browser-like headers to avoid aggressive rate limiting on Vercel IPs." In practice, production moved to Twelve Data (`PRICE_PROVIDER=twelvedata`) because it works reliably from Vercel.
**Current rule**: Yahoo remains in code as a fallback option, but is **not recommended as the primary provider for Vercel-hosted deployments**. Use only if Twelve Data is unavailable and rate-limiting behavior has been re-evaluated.
**Revisit if**: Yahoo Finance API stabilizes its cloud IP policy, or is replaced by a stable official API.

### Twelve Data as production pricing provider
**Decision**: `PRICE_PROVIDER=twelvedata` in production. `TWELVE_DATA_API_KEY` configured in Vercel.
**Reason**: Works reliably from Vercel cloud IPs. Supports batch requests. Free tier: 800 req/day, 8 req/min — adequate for 2 cron runs/day over ~39 symbols.
**Activated**: May 5, 2026 (configured in Vercel env vars).
**Limitations**: Requires API key. Rate limit on free tier. Some EU ETF symbols require exchange suffix (mapped in `twelvedata-provider.ts` `SYMBOL_MAP`). For symbols not in the map, it falls through to direct symbol lookup.
**Revisit if**: Twelve Data free tier is exhausted, returns stale data, or a better provider with batch + cloud IP support becomes available.

### EODHD as optional secondary, not default
**Decision**: EODHD requires `EODHD_ENABLED=true` env var. Never activated by default.
**Reason**: EODHD has per-call costs (screener = 5 call units). Activating without testing risks budget overrun.
**Rule**: No symbol enters `eodhd-symbol-validation.json` as `validated_usd_needs_fx` without real EODHD smoke evidence.
**Status**: 10 symbols validated. `EODHD_ENABLED=true` and `EODHD_API_KEY` are configured in Vercel, but are **currently inactive** because `PRICE_PROVIDER=twelvedata` — EODHD is only instantiated when `PRICE_PROVIDER=eodhd` or `PRICE_PROVIDER=chain` with `eodhd` in chain. Screener not yet integrated.

### Provider chain: do not activate until batch is implemented
**Decision**: `PRICE_PROVIDER=chain` exists in code and `PRICE_PROVIDER_CHAIN` is configured in Vercel, but **do not activate chain yet**.
**Reason**: `ChainedPriceProvider` has no `batchGetRecentHighs` implementation (see comment in `chain-provider.ts`: "chain resolution is inherently sequential per symbol"). Activating chain for a ~39-symbol universe would serialize all price fetches, making each engine run significantly slower. Chain is architecturally correct but operationally unready.
**Activate when**: `batchGetRecentHighs` is implemented for the chain, or when a second provider is genuinely needed for fallback.

### Orphaned Vercel env vars (inert, do not remove yet)
The following env vars are configured in Vercel but **not read by any code** as of June 2026:
- `PRICE_REFRESH_MODE`
- `PRICE_CACHE_MODE`
- `REPORTING_CURRENCY`
They are inert (do not affect any code path). They may represent planned features or legacy config. Do not remove without confirming no code path reads them. Do not build code around them without a PR + decision.

### Pricing provider strategy — current state

| Provider | Production status | Strengths | Limitations | Decision |
|---|---|---|---|---|
| **Twelve Data** | ✓ Active (`PRICE_PROVIDER=twelvedata`) | Works from Vercel IPs, batch support, 800 req/day free tier, API key available | Free tier rate limit, needs API key, EU symbol mapping required | Keep as primary. Revisit if quota hit. |
| **Yahoo Finance** | Code present, not active in production | Free, no API key, covers US+EU+ETF | Aggressive rate limiting from cloud IPs, unofficial API, may break | Fallback option only. Not recommended for Vercel primary. |
| **EODHD** | Code present, env vars configured, **inactive** | Validated for 10 symbols, data quality good, screener capability | Per-call cost, screener = 5 units, requires smoke evidence per symbol | Optional secondary. Activate only after smoke + explicit PR decision. Never activate screener without evidence. |
| **FMP** | Not integrated | Large universe, screener, fundamentals | Free tier limitations unknown, requires smoke evidence | Phase 3 candidate for external screener. No PR without smoke artifact. |
| **Finnhub** | Not integrated | News, fundamentals, earnings | Requires smoke evidence, real-time pricing unproven | Phase 5 candidate for news/thesis explainer only. |
| **OpenAI / Claude** | Not integrated | Explanation synthesis, narrative generation | NOT a data source — never for pricing, scoring, BUY signals, or financial accuracy | Phase 5 candidate for summarizing news text only. Never as source of prices, P&L, or recommendations. |

### No raw USD prices displayed as EUR
**Decision**: If FX rate unavailable, `currentPrice=null`; `suitableForExactPnl=false`; `suitableForBuyRecommendation=false`.
**Reason**: Fake EUR values (raw USD claimed as EUR) are worse than null — they produce wrong P&L and BUY sizing.
**Rule**: No `currentPrice: 0`. No hardcoded FX rates. No `Infinity`.

---

## Persistence

### Vercel KV (Upstash REST) for engine output and portfolio config
**Decision**: Engine output goes to Vercel KV first, file-store second. Portfolio config same pattern.
**Reason**: Vercel is serverless — `/tmp` is ephemeral per invocation. Without KV, `/api/opportunities` always returns empty after the first response.
**Implementation**: `engine-store.ts` (engine output) and `portfolio-store.ts` (portfolio config) — KV with 5s timeout, file-store fallback. Never crashes.
**Status**: Code complete (PRs #16 + #17). `KV_REST_API_URL` and `KV_REST_API_TOKEN` configured in Vercel since May 6, 2026. End-to-end KV verification pending (Phase 1).

### Shared KV client (`kv-client.ts`) for all stores — no duplication
**Decision** (PR-0, Phase 2): Extract the 5 shared KV helpers (`getKvConfig`, `sanitizeKvError`, `upstashCommand`, `kvSet`, `kvGet`) into `src/lib/utils/kv-client.ts`. Both `engine-store.ts` and `portfolio-store.ts` import from it.
**Reason**: Both stores contained identical copies of the 5 helpers. A copy-paste in a third store would silently diverge sanitization behavior and make security bugs undetectable.
**Rule**: All new KV stores must import from `kv-client.ts`. No copy-paste of the KV helpers. Bracket notation for env vars is enforced in `kv-client.ts` — don't bypass it.
**Contract unchanged**: public API of both stores is identical before and after. No behavior change.

### File-store for local dev, ephemeral for discovery state
**Decision**: Discovery watchlist, snapshots, alert history use file-store. On Vercel this becomes `/tmp/app-finanzas`.
**Reason**: Discovery state is advisory, not financial. Losing it between runs is annoying but not dangerous — the next run rebuilds it from live prices.
**Revisit when**: Discovery state is large enough that rebuilding it every run is expensive, or we need trend tracking (drawdown progression over multiple runs). Then extend KV.

---

## Alerting

### Telegram as the only alert channel
**Decision**: Telegram via `node-telegram-bot-api`. No email, no push, no web notifications.
**Reason**: Telegram is fast, persistent, supports Markdown, accessible from phone. No infrastructure needed beyond a bot token.
**Graceful degradation**: If `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` not set, alerts log to console. Engine never fails due to Telegram absence.

---

## Discovery

### Rotating batch cursor instead of Vercel exclusion
**Decision** (P3-3f-a): Replace `isVercel ? [] : extendedStocks` with a rotating cursor.
**Reason**: Blanket Vercel exclusion meant extended universe (18 assets) was never scanned in production. Rotating batches of 8 ensure full sweep in ~3 runs.
**Implementation**: `scan-cursor.ts` with wrap-around, file-store persistence, `DISCOVERY_EXTENDED_BATCH_SIZE` env override.

### Manual provider smoke before activating external screener
**Decision** (P3-3f-0): Before connecting any external screener (EODHD, FMP, etc.) as a production source, run the capability smoke manually with real keys.
**Reason**: Prevents activating a paid or rate-limited endpoint that turns out to be inaccessible on the available plan.
**Evidence required**: `provider-capability-smoke.json` artifact from GitHub Actions workflow showing `supported=true` and `usableFor=candidate_discovery`.
**Rule**: No screener connector PR without this artifact.

### No BUY_CANDIDATE from screener alone
**Decision**: External screener results are candidates, not recommendations. A screener hit must go through: pricing validation → data quality check → scoring → drawdown classification before a BUY alert is generated.
**Reason**: Screener criteria (market cap, exchange) are not the same as investment merit.

---

## Scoring and recommendations

### No BUY if dataQualityScore is low
**Decision**: Even if scoring says BUY, if data quality is low (stale price, estimated P&L, FX unavailable), the recommendation is downgraded or suppressed.
**Reason**: A confident recommendation built on bad data is worse than no recommendation.

### Recommendations must include confidence, reason, and what would change them
**Decision**: Every BUY / REDUCE alert must state:
- Current price, distance from highs/lows
- Conviction level
- Risk summary
- Reason (not generic)
- Suggested amount
- Data source and age
- What condition would flip the recommendation

**Reason**: The app is a decision-support tool, not a magic signal. The user must be able to evaluate the recommendation critically.

### No "buy at the perfect moment" promise
**Decision**: The app detects zones of good entry/exit, not precise timing.
**Reason**: Precise timing is unpredictable and promising it leads to bad decisions. Zones are actionable, honest, and explainable.

---

## Security

### No API keys in logs, reports, or artifacts
**Decision**: All scripts and workflows sanitize output before writing or uploading.
**Implementation**: `sanitizeString()` strips key URL params; `validateReportSecurity()` validates no key value in JSON; workflow anti-secret scan before artifact upload.

### No raw provider payloads stored
**Decision**: Only parsed field names, counts, and sample tickers are stored in capability reports — not raw API responses.
**Reason**: Raw responses may contain pricing data covered by terms of service, or incidentally contain sensitive fields.

---

## Development process

### tsx as the script runner (not ts-node)
**Decision**: All scripts and tests use `npx tsx`. `ts-node` remains for legacy scripts.
**Reason**: `tsx` is faster, handles `import type` without `@types/ts-node` config, and works without a separate tsconfig for scripts.
**Note**: `tsx` must be declared as a pinned devDependency — not relying on `npx` download-on-run in CI.

### Test runner: custom tsx runner, not Jest
**Decision**: `scripts/run-tests.ts` discovers `*.test.ts` files and runs each with `npx tsx`. No Jest, no Vitest.
**Reason**: Zero configuration. Tests are standalone scripts that exit 1 on failure. Works in CI with just `npm ci && npm test`.

### No advancing features without updating docs
**Decision**: `PROJECT_STATE.md` and `CTO_BACKLOG.md` must be updated before closing any PR.
**Reason**: This codebase is developed across multiple agent sessions. Without live docs, the next agent starts cold and repeats the same research. Docs are the handoff.

### Production reality check before any Vercel change
**Decision**: When production state contradicts docs, do not act on the docs — verify production first.
**Protocol**:
1. Check `/api/config/status` in production.
2. Check Vercel → Settings → Environment Variables.
3. Open a docs-only PR to reconcile.
4. Only then decide on functional changes.
**Reason**: Docs can lag production. An agent acting on stale docs may recommend changes that break a working system (e.g., changing `PRICE_PROVIDER=twelvedata` to `yahoo` when twelvedata was already working and yahoo was not reliable from Vercel IPs).
