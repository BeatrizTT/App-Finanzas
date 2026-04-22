#!/usr/bin/env ts-node
// Standalone scheduler — runs the daily engine on a cron schedule
// Usage: npm run scheduler
// Keep this process running (e.g. with pm2, nohup, or a systemd service)
// Alternatively, use Vercel Cron or a cloud scheduler calling POST /api/engine/run

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

import cron from 'node-cron';
import { runDailyEngine } from '../src/lib/engine/daily-engine';

const cronExpression = process.env.SCHEDULER_CRON ?? '0 9 * * 1-5'; // Weekdays 9am
const timezone = process.env.SCHEDULER_TIMEZONE ?? 'Europe/Madrid';

console.log('=== App Finanzas — Scheduler Started ===');
console.log(`Schedule: ${cronExpression} (${timezone})`);
console.log(`Price provider: ${process.env.PRICE_PROVIDER ?? 'mock'}`);
console.log('Press Ctrl+C to stop\n');

// Validate cron expression
if (!cron.validate(cronExpression)) {
  console.error(`Invalid cron expression: ${cronExpression}`);
  console.error('Example valid expressions:');
  console.error('  "0 9 * * 1-5" = Weekdays at 9am');
  console.error('  "0 8,17 * * 1-5" = Weekdays at 8am and 5pm');
  process.exit(1);
}

let isRunning = false;

const task = cron.schedule(
  cronExpression,
  async () => {
    if (isRunning) {
      console.log('[Scheduler] Skipping run — previous run still in progress');
      return;
    }

    const now = new Date().toLocaleString('en-GB', { timeZone: timezone });
    console.log(`[Scheduler] Triggering engine run at ${now}`);
    isRunning = true;

    try {
      const output = await runDailyEngine({ sendDigest: true, sendAlertMessages: true });
      console.log(
        `[Scheduler] Run complete: ${output.alertsGenerated.length} alerts, ${output.errors.length} errors`
      );
    } catch (err) {
      console.error('[Scheduler] Engine run failed:', err);
    } finally {
      isRunning = false;
    }
  },
  {
    scheduled: true,
    timezone,
  }
);

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n[Scheduler] Shutting down...');
  task.stop();
  process.exit(0);
});

process.on('SIGTERM', () => {
  task.stop();
  process.exit(0);
});

console.log(`[Scheduler] Waiting for next scheduled run...`);
console.log(`[Scheduler] To run immediately, use: npm run engine\n`);
