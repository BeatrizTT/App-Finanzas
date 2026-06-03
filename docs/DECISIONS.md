# Architecture Decisions — App Finanzas

Recorded decisions with reasoning. Update when a decision is revisited.

---

## Pricing

### Yahoo Finance2 as primary pricing source
**Decision**: Use `yahoo-finance2` as the default and primary price provider.
**Reason**: Zero cost, covers US + EU + ETF tickers, returns adjusted close, dividend yield, 52W high/low. Sufficient for personal use with small universe.
**Risk**: Unofficial API; rate limits; may break without warning.
**Mitigation**: Provider chain with fallback. Any Yahoo failure degrades gracefully. If Yahoo fails persistently, EODHD or FMP can be promoted.
**Revisit if**: Yahoo rate-limits at our cron frequency (2×/day Mon-Fri), or returns stale data repeatedly.

### EODHD as optional secondary, not default
**Decision**: EODHD requires `EODHD_ENABLED=true` env var. Never activated by default.
**Reason**: EODHD has per-call costs (screener = 5 call units). Activating without testing risks budget overrun.
**Rule**: No symbol enters `eodhd-symbol-validation.json` as `validated_usd_needs_fx` without real EODHD smoke evidence.
**Status**: 10 symbols validated. EODHD pricing gated. Screener not yet integrated.

### Provider chain over single-provider fallback
**Decision**: `PRICE_PROVIDER=chain` with `PRICE_PROVIDER_CHAIN=yahoo` (extensible) instead of hard-coded single provider.
**Reason**: Allows adding/removing providers without code changes. Degradation is observable.

### No raw USD prices displayed as EUR
**Decision**: If FX rate unavailable, `currentPrice=null`; `suitableForExactPnl=false`; `suitableForBuyRecommendation=false`.
**Reason**: Fake EUR values (raw USD claimed as EUR) are worse than null — they produce wrong P&L and BUY sizing.
**Rule**: No `currentPrice: 0`. No hardcoded FX rates. No `Infinity`.

---

## Persistence

### Vercel KV (Upstash REST) for engine output
**Decision**: Engine output goes to Vercel KV first, file-store second.
**Reason**: Vercel is serverless — `/tmp` is ephemeral per invocation. Without KV, `/api/opportunities` always returns empty after the first response.
**Implementation**: `engine-store.ts` — KV with 5s timeout, file-store fallback. Never crashes.
**Status**: Code is written; KV env vars not yet set in Vercel dashboard. This is P0.

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
