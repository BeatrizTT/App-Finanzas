# App Finanzas — Project State

Last updated: 2026-06-03 · Branch: `main` (PR #12 merged `3e095ae`)

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

`main` — PR #12 merged. P0 branch: `claude/p0-production-activation` (in progress).

---

## Production status

| Item | Status | Notes |
|---|---|---|
| App deployed on Vercel | ✓ | `main` auto-deploys |
| Vercel cron wired | ✓ | `vercel.json` — 07:00 + 16:00 UTC Mon-Fri |
| `CRON_SECRET` | ⚠ needs env var in Vercel dashboard | **Fixed in P0 branch: now returns 503 if missing (was open)** |
| `PRICE_PROVIDER` | ⚠ needs `yahoo` in Vercel env | Default is `mock` — **production uses mock prices** |
| Vercel KV connected | ⚠ needs `KV_REST_API_URL` + `KV_REST_API_TOKEN` | Code exists; without KV, engine output ephemeral in `/tmp` |
| Telegram configured | ⚠ needs `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` | Graceful degradation: logs to console |
| EODHD pricing | disabled | Requires `EODHD_ENABLED=true` + `EODHD_API_KEY`; not default |
| Discovery state (watchlist, snapshots) | ephemeral | file-store → `/tmp` on Vercel; resets per invocation |
| Alert history / previous states | ephemeral | Same — file-store → `/tmp` |

**Summary: The app runs and processes but uses mock prices and has no persistent state across Vercel invocations. P0 env vars must be set before the app is useful.**

---

## Persistence — verified (not assumed)

| Data | Storage | Survives Vercel invocation? |
|---|---|---|
| Portfolio config | `config/portfolio.json` (committed to repo) | **Yes — stable** |
| Engine output | KV (if configured) + `/tmp` fallback | **Yes if KV configured, No otherwise** |
| Portfolio CSV import | Tries to write `config/portfolio.json` — **catches write error silently** | **No — `saved: false` on Vercel** |
| Alert history | file-store → `/tmp/app-finanzas` | **No — resets each invocation** |
| Previous states (drawdown) | file-store → `/tmp/app-finanzas` | **No — resets each invocation** |
| Discovery watchlist | file-store → `/tmp/app-finanzas` | **No — resets each invocation** |
| Discovery snapshots | file-store → `/tmp/app-finanzas` | **No — resets each invocation** |

**Not done yet**: CSV import persistence on Vercel (P0/P1). Alert history, watchlist, snapshots via KV (P1).

---

## What is already built

### P1 — Portfolio engine
- Universe: 24 seed stocks + ETFs, 18 extended (rotating batches on Vercel)
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
- Cron route: **now fails closed if CRON_SECRET missing (503)** — fixed in P0 branch
- 4 docs: PROJECT_STATE, CTO_BACKLOG, DECISIONS, RUNBOOK

---

## What is blocked

| Item | Blocker |
|---|---|
| Real prices in production | Set `PRICE_PROVIDER=yahoo` in Vercel |
| Persistent engine state | Set `KV_REST_API_URL` + `KV_REST_API_TOKEN` in Vercel |
| Cron protection | Set `CRON_SECRET` in Vercel (code fix already in P0 branch) |
| Alert delivery | Set `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` in Vercel |
| CSV persistence on Vercel | Not implemented yet — needs KV or separate DB (P0/P1) |
| Alert history persistence | file-store only → needs KV extension (P1) |
| Multi-source discovery | Smoke only; run GitHub Actions workflow with real keys first |

---

## Last relevant PRs

| PR | Title | State |
|---|---|---|
| #12 | P3-3f-0: Multi-source discovery capability smoke | Merged `3e095ae` |
| #11 | P3-3f-a: Rotating discovery scan batches | Merged `b7dda4a` |

---

## Test suite

```
npm test   →  19 suites · 1481 asserts · 0 failed
```
