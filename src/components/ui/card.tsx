'use client';

import React from 'react';

export function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-[#1c2333] border border-[#2a3445] rounded-lg ${className}`}>
      {children}
    </div>
  );
}

export function CardHeader({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`px-4 py-3 border-b border-[#2a3445] flex items-center justify-between ${className}`}>
      {children}
    </div>
  );
}

export function CardTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="text-sm font-semibold text-slate-200 uppercase tracking-wide">{children}</h2>;
}

export function CardBody({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`p-4 ${className}`}>{children}</div>;
}

export function DrawdownDisplay({ d30, d60, d90 }: { d30: number; d60: number; d90: number }) {
  const color = (v: number) => v > 20 ? 'text-green-400' : v > 10 ? 'text-yellow-400' : v > 5 ? 'text-orange-400' : 'text-slate-400';
  return (
    <div className="flex gap-3 text-xs">
      <span className={color(d30)}>30d: -{d30.toFixed(1)}%</span>
      <span className={color(d60)}>60d: -{d60.toFixed(1)}%</span>
      <span className={color(d90)}>90d: -{d90.toFixed(1)}%</span>
    </div>
  );
}

export function SectionEmpty({ message }: { message: string }) {
  return (
    <div className="py-6 text-center text-slate-500 text-sm">
      {message}
    </div>
  );
}
