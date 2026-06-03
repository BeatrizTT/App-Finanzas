# App Finanzas — Project State

Last updated: 2026-06-03 · Branch: `claude/p3-3f-0-multi-source-capability-smoke` (PR #12 open)

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
| Test runner | `npx tsx scripts/run-tests.ts` (not Jest) |
| Scripts | `npx tsx scripts/<name>.ts` |

---

## Active branch

`claude/p3-3f-0-multi-source-capability-smoke` — PR #12 open, ready to merge.

After merge, `main` will be the active production base.

---

## Production status

| Item | Status | Notes |
|---|---|---|
| App deployed on Vercel | ✓ | `main` auto-deploys |
| Vercel cron wired | ✓ | `vercel.json` — 07:00 + 16:00 UTC Mon-Fri |
| `CRON_SECRET` | ⚠ needs env var in Vercel dashboard | Code checks it, defaults open if unset |
| `PRICE_PROVIDER` | ⚠ needs `chain` or `yahoo` in Vercel env | Default is `mock` — **production is using mock prices** |
| `PRICE_PROVIDER_CHAIN` | defaults to `twelvedata,yahoo` | Set to `yahoo` to bypass Twelve Data |
| Vercel KV connected | ⚠ needs `KV_REST_API_URL` + `KV_REST_API_TOKEN` | Code exists; without KV, engine output is ephemeral in `/tmp` |
| Telegram configured | ⚠ needs `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` | Graceful degradation: logs to console |
| EODHD pricing | disabled | Requires `EODHD_ENABLED=true` + `EODHD_API_KEY`; not default |
| Discovery state (watchlist, snapshots) | ephemeral | Uses file-store → `/tmp` on Vercel; resets between invocations |
| Alert history | ephemeral | Same issue — file-store → `/tmp` |

**Summary: The app runs and processes but is currently using mock prices and has no persistent state across Vercel invocations. This must be fixed before the app produces real recommendations.**

---

## What is already built

### P1 — Portfolio engine
- Universe: 24 seed stocks + ETFs, 18 extended (rotating batches on Vercel)
- Pricing chain: mock → Yahoo → EODHD (optional) → Twelve Data (optional)
- FX: USD→EUR via Yahoo FX; GBX→GBP hardcoded conversion
- Scoring: `computeScore()` — technicals, drawdown, momentum, RSI-like
- Ranker: sorts by composite score, filters by price validity
- BUY / WATCH / HOLD / REDUCE / SELL signals with conviction and rationale
- Position sizer / allocator

### P2 — Pricing infrastructure
- `chain-provider.ts`: multi-provider fallback chain
- `price-cache.ts`: TTL-based in-memory cache (per invocation)
- `price-validation.ts`: staleness checks, null-safety
- `eodhd-provider.ts`: EODHD REST, gated behind `EODHD_ENABLED=true`
- `eodhd-symbol-config.ts`: curated mapping for 10 validated USD symbols
- FX safety: `suitableForExactPnl` / `suitableForBuyRecommendation` gates
- `pricing-method-display.ts`: human-readable source display in UI

### P3 — Discovery engine
- **P3-1**: EODHD symbol validation + curated config (10 symbols confirmed)
- **P3-2**: Pricing reliability + why-not-buy transparency
- **P3-3a**: Discovery snapshot persistence (`snapshots.ts`)
- **P3-3b**: Discovery snapshot persistence (file-store)
- **P3-3c**: Watchlist lifecycle (`watchlist.ts`)
- **P3-3d**: Alert triggers and dedupe (`alerts.ts`)
- **P3-3e**: Drawdown opportunity radar (`drawdown-radar.ts`)
- **P3-3f-a**: Rotating scan batches (`scan-cursor.ts`) — replaces `isVercel ? [] : extended`
- **P3-3f-0**: Multi-source capability smoke (`provider-capability.ts`, `smoke-discovery-providers.ts`)
  - GitHub Actions workflow: manual `workflow_dispatch` with optional secrets + anti-secret scan

### Infrastructure
- Vercel KV store (`engine-store.ts`): KV-first with file-store fallback
- Alert history (`history.ts`): dedupe + ring buffer
- Telegram sender (`telegram.ts`): graceful degradation
- Digest builder (`digest.ts`): daily summary format
- CSV portfolio importer (`csv-importer.ts`)
- EODHD symbol smoke workflow (`.github/workflows/eodhd-smoke.yml`)
- Multi-source capability smoke workflow (`.github/workflows/provider-capability-smoke.yml`)

---

## What is half-done / blocked

| Item | State | Blocker |
|---|---|---|
| Real prices in production | Blocked | `PRICE_PROVIDER` env var not set in Vercel; default is `mock` |
| Persistent KV state | Blocked | `KV_REST_API_URL` / `KV_REST_API_TOKEN` not set in Vercel |
| Alert delivery via Telegram | Blocked | `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` not set in Vercel |
| Discovery state persistence | Partial | Watchlist/snapshots use file-store → ephemeral on Vercel; KV extension needed |
| Multi-source discovery provider | Smoke only | Smoke shows `missing_key` for all external providers; need to run GitHub Actions workflow with real keys to decide which provider to integrate |
| ExternalCandidate schema (P3-3f-b) | Not started | Depends on smoke results from PR #12 workflow |
| EODHD screener connector (P3-3f-c) | Not started | Depends on smoke confirming EODHD plan supports screener |
| `CRON_SECRET` | Not enforced | Code reads it but falls back to open if unset |
| EODHD as pricing default | Blocked by policy | "No tocar todavía: EODHD default" — intentionally deferred |

---

## Last relevant PR

**PR #12** — P3-3f-0: Multi-source discovery capability smoke
- Branch: `claude/p3-3f-0-multi-source-capability-smoke`
- State: **open, ready to merge**
- Adds: `provider-capability.ts`, `smoke-discovery-providers.ts`, `provider-capability.test.ts`, `provider-capability-smoke.yml`
- After merge: set GitHub Secrets, run workflow manually, decide next provider

---

## Test suite

```
npm test   →  18 suites · 1474 asserts · 0 failed
```

Covers: pricing chain, FX, scoring, allocator, discovery (watchlist, snapshots, alerts, radar, scan cursor, provider capability).
