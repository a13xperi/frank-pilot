import type { ReactNode, HTMLAttributes } from 'react';

interface Props extends HTMLAttributes<HTMLDivElement> {
  variant?: 'mobile' | 'desktop';
  children: ReactNode;
}

export function Card({ variant = 'desktop', className = '', children, ...rest }: Props) {
  const base = 'overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-gray-200';
  return (
    <div data-variant={variant} className={`${base} ${className}`} {...rest}>
      {children}
    </div>
  );
}
