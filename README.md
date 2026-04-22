# App Finanzas — Personal Portfolio Intelligence System

A production-ready personal investing app that monitors your portfolio, detects opportunities in stocks and ETFs, manages concentration risk, and sends daily Telegram alerts.

**This is NOT a generic finance dashboard.** It is a personal portfolio intelligence system designed to help you answer:

- What in my portfolio deserves adding to right now?
- Which stocks or ETFs outside my portfolio are strong opportunities?
- Am I getting too concentrated in one sector?
- How much cash should I deploy today, and where?

---

## Quick Start

### Step 1 — Install dependencies

```bash
npm install
```

### Step 2 — Create your environment file

```bash
cp .env.example .env.local
```

Open `.env.local` and review the settings. The defaults work out of the box in mock mode (no internet needed).

### Step 3 — Test the engine locally (no internet needed)

```bash
npm run test:local
```

This runs the full engine with mock price data and prints the analysis to the terminal. It also saves results to `src/data/engine-output.json`.

### Step 4 — Start the dashboard

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

Click **Run Engine** in the top right to see your portfolio analysis and opportunities.

---

## Configuration

All settings are in the `config/` folder. **No code changes needed** to customize behavior.

### Your Portfolio — `config/portfolio.json`

Edit this file to match your actual holdings:

```json
{
  "cashAvailableEur": 5000,
  "targetCashReserveEur": 1000,
  "holdings": [
    {
      "id": "nvda",
      "name": "NVIDIA Corporation",
      "ticker": "NVDA",
      "type": "stock",
      "dcaMonthlyEur": 128,
      "avgPrice": 157.81,
      "units": 10,
      "core": true,
      "convictionScore": 9,
      "tags": ["semis", "AI", "growth"]
    }
  ]
}
```

Key fields:
- `cashAvailableEur` — How much cash you currently have available to invest
- `targetCashReserveEur` — Minimum cash to always keep (never deployed)
- `convictionScore` — Your personal 1-10 conviction score for each asset
- `dcaMonthlyEur` — Set to 0 if you are not doing monthly DCA on this asset
- `core` — `true` for long-term core holdings, `false` for satellites
- `noBuyOverride` — Set to `true` to temporarily block buy signals for this asset

### Rules — `config/rules.json`

Controls when the engine says BUY vs WAIT:

- **drawdownZones** — What state to assign based on drawdown percentage
- **concentration** — Maximum allowed weights per sector and theme

### Opportunity Universe — `config/universe.json`

Two layers:
1. **Seed universe** (`seedStocks`, `seedEtfs`) — Your priority watchlist, scanned every day
2. **Extended universe** (`extendedStocks`, `extendedEtfs`) — Broader discovery candidates that must pass strict quality gates before being surfaced

Add any ticker to either list to include it in the scanner.

### Scoring Weights — `config/scoring-weights.json`

Tune how opportunities are ranked. All weights must sum to 1.0.

Example: to prioritize ETFs that improve diversification, increase `diversificationFit`.

### Capital Allocation — `config/allocation.json`

Controls trade sizes. `deployableAmounts` sets which cash levels to show recommendations for.

### Manual Overrides — `config/overrides.json`

- `marketRegime` — Set to `"bullish"`, `"neutral"`, or `"bearish"` to adjust all scores
- `globalNoBuy` — Set to `true` to suppress all buy signals during extreme uncertainty
- `overrides` — Array of per-asset overrides (no_buy, thesis_risk, etc.)

---

## Using Real Price Data

By default the app uses **mock data** (realistic but simulated). To use real prices:

1. In `.env.local`, set:
   ```
   PRICE_PROVIDER=yahoo
   MOCK_MODE=false
   ```

2. Run the engine:
   ```bash
   npm run engine
   ```

