import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'App Finanzas — Personal Portfolio Intelligence',
  description: 'Personal investing dashboard with daily alerts and opportunity scanner',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="bg-[#0f1117] text-slate-200 min-h-screen antialiased">
        {children}
      </body>
    </html>
  );
}
