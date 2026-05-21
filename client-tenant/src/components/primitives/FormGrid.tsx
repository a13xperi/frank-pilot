import type { ReactNode } from 'react';

export function FormGrid({
  children,
  cols = 2,
  className = '',
}: {
  children: ReactNode;
  cols?: 1 | 2 | 3;
  className?: string;
}) {
  const colClass =
    cols === 3
      ? 'grid-cols-1 lg:grid-cols-3'
      : cols === 2
      ? 'grid-cols-1 lg:grid-cols-2'
      : 'grid-cols-1';
  return <div className={`grid ${colClass} gap-3 ${className}`}>{children}</div>;
}
