import type { ReactNode } from 'react';

type Tone = 'ok' | 'warn' | 'err' | 'accent' | 'neutral';

interface Props {
  tone?: Tone;
  children: ReactNode;
  className?: string;
}

const toneClasses: Record<Tone, string> = {
  ok: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  warn: 'bg-amber-50 text-amber-800 ring-amber-200',
  err: 'bg-rose-50 text-rose-800 ring-rose-200',
  accent: 'bg-orange-50 text-orange-800 ring-orange-200',
  neutral: 'bg-gray-100 text-gray-700 ring-gray-200',
};

export function Pill({ tone = 'neutral', children, className = '' }: Props) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${toneClasses[tone]} ${className}`}
    >
      {children}
    </span>
  );
}
