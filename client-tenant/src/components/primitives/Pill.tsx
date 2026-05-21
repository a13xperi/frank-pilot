import type { ReactNode } from 'react';

export function Pill({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'success' | 'warn';
}) {
  const t =
    tone === 'success'
      ? 'bg-emerald-100 text-emerald-700'
      : tone === 'warn'
      ? 'bg-amber-100 text-amber-800'
      : 'bg-gray-100 text-gray-700';
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${t}`}>
      {children}
    </span>
  );
}
