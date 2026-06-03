# Runbook — App Finanzas

Operational procedures. Keep this up to date as infrastructure changes.

---

## Running tests locally

```bash
npm test
# or
npx tsx scripts/run-tests.ts
```

Runs all 19 suites. Exits 0 if all pass.

To run a single suite:
```bash
npx tsx src/lib/discovery/__tests__/provider-capability.test.ts
npx tsx src/app/api/cron/__tests__/cron-auth.test.ts
```

---

## Running the smoke script locally

```bash
npx tsx scripts/smoke-discovery-providers.ts
```

Without API keys: all providers report `missing_key`. Report written to `src/data/provider-capability-smoke.json`. Normal.

With keys:
```bash
EODHD_API_KEY=xxx FMP_API_KEY=yyy npx tsx scripts/smoke-discovery-providers.ts
```

---

## Running the provider capability smoke via GitHub Actions

1. Go to **GitHub → Actions → Multi-source capability smoke (P3-3f-0)**
2. Click **Run workflow**
3. Download artifact `provider-capability-smoke` when complete
4. Open `provider-capability-smoke.json` and check:
   - `summary.recommendedNextProvider`
   - Which providers have `"usableFor": "candidate_discovery"`
   - Any warnings

### Prerequisites (first run)
Add as **Repository Secrets** (Settings → Secrets and variables → Actions):

| Secret | Where to get it |
|---|---|
| `EODHD_API_KEY` | eodhd.com → My Account → API tokens |
| `FMP_API_KEY` | financialmodelingprep.com → Dashboard |
| `FINNHUB_API_KEY` | finnhub.io → Dashboard → API key |
| `ALPHA_VANTAGE_API_KEY` | alphavantage.co → Get Free API Key |
| `TWELVE_DATA_API_KEY` | twelvedata.com → Dashboard |

---

## Vercel environment variables — go-live checklist

Go to: **Vercel → Project → Settings → Environment Variables**

### Required before go-live (in this order)

```
CRON_SECRET        = <openssl rand -hex 32>
PRICE_PROVIDER     = yahoo
KV_REST_API_URL    = <from Vercel KV → Upstash dashboard>
KV_REST_API_TOKEN  = <from Vercel KV → Upstash dashboard>
TELEGRAM_BOT_TOKEN = <from @BotFather>
TELEGRAM_CHAT_ID   = <personal chat ID>
```

**Why `PRICE_PROVIDER=yahoo`**: simplest path to real prices. No Twelve Data key needed. Can add `chain` later when a second provider is needed.

**Why `CRON_SECRET` first**: the cron route returns 503 if this is missing — it cannot execute. Set this before any scheduled run.

**Note on `ENGINE_API_SECRET`**: the manual trigger endpoint (`POST /api/engine/run`) is fail-open when this is not set. The dashboard calls POST without an Authorization header, so this is intentional for personal use. If you want to close the endpoint, set `ENGINE_API_SECRET` and add the header to the dashboard fetch in `page.tsx`. See CTO_BACKLOG P0-7.

### Optional

```
ENGINE_API_SECRET               = <random hex>     # closes POST /api/engine/run if set
PRICE_PROVIDER_CHAIN            = yahoo            # if using PRICE_PROVIDER=chain
TWELVE_DATA_API_KEY             = <key>            # only if adding Twelve Data to chain
EODHD_API_KEY                   = <key>            # only if activating EODHD pricing
EODHD_ENABLED                   = true             # required if using EODHD_API_KEY
DISCOVERY_INCLUDE_EXTENDED_ON_VERCEL = true        # default true; set false to disable batches
DISCOVERY_EXTENDED_BATCH_SIZE        = 8           # default 8; max 20
MOCK_MODE                       = false            # set true to force mock provider
```

---

## Verifying cron protection — manual test

Once `CRON_SECRET` is set in Vercel (and after deploying), verify:

```bash
BASE="https://<your-vercel-url>"
SECRET="<your-CRON_SECRET>"

# Case 1: missing CRON_SECRET in env → 503 (cannot test without undeploying, but code verified by unit tests)

# Case 2: no Authorization header → 401
curl -s -o /dev/null -w "%{http_code}" "$BASE/api/cron/daily"
# Expected: 401

# Case 3: wrong Authorization → 401
curl -s -o /dev/null -w "%{http_code}" "$BASE/api/cron/daily" \
  -H "Authorization: Bearer wrongvalue"
# Expected: 401

# Case 4: correct Authorization → 200 (engine runs)
curl -s "$BASE/api/cron/daily" \
  -H "Authorization: Bearer $SECRET"
# Expected: {"success":true,"runAt":"...","alerts":...}
```

The auth logic is covered by 7 unit tests in `src/app/api/cron/__tests__/cron-auth.test.ts`.

---

## Deploying

Push to `main` — Vercel auto-deploys. No manual steps.

---

## Triggering the engine manually

**Important**: `/api/engine/run` uses `ENGINE_API_SECRET`, not `CRON_SECRET`. These are separate secrets.

```bash
# POST — triggers a full engine run (stores output to KV + file-store)
# If ENGINE_API_SECRET is not set in Vercel, this endpoint is open (no auth required):
curl -s -X POST "https://<your-vercel-url>/api/engine/run"

# If ENGINE_API_SECRET is set:
curl -s -X POST "https://<your-vercel-url>/api/engine/run" \
  -H "Authorization: Bearer $ENGINE_API_SECRET"

# GET — returns the latest persisted output (KV-aware, no auth required)
curl -s "https://<your-vercel-url>/api/engine/run"
```

