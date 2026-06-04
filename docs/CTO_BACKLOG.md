# CTO Backlog — App Finanzas

Last updated: 2026-06-04 (post PR #17)

Ordered by priority. P0 = production is broken or silent without these. Do not advance to P1 until P0 is solid.

---

## P0 — Production basics (app is broken without these)

### P0-0: Close open cron route ✓ DONE (PR #13, `021e89f`)
**Status**: Implemented. `checkCronAuth()` in `src/app/api/cron/daily/route.ts` returns 503 if `CRON_SECRET` is not set, 401 if header is missing or wrong. Verified by 7 unit tests in `src/app/api/cron/__tests__/cron-auth.test.ts`.
**Still required**: Set `CRON_SECRET` in Vercel env vars (the code is deployed; the secret is not).

---

### P0-1: Set real pricing provider in Vercel
**Problem**: `PRICE_PROVIDER` defaults to `'mock'` when not set. Production scores your portfolio against fake prices.

**Fix**: In Vercel dashboard → Environment Variables → set:
```
PRICE_PROVIDER = yahoo
```
Use `yahoo` directly for the first go-live. Add `chain` when a second real provider is needed.

**Acceptance**: `/api/engine/run` POST response shows real prices for AAPL, MSFT, etc. `pricingMethod` in output shows `yahoo` not `mock`.

---

### P0-2: Connect Vercel KV
**Problem**: Engine output is stored in `/tmp/app-finanzas` on Vercel — wiped between invocations. `/api/engine/run` GET is KV-aware but without KV configured it falls back to file-store (ephemeral). `/api/opportunities` and `/api/portfolio` are not KV-aware and will return empty data between invocations even if KV is later added (see P0-5).

**Fix**: Create a Vercel KV store in the dashboard. Set env vars:
```
KV_REST_API_URL = https://...upstash.io
KV_REST_API_TOKEN = <token>
```
Code in `engine-store.ts` is already written and handles KV with file-store fallback.

**Acceptance**: Run engine via cron, then call `/api/engine/run` GET — gets back the same run's data. Persists through a second cron run.

---

### P0-3: Set CRON_SECRET (env var)
**Problem**: Code is fail-closed (503 if missing) but the env var has not been set in Vercel. Without it, the cron route will not execute.

**Fix**: Generate a strong random string. Set in Vercel:
```
CRON_SECRET = <random-64-char-hex>
```
Vercel injects it automatically in cron `Authorization: Bearer` headers.

**Acceptance**: Vercel-scheduled cron runs and returns 200. Direct `GET /api/cron/daily` without header returns 401.

---

### P0-4: Connect Telegram
**Problem**: Alerts are computed but go nowhere — logged to console only.

**Fix**: Create Telegram bot via @BotFather. Get chat ID. Set in Vercel:
```
TELEGRAM_BOT_TOKEN = <token>
TELEGRAM_CHAT_ID = <your-chat-id>
```

**Acceptance**: Run engine manually (`POST /api/engine/run`), confirm Telegram message received within 30 seconds.

---

### P0-5: Read-endpoint KV consistency ✓ DONE (PR #16)
**Status**: Implemented. Both `/api/opportunities` and `/api/portfolio` now use `loadEngineOutput()` from `engine-store.ts` — KV-first, file-store fallback. Pure response builders (`buildOpportunitiesResponse`, `buildPortfolioResponse`) exported and covered by 12 new unit tests including wiring tests with mocked KV fetch.

**Verification**: 21 suites · 1493 asserts · 0 failed.

---

### P0-6: CSV import persistence on Vercel ✓ DONE (PR #17)
**Status**: Implemented. New module `src/lib/utils/portfolio-store.ts` provides `loadPortfolioConfig()` (KV-first, `config/portfolio.json` fallback) and `savePortfolioConfig()` (KV write, local file fallback).

- `POST /api/portfolio/import` now reads existing config via `loadPortfolioConfig()` and saves via `savePortfolioConfig()` → `saved: true` in Vercel when KV configured.
- `GET /api/portfolio`, `runDailyEngine()`, and both `GET`/`POST /api/engine/run` all read portfolio config via `loadPortfolioConfig()`.
- Response contract unchanged. Added `saveSource` field to import response.
- 16 new unit tests (8 portfolio-store + 8 import).

**Verification**: 23 suites · 1509 asserts · 0 failed.

---

### P0-7: ENGINE_API_SECRET design risk (document, not fix)
**Current behavior**: `POST /api/engine/run` is fail-open when `ENGINE_API_SECRET` is not set — any caller can trigger a full engine run. This is intentional: the dashboard (`page.tsx` line 140) calls POST without an Authorization header.

**Risk**: Without `ENGINE_API_SECRET`, the engine endpoint is publicly triggerable and will consume API rate limits / KV writes from any source.

**Options**:
- A: Accept current design — dashboard works, risk is low for a personal app on Vercel Hobby
- B: Set `ENGINE_API_SECRET` in Vercel and add the header to the dashboard fetch — closes the endpoint
- C: Move dashboard trigger to use the cron route instead (uses `CRON_SECRET`)

**Recommended**: Option A for now (personal app, Vercel Hobby rate limiting provides natural protection). If exposed publicly, implement B.

**Not a code blocker**: engine still runs correctly. Document and decide before go-live.

---

## P1 — Automation and reliability

### P1-1: Verify end-to-end cron → alert → Telegram
Run through the full loop manually:
1. Trigger `POST /api/engine/run` (or `GET /api/cron/daily` with `Authorization: Bearer $CRON_SECRET`)
2. Confirm engine runs, prices load, scoring completes
3. Confirm alerts generated and pushed to Telegram
4. Confirm engine output saved to KV
5. Confirm `GET /api/engine/run` returns fresh data (KV-aware)
6. Confirm `/api/opportunities` returns fresh data (after P0-5 is implemented)

Document any gaps found.

---

### P1-2: Discovery state persistence (watchlist / snapshots)
**Problem**: `watchlist.ts` and `snapshots.ts` use `file-store` → `/tmp` on Vercel. Watchlist entries survive zero runs.

**Fix options**:
- A: Extend KV to cover watchlist and snapshots (prefixed keys like `discovery:watchlist`)
- B: Accept stateless discovery per run (re-evaluate all each run) — simpler but loses trend tracking

Recommended: option A, using the same KV pattern as `engine-store.ts`.

---

### P1-3: Alert history persistence (dedupe ring buffer)
Same problem as P1-2: `history.ts` uses file-store. Dedupe doesn't work across Vercel invocations.

Fix: extend KV or accept alert repetition (worse UX).

---

### P1-4: Daily digest quality
Review digest format (`digest.ts`). Ensure:
- Every BUY/REDUCE signal includes: ticker, current price, distance from 52W high/low, conviction, reason, suggested amount, data age, source
- Digest shows portfolio summary: NAV, daily change, biggest moves
- No "current price = null" or "0" visible to user

---

## P2 — Discovery motor

### P2-1: Resolve multi-source provider after smoke
After merging PR #12 and running the GitHub Actions workflow with real API keys:
- If EODHD screener accessible: implement P3-3f-b (ExternalCandidate schema) → P3-3f-c (EODHD screener connector)
- If FMP free tier works: P3-3f-b → P3-3f-c-alt (FMP connector)
- If nothing works on free tier: continue with rotating batches only; evaluate paid plan cost/benefit

Do not add any external screener connector without real smoke evidence.

---

### P2-2: ExternalCandidate schema (P3-3f-b)
Schema for candidates arriving from external screeners (not in universe config):
- `ticker`, `exchange`, `source`, `screenerScore`, `marketCap`, `discoveredAt`, `confirmedAt`, `status`
- Status machine: `candidate` → `confirmed` → `watchlisted` → `graduated` | `rejected`
- Must not score as BUY until: pricing validated, data quality above threshold, not duplicate with universe

---

### P2-3: Scoring calibration
Current scoring weights are placeholders. After real data is flowing:
- Review `RADAR_SCORE_WEIGHTS` in `drawdown-radar.ts` against real drawdown distributions
- Review scanner scoring in `scoring.ts` — ensure no signal inflated by mock data history
- Add `dataQualityScore` gate: no BUY if data quality is low (already blocked by policy, needs code enforcement)

---

### P2-4: BUY/REDUCE signal quality
Each BUY or REDUCE output must include all of:
- [ ] Current price (not null, not 0, not mock)
- [ ] Average cost (from portfolio, may be null if not in portfolio)
- [ ] Distance from 52W high and 52W low
- [ ] Drawdown phase (`classifyDrawdownZone`)
- [ ] Conviction (HIGH/MEDIUM/LOW)
- [ ] Risk summary (one sentence)
- [ ] Reason (one sentence, non-generic)
- [ ] Suggested amount (EUR, sized by portfolio and conviction)
- [ ] Data age (timestamp of last price)
- [ ] Data source (`yahoo`, `eodhd`, etc.)
- [ ] Confidence level
- [ ] What would flip this recommendation

---

## P3 — Observability and validation

### P3-1: Structured engine logging
Current logging is ad-hoc console logs. Add:
- Run ID per engine invocation
- Start/end timestamps, duration
- Prices fetched count, cache hits, errors
- Alerts generated count, Telegram success/fail
- KV write success/fail

Write structured JSON to `POST /api/engine/run` response for debugging.

---

### P3-2: Extend `/api/config/status` health check
**Note**: `/api/config/status` already exists at `src/app/api/config/status/route.ts`. It currently returns:
```json
{
  "priceProvider": "mock" | "yahoo" | ...,
  "telegramConfigured": true | false,
  "cronSecretSet": true | false,
  "isVercel": true | false
}
```

**Extend** (do not recreate) to also return:
- KV connected (yes/no) — attempt a lightweight KV ping
- Last engine run (timestamp, from KV if available)
- Universe size (seed + extended count)
- Test suite status (cached from CI, optional)

---

### P3-3: Backtesting / signal validation
Run historical data through scoring to verify signals were actionable:
- Identify dates where `BUY` was signaled
- Check 30/60/90 day forward returns
- Identify false positives (BUY → continued drawdown)
- Adjust scoring weights if false positive rate is high

Only implement after P0 + P1 are solid and real prices are flowing for 30+ days.

---

### P3-4: Runbook automation
Automate the most common ops tasks:
- Auto-retry Telegram on rate limit
- Alert on KV write failure (fallback to Telegram "KV is down" message)
- Alert on engine crash (catch unhandled, send to Telegram)
- Health check on cron start (before scoring, verify KV + pricing respond)

---

## Not doing (explicit non-goals)

- Fundamentals (P/E, EPS, revenue) — too noisy for this use case; not scheduled
- Dynamic position sizing beyond current allocator — current model is sufficient
- New universe symbols — requires EODHD smoke evidence first
- GBX/GBP new symbols — explicitly deferred
- CNDX, IWVL, EMIM — explicitly deferred
- EODHD as default pricing provider — explicitly deferred pending evaluation
- Public-facing UI / multi-user — not in scope

---

## Rule: update this file

**Before closing any PR**, update `PROJECT_STATE.md` with what changed. Before opening any PR, check this backlog for conflicts. This is the source of truth for the project's direction.
