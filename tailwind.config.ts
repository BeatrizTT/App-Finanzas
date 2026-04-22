import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // Dark dashboard palette
        bg: {
          primary: '#0f1117',
          secondary: '#161b27',
          card: '#1c2333',
          hover: '#222b3a',
          border: '#2a3445',
        },
        accent: {
          green: '#22c55e',
          'green-dim': '#16a34a',
          yellow: '#eab308',
          'yellow-dim': '#ca8a04',
          red: '#ef4444',
          'red-dim': '#dc2626',
          blue: '#3b82f6',
          'blue-dim': '#2563eb',
          purple: '#a855f7',
          orange: '#f97316',
          teal: '#14b8a6',
        },
        text: {
          primary: '#e2e8f0',
          secondary: '#94a3b8',
          muted: '#64748b',
          inverse: '#0f1117',
        },
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Fira Code', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [],
};

export default config;