Response includes `success`, `runAt`, `alertsCount`, `errors` array, plus full `portfolioAnalyses`, `stockOpportunities`, `etfOpportunities`.

---

## Verifying production is working

1. Set `PRICE_PROVIDER=yahoo` + `KV_REST_API_URL/TOKEN` in Vercel
2. Trigger engine: `POST /api/engine/run` (or wait for cron)
3. Check `GET /api/engine/run` — should return engine output with real prices
4. Confirm `pricingMethod` in output is `yahoo`, not `mock`
5. Confirm `currentPrice` is non-null and non-zero for AAPL, MSFT, NVDA
6. Check Telegram — digest should arrive within 30 seconds of engine run

**Note**: `GET /api/opportunities` and `GET /api/portfolio` read from file-store directly (not KV-aware as of PR #13). On Vercel, they may return empty data between invocations even if KV is configured. Use `GET /api/engine/run` as the authoritative source until `p0-read-endpoints-kv-consistency` is implemented.

---

## Known risks and open questions

### R1: `/api/opportunities` and `/api/portfolio` are not KV-aware
Both endpoints call `readJsonFile('engine-output.json', null)` directly, bypassing `loadEngineOutput()`. On Vercel, the file-store is in `/tmp` and is wiped between invocations. Even with KV configured, these endpoints return empty data after a cold start.

**Impact**: Low for now — the dashboard does not call these endpoints (it uses `/api/engine/run` GET). Impact grows if any future UI or external consumer calls these endpoints.

**Fix**: Next code PR `p0-read-endpoints-kv-consistency` — replace `readJsonFile` with `loadEngineOutput()` in both routes.

### R2: `ENGINE_API_SECRET` is optional — POST engine trigger is fail-open
If `ENGINE_API_SECRET` is not set in Vercel, `POST /api/engine/run` is publicly triggerable. Any caller can run a full engine run. See CTO_BACKLOG P0-7 for options.

### R3: `../../config/portfolio.json` path risk
Both `GET /api/engine/run` and `POST /api/engine/run` call `readJsonFile('../../config/portfolio.json', {})` to read `closedPositions` and `totalRealizedPnl`. This path is relative to `src/data/` (the file-store DATA_DIR). If DATA_DIR changes (e.g., a future migration), this path will break silently.

`GET /api/portfolio` uses `getEffectivePortfolioConfig()` for portfolio config (reads committed `config/` files — stable) and `readJsonFile('engine-output.json')` for analyses. The `../../config/portfolio.json` path issue applies to `engine/run/route.ts` and `portfolio/import/route.ts`.

---

## What to do if Yahoo Finance fails

Symptoms: `currentPrice: null` for multiple tickers, `pricingMethod: mock`.

Steps:
1. Check `yahoo-finance2` npm for known issues
2. If transient (rate limit, outage): wait for next cron run
3. If persistent: add `TWELVE_DATA_API_KEY` and set `PRICE_PROVIDER=chain` + `PRICE_PROVIDER_CHAIN=twelvedata,yahoo`
4. If Twelve Data also unavailable: activate EODHD (`EODHD_ENABLED=true`) for validated symbols only

Never set `currentPrice` to a fake value. Leave null; safety gates suppress BUY recommendations.

---

## What to do if Telegram is not sending

Steps:
1. Check Vercel function logs for `[Telegram] Not configured`
2. Verify `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` are set
3. Test bot: `curl "https://api.telegram.org/bot$TOKEN/getMe"`
4. Verify chat ID: `curl "https://api.telegram.org/bot$TOKEN/getUpdates"` (send a message to bot first)
5. 403 error: may have blocked the bot — unblock or create new chat

---

## What to do if Vercel KV does not respond

Steps:
1. Check `KV_REST_API_URL` and `KV_REST_API_TOKEN` are set in Vercel
2. Test: `curl -H "Authorization: Bearer $KV_REST_API_TOKEN" "$KV_REST_API_URL/get/engine:latest_output"`
3. Check Upstash dashboard for quota
4. If KV down: engine falls back to `/tmp` automatically; data not persisted but engine still runs
5. For prolonged outage: create new Upstash KV, update env vars

---

## Reading the capability smoke artifact

After running the GitHub Actions workflow:

```json
{
  "summary": {
    "recommendedNextProvider": "eodhd_screener" | null,
    "candidateDiscoveryProviders": [],
    "warnings": []
  }
}
```

Decision tree:
- `usableFor === "candidate_discovery"` → proceed to P3-3f-b (ExternalCandidate schema)
- `warnings: ["plan_upgrade_required"]` → plan doesn't include screener; evaluate upgrade
- All `not_usable` → continue rotating batches; re-evaluate in 30 days

---

## CSV portfolio import — current state

CSV parsing works end-to-end. On Vercel, writing back to `config/portfolio.json` **silently fails** — response includes `"saved": false`.

**Workaround until persistence is fixed**: import locally (`npm run dev`), the write succeeds, commit the updated `config/portfolio.json`.

**Permanent fix needed (P0-6)**: store portfolio CSV data in KV using the same pattern as `engine-store.ts`.

---

## Common npm commands

```bash
npm ci                  # Clean install from lock file
npm test                # 19 suites, 1481 asserts
npm run build           # Production build
npx tsc --noEmit        # Type-check
npm run dev             # Local dev server :3000
npm run lint            # ESLint
```
