import type { ReactNode } from 'react';

export function Card({
  children,
  className = '',
  variant: _variant = 'mobile',
}: {
  children: ReactNode;
  className?: string;
  variant?: 'mobile' | 'desktop';
}) {
  return (
    <div className={`rounded-xl bg-white p-6 shadow-sm ${className}`}>
      {children}
    </div>
  );
}
