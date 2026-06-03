# Runbook — App Finanzas

Operational procedures. Keep this up to date as infrastructure changes.

---

## Running tests locally

```bash
npm test
# or
npx tsx scripts/run-tests.ts
```

Runs all 18 suites (`src/lib/**/__tests__/*.test.ts`). Exits 0 if all pass.

To run a single suite:
```bash
npx tsx src/lib/discovery/__tests__/provider-capability.test.ts
```

---

## Running the smoke script locally

```bash
npx tsx scripts/smoke-discovery-providers.ts
```

Without API keys set: all providers report `missing_key`. Output is written to `src/data/provider-capability-smoke.json`. This is normal.

With keys:
```bash
EODHD_API_KEY=xxx FMP_API_KEY=yyy npx tsx scripts/smoke-discovery-providers.ts
```

---

## Running the provider capability smoke via GitHub Actions

1. Go to **GitHub → Actions → Multi-source capability smoke (P3-3f-0)**
2. Click **Run workflow**
3. Confirm trigger — workflow runs with secrets injected automatically
4. When complete, download artifact `provider-capability-smoke` from the workflow run summary
5. Open `provider-capability-smoke.json` and check:
   - Which providers have `"usableFor": "candidate_discovery"`
   - `summary.recommendedNextProvider`
   - Any warnings

### Prerequisites (first run)
Set these as **Repository Secrets** (Settings → Secrets and variables → Actions → New repository secret):

| Secret | Where to get it |
|---|---|
| `EODHD_API_KEY` | eodhd.com → My Account → API tokens |
| `FMP_API_KEY` | financialmodelingprep.com → Dashboard |
| `FINNHUB_API_KEY` | finnhub.io → Dashboard → API key |
| `ALPHA_VANTAGE_API_KEY` | alphavantage.co → Get Free API Key |
| `TWELVE_DATA_API_KEY` | twelvedata.com → Dashboard |

All are optional. Omitting one produces `missing_key` for that provider.

---

## Configuring Vercel environment variables

Go to: **Vercel → Project → Settings → Environment Variables**

### Required for production

| Env var | Value | Notes |
|---|---|---|
| `PRICE_PROVIDER` | `chain` | Without this, defaults to `mock` |
| `PRICE_PROVIDER_CHAIN` | `yahoo` | Or `twelvedata,yahoo` if Twelve Data key available |
| `CRON_SECRET` | random 64-char string | Protects `/api/cron/daily` from unauthenticated calls |
| `KV_REST_API_URL` | Upstash KV URL | From Vercel KV dashboard |
| `KV_REST_API_TOKEN` | Upstash KV token | From Vercel KV dashboard |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token | From @BotFather |
| `TELEGRAM_CHAT_ID` | Your Telegram chat ID | From @userinfobot or API |

### Optional

| Env var | Default | Notes |
|---|---|---|
| `TWELVE_DATA_API_KEY` | — | Enables Twelve Data in chain |
| `EODHD_API_KEY` | — | Required if `PRICE_PROVIDER=eodhd` |
| `EODHD_ENABLED` | `false` | Must be `true` to activate EODHD |
| `DISCOVERY_INCLUDE_EXTENDED_ON_VERCEL` | `true` | Set `false` to disable extended batches |
| `DISCOVERY_EXTENDED_BATCH_SIZE` | `8` | 0 = disable; max 20 |
| `MOCK_MODE` | `false` | Set `true` to force mock provider regardless of `PRICE_PROVIDER` |

---

## Deploying

Push to `main` — Vercel auto-deploys. No manual steps needed.

To force a redeploy without a code change:
```bash
# In Vercel dashboard → Deployments → Redeploy latest
```

---

## Triggering the engine manually

```bash
curl -X GET "https://<your-vercel-url>/api/engine/run" \
  -H "Authorization: Bearer $CRON_SECRET"
```

Or open it in browser (if `CRON_SECRET` not set, no auth required — fix this first).

Response includes:
- `success`: bool
- `runAt`: ISO timestamp
- `alerts`: number of alerts generated
- `errors`: array of non-fatal errors

