import type { HTMLAttributes, ReactNode } from 'react';
import { HF } from '@/styles/tokens';

export interface BottomBarProps extends HTMLAttributes<HTMLElement> {
  variant?: 'mobile' | 'desktop';
  children?: ReactNode;
}

/**
 * BottomBar — sticky bottom action / nav bar (mobile-only by default).
 * On desktop variant, renders as a normal footer row.
 */
export function BottomBar({
  variant = 'mobile',
  className = '',
  children,
  ...rest
}: BottomBarProps) {
  const sticky = variant === 'mobile' ? 'sticky bottom-0 z-30' : '';
  return (
    <footer
      data-variant={variant}
      className={`${sticky} flex items-center gap-3 px-4 py-3 ${className}`}
      style={{
        background: HF.paper,
        borderTop: `1px solid ${HF.border}`,
        fontFamily: HF.body,
        color: HF.ink,
        boxShadow: variant === 'mobile' ? HF.shadow.sm : 'none',
      }}
      {...rest}
    >
      {children}
    </footer>
  );
}

export default BottomBar;
