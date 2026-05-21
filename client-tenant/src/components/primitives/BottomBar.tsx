import type { ReactNode } from 'react';

interface Props {
  variant?: 'mobile' | 'desktop';
  children: ReactNode;
  className?: string;
}

export function BottomBar({ variant = 'mobile', children, className = '' }: Props) {
  return (
    <div
      data-variant={variant}
      className={`sticky bottom-0 left-0 right-0 border-t border-gray-200 bg-white px-4 py-3 shadow-[0_-4px_12px_rgba(0,0,0,0.04)] ${className}`}
      style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 12px)' }}
    >
      {children}
    </div>
  );
}
