import type { HTMLAttributes, ReactNode } from 'react';
import { HF } from '@/styles/tokens';

export interface TopBarProps extends HTMLAttributes<HTMLElement> {
  variant?: 'mobile' | 'desktop';
  leading?: ReactNode;
  trailing?: ReactNode;
  children?: ReactNode;
}

/**
 * TopBar — sticky top header. 56px mobile, 64px desktop.
 */
export function TopBar({
  variant = 'mobile',
  leading,
  trailing,
  className = '',
  children,
  ...rest
}: TopBarProps) {
  const h = variant === 'desktop' ? 'h-16' : 'h-14';
  return (
    <header
      data-variant={variant}
      className={`sticky top-0 z-30 flex items-center gap-3 px-4 ${h} ${className}`}
      style={{
        background: HF.paper,
        borderBottom: `1px solid ${HF.border}`,
        fontFamily: HF.body,
        color: HF.ink,
      }}
      {...rest}
    >
      {leading}
      <div className="flex-1 min-w-0 truncate" style={{ fontFamily: HF.display, fontWeight: 600 }}>
        {children}
      </div>
      {trailing}
    </header>
  );
}

export default TopBar;
