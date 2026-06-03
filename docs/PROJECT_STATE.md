# App Finanzas — Project State

Last updated: 2026-06-03 · Branch: `main` (PR #13 merged `021e89f`)

---

## What is this

A personal investment decision-support app. It scans a curated universe of stocks and ETFs, scores them against your portfolio, detects entry/exit zones using drawdown analysis, and sends actionable alerts via Telegram. The goal is not to promise "buy at the perfect moment" — it is to surface zones of good entry/exit backed by evidence: current price, distance from highs/lows, drawdown phase, conviction, risk, and explicit reasoning.

---

## Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router, Node runtime) |
| Language | TypeScript 5.6 |
| Hosting | Vercel (Hobby plan) |
| Persistence | Vercel KV (Upstash REST) for engine output; `/tmp` for ephemeral discovery state |
| Pricing | Yahoo Finance2 (primary) via provider chain; EODHD (optional, gated) |
| FX | USD→EUR via Yahoo FX pair; GBX→GBP built-in |
| Alerts | Telegram Bot API via `node-telegram-bot-api` |
| Cron | Vercel Cron — 07:00 UTC + 16:00 UTC Mon–Fri |
| Test runner | `npx tsx scripts/run-tests.ts` (not Jest) — 19 suites, 1481 asserts |
| Scripts | `npx tsx scripts/<name>.ts` |

---

## Active branch

`main` — PR #13 merged `021e89f`. No active feature branches open.

---

## Production status

| Item | Status | Notes |
|---|---|---|
| App deployed on Vercel | ✓ | `main` auto-deploys |
| Vercel cron wired | ✓ | `vercel.json` — 07:00 + 16:00 UTC Mon-Fri |
| `CRON_SECRET` cron auth | ✓ code done | **PR #13: fail-closed — 503 if missing, 401 if wrong. Still needs env var in Vercel dashboard.** |
| `PRICE_PROVIDER` | ⚠ needs `yahoo` in Vercel env | Default is `mock` — **production uses mock prices** |
| Vercel KV connected | ⚠ needs `KV_REST_API_URL` + `KV_REST_API_TOKEN` | Code exists; without KV, engine output ephemeral in `/tmp` |
| Telegram configured | ⚠ needs `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` | Graceful degradation: logs to console |
| EODHD pricing | disabled | Requires `EODHD_ENABLED=true` + `EODHD_API_KEY`; not default |
| Discovery state (watchlist, snapshots) | ephemeral | file-store → `/tmp` on Vercel; resets per invocation |
| Alert history / previous states | ephemeral | Same — file-store → `/tmp` |

**Summary: The app runs and processes but uses mock prices and has no persistent state across Vercel invocations. P0 env vars must be set before the app is useful.**

---

## Engine API authentication — two separate secrets

**`CRON_SECRET`** — protects `GET /api/cron/daily` (Vercel Cron route):
- Fail-closed: returns 503 if `CRON_SECRET` is not set in env
- Returns 401 if `Authorization: Bearer` header is missing or wrong
- Implemented in `checkCronAuth()` in `src/app/api/cron/daily/route.ts`, verified by 7 unit tests

**`ENGINE_API_SECRET`** — optional protection for `POST /api/engine/run` (manual trigger):
- Fail-open by design: if `ENGINE_API_SECRET` is not set, POST proceeds without auth
- This is intentional — the dashboard (`page.tsx`) calls POST without an Authorization header
- If set, POST requires `Authorization: Bearer $ENGINE_API_SECRET`
- `GET /api/engine/run` has no auth — it only reads persisted output (KV or file-store)

---

## Persistence — verified (not assumed)

| Data | Storage | Survives Vercel invocation? |
|---|---|---|
| Portfolio config | `config/portfolio.json` (committed to repo) | **Yes — stable** |
| Engine output (write path) | `saveEngineOutput()` → KV first + file-store always | **Yes if KV configured, No otherwise** |
| Engine output (read: `/api/engine/run` GET) | `loadEngineOutput()` → KV first, file-store fallback | **Yes if KV configured** |
| Engine output (read: `/api/opportunities`) | `readJsonFile('engine-output.json')` — file-store only | **No — NOT KV-aware** |
| Engine output (read: `/api/portfolio`) | `readJsonFile('engine-output.json')` — file-store only | **No — NOT KV-aware** |
| Portfolio CSV import | Tries to write `config/portfolio.json` — **catches write error silently** | **No — `saved: false` on Vercel** |
| Alert history | file-store → `/tmp/app-finanzas` | **No — resets each invocation** |
| Previous states (drawdown) | file-store → `/tmp/app-finanzas` | **No — resets each invocation** |
| Discovery watchlist | file-store → `/tmp/app-finanzas` | **No — resets each invocation** |
| Discovery snapshots | file-store → `/tmp/app-finanzas` | **No — resets each invocation** |

**Key inconsistency**: `/api/engine/run` GET is KV-aware; `/api/opportunities` and `/api/portfolio` are not. On Vercel, if KV is configured and the file-store is empty, those two endpoints will return stale/empty data even after a successful engine run. Next code PR: `p0-read-endpoints-kv-consistency`.

**Not done yet**: Read-endpoint KV consistency (P0). CSV import persistence on Vercel (P0/P1). Alert history, watchlist, snapshots via KV (P1).

---

## What is already built

### P1 — Portfolio engine
- Universe: 21 seed symbols (15 stocks + 6 ETFs), 18 extended (17 stocks + 1 ETF), rotating batches on Vercel
- Pricing chain: mock → Yahoo → EODHD (optional) → Twelve Data (optional)
- FX: USD→EUR via Yahoo FX; GBX→GBP hardcoded conversion
- Scoring: `computeScore()` — technicals, drawdown, momentum
- BUY / WATCH / HOLD / REDUCE / SELL signals with conviction and rationale
- Position sizer / allocator

### P2 — Pricing infrastructure
- Provider chain with fallback (`chain-provider.ts`)
- TTL in-memory price cache
- Price validation + staleness checks
- EODHD provider (gated behind `EODHD_ENABLED=true`)
- FX safety gates: `suitableForExactPnl` / `suitableForBuyRecommendation`

### P3 — Discovery engine
- **P3-3e**: Drawdown opportunity radar
- **P3-3f-a**: Rotating scan batches (replaces Vercel exclusion)
- **P3-3f-0**: Multi-source capability smoke (PR #12 merged)
  - GitHub Actions workflow: `workflow_dispatch` + anti-secret scan + artifact upload

### Infrastructure
- Vercel KV store (`engine-store.ts`): KV-first with file-store fallback
- Telegram sender: graceful degradation
- Digest builder: daily summary format
- CSV portfolio importer: parsing works; Vercel write fails silently
- Cron route: **fail-closed if CRON_SECRET missing (503)** — fixed in PR #13
- `/api/config/status`: health info — returns `priceProvider`, `telegramConfigured`, `cronSecretSet`, `isVercel`
- 4 docs: PROJECT_STATE, CTO_BACKLOG, DECISIONS, RUNBOOK

---

## Acciones manuales en Vercel — resumen

Ver `docs/RUNBOOK.md` sección **"Acciones manuales obligatorias en Vercel antes de producción real"** para instrucciones paso a paso.

| Variable | Obligatoria | Estado | Nota |
|---|---|---|---|
| `CRON_SECRET` | Sí | ⚠ pendiente en Vercel | Sin esto el cron devuelve 503 |
| `PRICE_PROVIDER=yahoo` | Sí | ⚠ pendiente en Vercel | Sin esto usa precios mock |
| `KV_REST_API_URL` | Sí (persistencia) | ⚠ pendiente | Sale de Vercel KV / Upstash |
| `KV_REST_API_TOKEN` | Sí (persistencia) | ⚠ pendiente | Sale de Vercel KV / Upstash |
| `TELEGRAM_BOT_TOKEN` | Recomendada | ⚠ pendiente | Alertas van sólo a logs si falta |
| `TELEGRAM_CHAT_ID` | Recomendada | ⚠ pendiente | Va junto con BOT_TOKEN |
| `ENGINE_API_SECRET` | **No configurar** | — | Dashboard hace POST sin auth; configurar esto rompe el botón Analizar |

---

## What is blocked

| Item | Blocker |
|---|---|
| Real prices in production | Set `PRICE_PROVIDER=yahoo` in Vercel |
| Persistent engine state | Set `KV_REST_API_URL` + `KV_REST_API_TOKEN` in Vercel |
| Cron protection (env) | Set `CRON_SECRET` in Vercel (code already done in PR #13) |
| Alert delivery | Set `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` in Vercel |
| `/api/opportunities` + `/api/portfolio` KV consistency | Code PR needed: `p0-read-endpoints-kv-consistency` |
| CSV persistence on Vercel | Code PR needed: `p0-csv-persistence` (KV write on import) |
| Alert history persistence | file-store only → needs KV extension (P1) |
| Multi-source discovery | Smoke only; run GitHub Actions workflow with real keys first |

---

## Last relevant PRs

| PR | Title | State |
|---|---|---|
| #13 | P0: fail closed cron auth and document production env | Merged `021e89f` |
| #12 | P3-3f-0: Multi-source discovery capability smoke | Merged `3e095ae` |
| #11 | P3-3f-a: Rotating discovery scan batches | Merged `b7dda4a` |

---

## Test suite

```
npm test   →  19 suites · 1481 asserts · 0 failed
```
