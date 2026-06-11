# App Finanzas — Project State

Last updated: 2026-06-11 · Branch: `main` (PR #25 — Fase 1 verificación completa)

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

`main` — Fase 1 completada (2026-06-11). Todos los items P0 de código y verificación cerrados. Sin ramas de feature activas. Próxima fase: Fase 2 (pendiente confirmación de Beatriz).

---

## Production status

> **Nota**: este estado se reconcilió en PR #19 contra Vercel real. Los docs anteriores asumían que producción estaba en mock — era incorrecto. El estado real se verificó el 2026-06-04.

| Item | Status | Notes |
|---|---|---|
| App deployed on Vercel | ✓ | `main` auto-deploys |
| Vercel cron wired | ✓ | `vercel.json` — 07:00 + 16:00 UTC Mon-Fri |
| `CRON_SECRET` cron auth | ✓ **configured** (since Apr 30) | Fail-closed: 503 if missing, 401 if wrong. `/api/config/status` → `cronSecretSet: true`. |
| `PRICE_PROVIDER` | ✓ **`twelvedata`** (since May 5) | `TWELVE_DATA_API_KEY` also configured. Production uses real prices — NOT mock. `/api/config/status` → `priceProvider: "twelvedata"`. |
| Vercel KV connected | ✓ **verificado end-to-end (2026-06-11)** | `kvConfigured: true`. KV write y read cross-instance confirmados. `/api/opportunities` `stockCount: 4`, `/api/portfolio` `analysesCount: 13`. Bugs de caching (PR #20) e inlining (PR #21) ya corregidos y verificados. |
| Telegram configured | ✓ **verificado (2026-06-11)** | Bot envió digest tras engine run con `sendDigest: true`. `success: true` confirmado. |
| EODHD pricing | present but **inactive** | `EODHD_ENABLED=true` + `EODHD_API_KEY` configured in Vercel, but `PRICE_PROVIDER=twelvedata` so EODHD is never instantiated. Safe to ignore until a chain PR activates it. |
| `PRICE_PROVIDER_CHAIN` | present but **inactive** | Configured in Vercel, but `PRICE_PROVIDER=twelvedata` not `chain`. Do not activate chain until `batchGetRecentHighs` is implemented. |
| Orphaned env vars | **inert** | `PRICE_REFRESH_MODE`, `PRICE_CACHE_MODE`, `REPORTING_CURRENCY` — configured in Vercel, not read by any code. Harmless; do not build code around them without a PR. |
| Discovery state (watchlist, snapshots) | ephemeral | file-store → `/tmp` on Vercel; resets per invocation. P1 item. |
| Alert history / previous states | ephemeral | Same — file-store → `/tmp`. P1 item. |

**Summary: Fase 1 completada el 2026-06-11. Producción verificada end-to-end: precios reales (Twelve Data), KV persistencia cross-instance confirmada, cron auth verificado, CSV import KV-backed, Telegram funcionando. Siguiente: Fase 2 (reliability — KV para alert history y discovery state). No iniciar sin confirmación de Beatriz.**

---

## What the app does today (executive summary)

**Working in production:**
- Fetches real prices for ~39 symbols via Twelve Data
- Computes BUY/WATCH/HOLD/REDUCE/SELL signals per holding + discovered opportunities
- Scores each signal with conviction (HIGH/MEDIUM/LOW), drawdown phase, distance from 52W high/low
- Sends a Telegram digest at 07:00 + 16:00 UTC Mon-Fri — bot delivery verified 2026-06-11 ✅
- Persists engine output to Vercel KV; write + read cross-instance verified 2026-06-11 ✅

**Verificado end-to-end (Fase 1 completa, 2026-06-11):**
- KV write y read cross-instance: POST engine → GET engine → `runAt` coincide ✅
- Twelve Data pricing: 8/8 symbols fetched, EUR/USD rate 1.15 ✅
- Portfolio config loads correctly: 13 holdings ✅
- `/api/config/status` → `kvConfigured: true` ✅
- `/api/opportunities`: `stockCount: 4`, `lastRunAt` no-null ✅
- `/api/portfolio`: `analysesCount: 13`, `lastRunAt` no-null ✅
- Cron auth: sin header → 401, header incorrecto → 401, header correcto (`www.beaihub.com`) → 200 ✅
- CSV import: `saved: true`, `saveSource: "kv"`, `holdingsUpdated: 16` ✅
- Telegram: `success: true`, bot envió digest ✅
- Stale-cache bug (PR #20) y env inlining bug (PR #21) corregidos y verificados ✅

**Fase 2 — pendiente (no iniciar sin confirmación de Beatriz):**
- `p1-alert-history-kv`: mover history.ts (dedupe ring buffer) a KV
- `p1-discovery-state-kv`: mover watchlist y snapshots a KV (prefijo `discovery:`)

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

**Caching bug fixed** (PR #20, Fase 1): `/api/opportunities` and `/api/portfolio` only exported GET handlers. Next.js/Vercel was serving a stale cached response ("No engine output yet") from the first deployment request, bypassing the function entirely. Fixed with `export const dynamic = 'force-dynamic'` and static imports for `engine-store` + `portfolio-store`.

**Env inlining bug fixed** (PR #21, Fase 1): PR #20 made the handlers run fresh, but they still couldn't see KV. Turbopack can inline `process.env.VAR` (dot notation) as `undefined` at build time in small standalone bundles — the GET routes were affected, the larger POST bundle was not. Fixed with bracket notation (`process.env['KV_REST_API_URL']`) in `engine-store.ts` and `portfolio-store.ts`. Rule going forward: **KV env vars in server-side stores must use bracket notation**, and `/api/config/status` now exposes `kvConfigured` for live diagnosis. Full writeup: RUNBOOK.md § "Lección Fase 1".

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
| Alert history persistence | file-store only → needs KV extension (Fase 2 — pendiente confirmación) |
| Discovery watchlist/snapshots | file-store, ephemeral → KV (Fase 2 — pendiente confirmación) |
| Radar for strong companies outside portfolio | External screener not integrated yet. Requires smoke evidence + ExternalCandidate schema (Phase 3) |
| Single-asset live check | Not built yet (Phase 4) |
| News/thesis explainer | Not built yet, requires news provider decision (Phase 5) |

---

## Last relevant PRs

| PR | Title | State |
|---|---|---|
| #25 | docs: Fase 1 verificación end-to-end completa (2026-06-11) | Merged |
| #21 | fix: bracket notation para KV env vars (env inlining Turbopack) | Merged |
| #20 | fix: force-dynamic en rutas GET-only + static imports | Merged |
| #19 | docs: production reality reconciliation + investment roadmap | Merged |
| #18 | docs: roadmap post-P0 and single-asset live check backlog | Merged `6e49be4` |
| #17 | P0: CSV persistence — portfolio config KV-aware | Merged `6af45c0` |

---

## Test suite

```
npx tsx scripts/run-tests.ts   →  23 suites · 1509 asserts · 0 failed
```
