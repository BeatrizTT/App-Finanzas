# Deploying Your App on Railway — Step by Step

> **Who this is for:** someone who has never used a terminal and wants the app running 24/7 without their laptop on.
> **Time needed:** ~15 minutes the first time.
> **What you need:** a GitHub account (free) and a Railway account (free tier is enough to start).

---

## Overview

You will end up with **two services** inside a single Railway project:

| Service | What it does |
|---|---|
| **web** | Hosts the dashboard you open in your browser |
| **scheduler** | Runs the engine every morning and sends Telegram alerts |

Both run in the cloud 24/7 — your laptop can be off.

---

## Part 1 — Create a Railway account

1. Open **[railway.app](https://railway.app)** in your browser.
2. Click **"Start a New Project"** or **"Login"**.
3. Choose **"Login with GitHub"** and follow the prompts.
   - If you don't have a GitHub account yet, create one for free at **[github.com](https://github.com)** first — it only takes 2 minutes.

---

## Part 2 — Deploy the dashboard (web service)

1. Once logged in to Railway, click the big **"+ New Project"** button.
2. Choose **"Deploy from GitHub repo"**.
3. Railway will ask for permission to access your GitHub. Click **"Configure GitHub App"** and select the repository **`App-Finanzas`**. Click **Save**.
4. Back in Railway, your repo will appear in the list. Click it.
5. Railway auto-detects it is a Node.js app and starts building. A progress bar will appear — wait for it to finish (usually 2–4 minutes).
6. When it says **"Deployment successful"**, click the service box, then go to the **"Settings"** tab.
7. Scroll down to **"Networking"** → click **"Generate Domain"**.
8. Copy the URL that appears (something like `app-finanzas-production.up.railway.app`). **This is your live dashboard URL.**

---

## Part 3 — Add a persistent volume (so the app remembers its state)

The app saves files like `alert-history.json` and `engine-output.json` inside the `src/data/` folder. Without a volume, those files disappear every time Railway restarts the app. The volume fixes that.

1. In your Railway project, click on the **web** service.
2. Click the **"Volumes"** tab in the left sidebar.
3. Click **"+ New Volume"**.
4. Fill in:
   - **Mount path:** `/app/src/data`
   - **Size:** leave the default (1 GB is plenty)
5. Click **"Create"**. Railway will redeploy the service — wait for it to finish.

---

## Part 4 — Set your environment variables

Environment variables are the app's private settings (API keys, etc.). They are never stored in the code.

1. Click on the **web** service → **"Variables"** tab.
2. Click **"+ New Variable"** for each of the following:

| Variable name | What to put |
|---|---|
| `PRICE_PROVIDER` | `yahoo` |
| `TELEGRAM_BOT_TOKEN` | Your Telegram bot token (see below) |
| `TELEGRAM_CHAT_ID` | Your Telegram chat ID (see below) |
| `ALERT_COOLDOWN_HOURS` | `24` |
| `CRON_TIMEZONE` | Your timezone, e.g. `Europe/Madrid` |
| `NODE_ENV` | `production` |

3. Click **"Save"** after adding all variables. The service will redeploy.

### How to get your Telegram bot token and chat ID

**Step A — Create a bot:**
1. Open Telegram on your phone or computer.
2. Search for **@BotFather** and start a chat.
3. Send `/newbot` and follow its instructions (give the bot a name and username).
4. BotFather will send you a token like `7123456789:AAFxxxxxx`. Copy it — this is your `TELEGRAM_BOT_TOKEN`.

**Step B — Find your chat ID:**
1. Start a chat with your new bot (search for it by the username you chose).
2. Send it any message (e.g. "hello").
3. Open this URL in your browser, replacing `YOUR_TOKEN` with your real token:
   ```
   https://api.telegram.org/botYOUR_TOKEN/getUpdates
   ```
4. Look for `"chat":{"id":` in the response. The number after it (e.g. `123456789`) is your `TELEGRAM_CHAT_ID`.

---

## Part 5 — Add the scheduler (daily alerts)

The scheduler is a separate process that runs the investment engine every weekday morning. It needs its own Railway service.

1. In your Railway project page, click **"+ New"** → **"GitHub Repo"** → select the same `App-Finanzas` repo again.
2. After it deploys, click on the new service → **"Settings"** tab.
3. Find **"Start Command"** and change it to:
   ```
   npm run scheduler
   ```
4. Click **"Save"**. Railway will redeploy with the new command.
5. Go to the **"Variables"** tab of this **scheduler** service and add the **exact same variables** as in Part 4 above (all 6 of them).
6. Go to the **"Volumes"** tab and mount a volume at `/app/src/data` — same as Part 3 — so both services share the same data folder.

> **Tip:** In the Railway dashboard you can rename the two services to "web" and "scheduler" so you can tell them apart. Click the three-dot menu on each service → "Rename".

---

## Part 6 — Check everything works

1. Open your dashboard URL (from Part 2, Step 8) in your browser.
2. Click the **"Run Engine"** button on the page. After a few seconds, data will appear in the tabs.
3. If you set up Telegram correctly, you should receive a message from your bot within a minute.

That's it! From now on the scheduler will run automatically every weekday morning at 09:00 in your timezone and send you a Telegram digest.

---

## Updating the app later

Whenever new code is pushed to GitHub, Railway will automatically rebuild and redeploy — you don't need to do anything. Your data volume is untouched during redeployments.

---

## Costs

| What | Price |
|---|---|
| Railway Hobby plan | $5/month (covers both services + volume) |
| Telegram | Free |
| Yahoo Finance (price data) | Free |

The free Railway tier gives 500 hours/month, which isn't enough for two always-on services. The Hobby plan ($5/month) covers everything.

---

## Need help?

If something doesn't look right, check the **"Logs"** tab of each Railway service — it shows exactly what the app is doing and any error messages.
