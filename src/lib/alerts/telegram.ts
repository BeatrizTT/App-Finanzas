// Telegram alert sender
// Configure with TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in .env.local
// If not configured, alerts are logged to console only (graceful degradation)

import type { Alert } from '../types';

// Lazy-load Telegram bot to avoid errors when not configured
let _bot: import('node-telegram-bot-api') | null = null;

function getTelegramBot(): import('node-telegram-bot-api') | null {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return null;

  if (!_bot) {
    try {
      // Dynamic import to avoid build issues when package not available
      const TelegramBot = require('node-telegram-bot-api');
      _bot = new TelegramBot(token, { polling: false });
    } catch {
      console.warn('[Telegram] node-telegram-bot-api not available');
      return null;
    }
  }
  return _bot;
}

function getChatId(): string | null {
  return process.env.TELEGRAM_CHAT_ID ?? null;
}

// Telegram has a 4096 character limit per message
const MAX_MESSAGE_LENGTH = 4000;

function splitMessage(text: string): string[] {
  if (text.length <= MAX_MESSAGE_LENGTH) return [text];
  const parts: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    parts.push(remaining.slice(0, MAX_MESSAGE_LENGTH));
    remaining = remaining.slice(MAX_MESSAGE_LENGTH);
  }
  return parts;
}

export async function sendTelegramMessage(message: string): Promise<boolean> {
  const bot = getTelegramBot();
  const chatId = getChatId();

  if (!bot || !chatId) {
    console.log('[Telegram] Not configured — logging alert to console:');
    console.log(message);
    return false;
  }

  try {
    const parts = splitMessage(message);
    for (const part of parts) {
      await bot.sendMessage(chatId, part, { parse_mode: 'Markdown' });
    }
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[Telegram] Failed to send message: ${msg}`);
    return false;
  }
}

export async function sendAlert(alert: Alert): Promise<boolean> {
  const sent = await sendTelegramMessage(alert.message);
  return sent;
}

export async function sendAlerts(alerts: Alert[]): Promise<Alert[]> {
  const sent: Alert[] = [];
  for (const alert of alerts) {
    const success = await sendAlert(alert);
    sent.push({ ...alert, telegramSent: success });
    // Small delay between messages to avoid Telegram rate limiting
    if (alerts.length > 1) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  return sent;
}

export function isTelegramConfigured(): boolean {
  return !!(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);
}
