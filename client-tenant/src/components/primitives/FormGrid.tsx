import type { HTMLAttributes, ReactNode } from 'react';
import { HF } from '@/styles/tokens';

export interface FormGridProps extends HTMLAttributes<HTMLDivElement> {
  variant?: 'mobile' | 'desktop';
  /** Desktop column count. Default 2. Mobile is always 1. */
  columns?: 1 | 2 | 3;
  children?: ReactNode;
}

/**
 * FormGrid — responsive form layout. 1 col mobile, N cols desktop (default 2).
 */
export function FormGrid({
  variant,
  columns = 2,
  className = '',
  children,
  ...rest
}: FormGridProps) {
  const forceMobile = variant === 'mobile';
  const forceDesktop = variant === 'desktop';
  const cols = forceMobile
    ? 'grid-cols-1'
    : forceDesktop
    ? columns === 3
      ? 'grid-cols-3'
      : columns === 2
      ? 'grid-cols-2'
      : 'grid-cols-1'
    : columns === 3
    ? 'grid-cols-1 lg:grid-cols-3'
    : columns === 2
    ? 'grid-cols-1 lg:grid-cols-2'
    : 'grid-cols-1';
  return (
    <div
      className={`grid gap-4 ${cols} ${className}`}
      style={{ fontFamily: HF.body, color: HF.ink }}
      {...rest}
    >
      {children}
    </div>
  );
}

export default FormGrid;
