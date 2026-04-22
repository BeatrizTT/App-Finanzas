/** @type {import('next').NextConfig} */
const nextConfig = {
  // Mark heavy Node.js packages as external so Next.js (Turbopack) doesn't bundle them
  serverExternalPackages: [
    'yahoo-finance2',
    'node-telegram-bot-api',
    'node-cron',
  ],
  // Silence Turbopack warning (no custom webpack config needed)
  turbopack: {},
  env: {
    NEXT_PUBLIC_APP_NAME: 'App Finanzas',
  },
};

module.exports = nextConfig;
