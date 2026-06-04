# App Finanzas — Project State

Last updated: 2026-06-04 · Branch: `main` (PR #19 — production reality reconciled)

> Agentes/IA: leer `AGENTS.md` en la raíz del repo antes de cualquier cambio.

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
| Pricing | **Twelve Data** (production primary, `PRICE_PROVIDER=twelvedata`); Yahoo Finance2 (code present, not recommended for Vercel IPs); EODHD (optional, gated, inactive) |
| FX | USD→EUR via Yahoo FX pair; GBX→GBP built-in |
| Alerts | Telegram Bot API via `node-telegram-bot-api` |
| Cron | Vercel Cron — 07:00 UTC + 16:00 UTC Mon–Fri |
| Test runner | `npx tsx scripts/run-tests.ts` (not Jest) — 23 suites, 1509 asserts |
| Scripts | `npx tsx scripts/<name>.ts` |

---

## Active branch

`main` — PR #18 merged. All P0 code items complete. Production reality reconciled in PR #19. No active feature branches open.

---

## Production status

> **Nota**: este estado se reconcilió en PR #19 contra Vercel real. Los docs anteriores asumían que producción estaba en mock — era incorrecto. El estado real se verificó el 2026-06-04.

| Item | Status | Notes |
|---|---|---|
| App deployed on Vercel | ✓ | `main` auto-deploys |
| Vercel cron wired | ✓ | `vercel.json` — 07:00 + 16:00 UTC Mon-Fri |
| `CRON_SECRET` cron auth | ✓ **configured** (since Apr 30) | Fail-closed: 503 if missing, 401 if wrong. `/api/config/status` → `cronSecretSet: true`. |
| `PRICE_PROVIDER` | ✓ **`twelvedata`** (since May 5) | `TWELVE_DATA_API_KEY` also configured. Production uses real prices — NOT mock. `/api/config/status` → `priceProvider: "twelvedata"`. |
| Vercel KV connected | ✓ **configured** (since May 6) | `KV_REST_API_URL`, `KV_REST_API_TOKEN`, `KV_URL`, `REDIS_URL`, `KV_REST_API_READ_ONLY_TOKEN` all present. End-to-end write/read verification pending (Phase 1). |
| Telegram configured | ✓ **configured** (since Apr 30) | `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` present. `/api/config/status` → `telegramConfigured: true`. Message delivery verification pending (Phase 1). |
| EODHD pricing | present but **inactive** | `EODHD_ENABLED=true` + `EODHD_API_KEY` configured in Vercel, but `PRICE_PROVIDER=twelvedata` so EODHD is never instantiated. Safe to ignore until a chain PR activates it. |
| `PRICE_PROVIDER_CHAIN` | present but **inactive** | Configured in Vercel, but `PRICE_PROVIDER=twelvedata` not `chain`. Do not activate chain until `batchGetRecentHighs` is implemented. |
| Orphaned env vars | **inert** | `PRICE_REFRESH_MODE`, `PRICE_CACHE_MODE`, `REPORTING_CURRENCY` — configured in Vercel, not read by any code. Harmless; do not build code around them without a PR. |
| Discovery state (watchlist, snapshots) | ephemeral | file-store → `/tmp` on Vercel; resets per invocation. P1 item. |
| Alert history / previous states | ephemeral | Same — file-store → `/tmp`. P1 item. |

**Summary: Production is NOT in mock. All core env vars are configured (Twelve Data, KV, Telegram, CRON_SECRET). What remains is end-to-end verification (Phase 1) and P1 reliability work.**

---

## What the app does today (executive summary)

**Working in production:**
- Fetches real prices for ~39 symbols via Twelve Data
- Computes BUY/WATCH/HOLD/REDUCE/SELL signals per holding + discovered opportunities
- Scores each signal with conviction (HIGH/MEDIUM/LOW), drawdown phase, distance from 52W high/low
- Sends a Telegram digest at 07:00 + 16:00 UTC Mon-Fri (once end-to-end is verified)
- Persists engine output and portfolio config to Vercel KV (code complete, KV configured, write path not yet verified live)

**Not yet verified end-to-end:**
- KV write/read survival across Vercel invocations (code + env ready; live test pending)
- Telegram message delivery (configured; message receipt not yet confirmed)
- Cron execution with real `CRON_SECRET` (code + env ready; live cron log not reviewed)
- CSV import `saved: true` in Vercel (code ready; live test pending)

**Not yet built:**
- Radar for strong companies outside current portfolio with deep drawdowns (Phase 3 — external screener)
- Reliable sell/reduce alerts with multi-run trend tracking (needs alert history KV — Phase 2)
- "Verify now" live check for a single asset (Phase 4)
- "Why did it fall?" news + thesis explanation (Phase 5 — requires external news provider decision)

---

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
| Engine output (read: `/api/opportunities`) | `loadEngineOutput()` → KV first, file-store fallback | **Yes if KV configured** |
| Engine output (read: `/api/portfolio`) | `loadEngineOutput()` → KV first, file-store fallback | **Yes if KV configured** |
| Portfolio config (write: `/api/portfolio/import`) | `savePortfolioConfig()` → KV first, file-store fallback | **Yes if KV configured** |
| Portfolio config (read: all consumers) | `loadPortfolioConfig()` → KV first, `config/portfolio.json` fallback | **Yes if KV configured** |
| Alert history | file-store → `/tmp/app-finanzas` | **No — resets each invocation** |
| Previous states (drawdown) | file-store → `/tmp/app-finanzas` | **No — resets each invocation** |
| Discovery watchlist | file-store → `/tmp/app-finanzas` | **No — resets each invocation** |
| Discovery snapshots | file-store → `/tmp/app-finanzas` | **No — resets each invocation** |

**All engine output read endpoints are KV-aware** (PR #16): `/api/engine/run` GET, `/api/opportunities`, `/api/portfolio` all use `loadEngineOutput()`.

**Portfolio config is now KV-aware** (PR #17): CSV import saves to KV via `savePortfolioConfig()`. All consumers (`/api/portfolio`, `/api/engine/run`, `runDailyEngine`) load via `loadPortfolioConfig()` — KV first, `config/portfolio.json` fallback. `POST /api/portfolio/import` returns `saved: true` in Vercel when KV is configured.

**Not done yet**: Alert history, watchlist, snapshots via KV (P1).

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
- Vercel KV store (`engine-store.ts`): KV-first with file-store fallback for engine output
- Portfolio config store (`portfolio-store.ts`): KV-first with `config/portfolio.json` fallback (PR #17)
- Telegram sender: graceful degradation
- Digest builder: daily summary format
- CSV portfolio importer: parsing + KV persistence — `saved: true` in Vercel with KV (PR #17)
- Cron route: **fail-closed if CRON_SECRET missing (503)** — fixed in PR #13
- `/api/config/status`: health info — returns `priceProvider`, `telegramConfigured`, `cronSecretSet`, `isVercel`
- 4 docs: PROJECT_STATE, CTO_BACKLOG, DECISIONS, RUNBOOK

---

## Estado de env vars en Vercel — verificado

> Actualizado tras reconciliación PR #19. Estado real verificado el 2026-06-04.

| Variable | Estado real | Nota |
|---|---|---|
| `CRON_SECRET` | ✓ Configurada (Apr 30) | `cronSecretSet: true` confirmado |
| `PRICE_PROVIDER=twelvedata` | ✓ Configurada (May 5) | `priceProvider: "twelvedata"` confirmado. NO cambiar a yahoo. |
| `TWELVE_DATA_API_KEY` | ✓ Configurada (May 5) | Requerida para `PRICE_PROVIDER=twelvedata` |
| `KV_REST_API_URL` | ✓ Configurada (May 6) | Auto-generada por Vercel KV / Upstash |
| `KV_REST_API_TOKEN` | ✓ Configurada (May 6) | Auto-generada por Vercel KV / Upstash |
| `TELEGRAM_BOT_TOKEN` | ✓ Configurada (Apr 30) | `telegramConfigured: true` confirmado |
| `TELEGRAM_CHAT_ID` | ✓ Configurada (Apr 30) | Junto con BOT_TOKEN |
| `EODHD_ENABLED` | Configurada, **inactiva** | Presente pero sin efecto (PRICE_PROVIDER no es eodhd/chain) |
| `EODHD_API_KEY` | Configurada, **inactiva** | Mismo motivo |
| `PRICE_PROVIDER_CHAIN` | Configurada, **inactiva** | No activar chain hasta implementar batch |
| `ENGINE_API_SECRET` | **NO configurar** | Dashboard hace POST sin auth; configurar esto rompe el botón Analizar |

---

## What is blocked

| Item | Blocker |
|---|---|
| End-to-end KV verification | Run live: `POST /api/engine/run` → verify `GET /api/engine/run` returns same data. CSV import → verify `saved: true`. |
| Telegram message delivery | Run `POST /api/engine/run` (with real Telegram configured) → confirm message arrives. |
| Cron live execution | Review Vercel function logs to confirm cron ran and returned 200. |
| Alert history persistence | file-store only → needs KV extension (P1/Phase 2) |
| Discovery watchlist/snapshots | Same — file-store, ephemeral (P1/Phase 2) |
| Radar for strong companies outside portfolio | External screener not integrated yet. Requires smoke evidence + ExternalCandidate schema (Phase 3) |
| Single-asset live check | Not built yet (Phase 4) |
| News/thesis explainer | Not built yet, requires news provider decision (Phase 5) |

---

## Last relevant PRs

| PR | Title | State |
|---|---|---|
| #19 | docs: production reality reconciliation + investment roadmap | In progress |
| #18 | docs: roadmap post-P0 and single-asset live check backlog | Merged `6e49be4` |
| #17 | P0: CSV persistence — portfolio config KV-aware | Merged `6af45c0` |
| #16 | P0: make /api/opportunities and /api/portfolio KV-aware | Merged `6801160` |
| #15 | docs: living documentation process — AGENTS.md, PR template | Merged `518bcb4` |

---

## Test suite

```
npx tsx scripts/run-tests.ts   →  23 suites · 1509 asserts · 0 failed
```