The app uses [yahoo-finance2](https://github.com/gadicc/node-yahoo-finance2) which is free with no API key. Note: Yahoo Finance data may have 15-minute delays and occasional failures. The engine handles errors gracefully.

---

## Setting Up Telegram Alerts

1. Open Telegram and message `@BotFather`
2. Send `/newbot` and follow the prompts to create your bot
3. Copy the bot token (format: `123456789:ABCdefGHIjklMNOpqrSTUvwxYZ`)
4. Start a chat with your new bot (just send any message to it)
5. Get your chat ID: open `https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates` in a browser
6. Copy the `"id"` number from the `"chat"` section of the result

Add to `.env.local`:
```
TELEGRAM_BOT_TOKEN=your_bot_token_here
TELEGRAM_CHAT_ID=your_chat_id_here
```

Run the engine once to verify:
```bash
npm run engine
```

You should receive a daily digest message on Telegram.

---

## Running the Daily Scheduler

The app can run automatically every weekday morning:

```bash
npm run scheduler
```

This starts a background process that runs the engine at the time configured in `SCHEDULER_CRON` (default: `0 9 * * 1-5` = weekdays at 9am European time).

**To keep it running permanently**, use [PM2](https://pm2.keymetrics.io/):

```bash
npm install -g pm2
pm2 start "npm run scheduler" --name app-finanzas
pm2 save
pm2 startup
```

### Vercel / Cloud Deployment

You can deploy to Vercel and use Vercel Cron Jobs to call `POST /api/engine/run` each weekday morning. The JSON state files are stored locally — for a pure cloud deployment, this would need a lightweight database.

---

## How the Three Engines Work

### 1. CORE_PORTFOLIO_ENGINE

Analyzes your existing holdings using:
- Current price vs recent 30/60/90-day highs (drawdown calculation)
- Your conviction score and DCA activity
- Concentration risk in your portfolio
- Manual thesis risk flags

Outputs: `DO_NOTHING`, `WAIT`, `BUY_SMALL`, `BUY_PARTIAL`, `BUY_MORE`, `REVIEW`, `REDUCE`

### 2. OPPORTUNITY_SCANNER

Scans your priority watchlist AND a broader filtered universe to find:
- Stocks and ETFs in meaningful pullbacks
- Assets with strong quality scores
- Setups that improve portfolio balance (especially ETFs that reduce concentration)

Outputs: `BUY`, `READY_TO_BUY`, `WATCH`, `HOLD`, `REVIEW_FOR_TRIM`, `EXIT`, `AVOID`

The scanner also runs a **discovery engine** over the extended universe. Non-seed assets must pass strict quality gates (liquidity, quality, volatility, portfolio fit, risk-reward, not speculative) before being surfaced.

### 3. CAPITAL_ALLOCATOR

Compares all current opportunities and ranks the best use of fresh cash. Shows recommendations for €500, €1000, and €2000 deployment sizes.

---

## Decision States Reference

| State | Meaning |
|-------|---------|
| `BUY_MORE` | Strong buy signal — meaningful drawdown, high conviction |
| `BUY_PARTIAL` | Add with normal size — drawdown in the right zone |
| `BUY_SMALL` | Small entry — early signal or concentration concern |
| `WAIT` | Wait for better price |
| `DO_NOTHING` | Near highs, no action needed |
| `REVIEW` | Check thesis before adding |
| `REDUCE` | Consider reducing this position |
| `BUY` | Strong new opportunity |
| `READY_TO_BUY` | Almost ready — monitor closely |
| `WATCH` | Interesting but too early |
| `REVIEW_FOR_TRIM` | Move may be played out |
| `EXIT` | Setup broken |
| `AVOID` | Poor quality or poor fit |

---

## Project Structure

```
config/                     All tunable settings
  portfolio.json            Your holdings, DCA, conviction
  rules.json                Drawdown zones, concentration limits
  universe.json             Seed + extended watchlist
  scoring-weights.json      Opportunity scoring weights
  allocation.json           Trade sizing
  overrides.json            Manual overrides, market regime

src/
  app/                      Next.js pages and API routes
  components/               Dashboard UI components
  lib/
    types/                  All TypeScript types
    pricing/                Price providers (mock + Yahoo Finance)
    portfolio/              CORE_PORTFOLIO_ENGINE
    scanner/                OPPORTUNITY_SCANNER
    allocator/              CAPITAL_ALLOCATOR
    alerts/                 Alert generation and Telegram
    engine/                 Daily engine orchestrator
    ranking/                Sorting and ranking helpers
    utils/                  Math, config loader, file store
  data/                     JSON state files (auto-managed)

scripts/
  run-engine.ts             CLI: run engine once
  scheduler.ts              CLI: run on a cron schedule
  test-local.ts             CLI: test with mock data
```

---

## Important Notes

- **No auto-trading**: The app never executes trades. All decisions are yours.
- **No financial advice**: This is a personal tool for personal use only.
- **Mock mode is safe**: The default mock mode never calls any external API.
- **Config-driven**: Change any threshold, weight, or limit through config files without touching code.
- **Discovery is filtered**: Extended universe assets go through strict quality gates before surfacing.

---

## Troubleshooting

**Engine runs but shows no opportunities:**
- The drawdown thresholds may not be met by current mock prices
- Try reducing `minDrawdownForOpportunity` in `config/rules.json`
- In mock mode, some assets are seeded with low drawdowns intentionally

**Telegram not working:**
- Verify both `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` are set in `.env.local`
- Make sure you sent at least one message to your bot before getting the chat ID
- Check the console output for specific error messages

**Yahoo Finance errors:**
- Yahoo Finance has rate limits and occasional downtime
- The engine handles failures gracefully and continues with whatever prices are available
- Try again later or set `MOCK_MODE=true` temporarily

**`Cannot find module` errors:**
- Run `npm install` to install all dependencies
- Make sure you are using Node.js 18 or newer: `node --version`