---

## Verifying production is working

1. Trigger engine: `GET /api/engine/run` (or wait for cron)
2. Check opportunities: `GET /api/opportunities` — should return engine output with real prices
3. Confirm `pricingMethod` for any ticker is `yahoo` or `eodhd`, not `mock`
4. Confirm `currentPrice` is non-null and non-zero for liquid US stocks (AAPL, MSFT)
5. Check Telegram — alerts should have arrived for any BUY/REDUCE signals

---

## What to do if Yahoo Finance fails

Symptoms: `currentPrice: null` for multiple tickers, `pricingMethod: mock`, errors in engine output mentioning Yahoo.

Steps:
1. Check `yahoo-finance2` npm for known issues / version pinning
2. Check if Yahoo Finance API changed (search for recent `yahoo-finance2` issues on GitHub)
3. If transient (rate limit, temporary outage): wait until next cron run
4. If persistent: add `TWELVE_DATA_API_KEY` to Vercel and set `PRICE_PROVIDER_CHAIN=twelvedata,yahoo`
5. If Twelve Data is also unavailable: activate EODHD (`EODHD_ENABLED=true`) for validated symbols only

Never set `currentPrice` to a fake value. Leave it null and let the safety gates suppress BUY recommendations.

---

## What to do if Telegram is not sending

Symptoms: Engine runs successfully but no Telegram messages received.

Steps:
1. Check Vercel function logs for `[Telegram] Not configured` — means env vars missing
2. Verify `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` are set in Vercel env vars
3. Test bot directly: `curl "https://api.telegram.org/bot$TOKEN/getMe"`
4. Verify chat ID: `curl "https://api.telegram.org/bot$TOKEN/getUpdates"` — send any message to the bot first
5. Check for rate limits: Telegram allows 30 messages/second per bot, 1 message/second to a single chat
6. If `sendMessage` returns 403: you may have blocked the bot — unblock or start a new chat

---

## What to do if Vercel KV does not respond

Symptoms: Engine output not persisted; `/api/opportunities` returns stale or empty data.

Steps:
1. Check `KV_REST_API_URL` and `KV_REST_API_TOKEN` are set in Vercel env vars
2. Test Upstash connection directly:
   ```bash
   curl -H "Authorization: Bearer $KV_REST_API_TOKEN" \
     "$KV_REST_API_URL/get/engine:latest_output"
   ```
3. Check Upstash dashboard for usage / quota exceeded
4. If KV is down: engine falls back to file-store `/tmp` automatically (non-fatal); data is not persisted across invocations but the engine still runs
5. For prolonged outage: create a new Upstash KV database and update env vars

---

## Reading the capability smoke artifact

After running the GitHub Actions workflow:

1. Download artifact `provider-capability-smoke` from Actions run
2. Open `provider-capability-smoke.json`:
```json
{
  "version": 1,
  "runAt": "...",
  "results": [
    {
      "provider": "eodhd_screener",
      "supported": true/false,
      "usableFor": "candidate_discovery" | "pricing_validation" | "research_only" | "not_usable",
      "warnings": [],
      "sampleTickers": [],
      "callUnitsEstimated": 5
    }
  ],
  "summary": {
    "recommendedNextProvider": "eodhd_screener" | null,
    "candidateDiscoveryProviders": [],
    "warnings": []
  }
}
```
3. Decision tree:
   - `usableFor === "candidate_discovery"` → proceed to P3-3f-b (ExternalCandidate schema)
   - `warnings: ["plan_upgrade_required"]` → current EODHD plan doesn't include screener; evaluate upgrade or use FMP
   - `warnings: ["auth_or_plan_required"]` → API key works but screener endpoint denied; check plan
   - All `not_usable` → continue with rotating batches only; re-evaluate in 30 days

---

## Common npm commands

```bash
npm ci                  # Clean install from lock file (use in CI)
npm install             # Update dependencies
npm test                # Run all 18 test suites
npm run build           # Production build (Next.js)
npx tsc --noEmit        # Type-check without building
npm run dev             # Local dev server on :3000
npm run lint            # ESLint
```
