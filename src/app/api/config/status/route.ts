import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({
    priceProvider: process.env.PRICE_PROVIDER ?? 'mock',
    telegramConfigured: !!(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID),
    cronSecretSet: !!process.env.CRON_SECRET,
    isVercel: !!process.env.VERCEL,
  });
}
