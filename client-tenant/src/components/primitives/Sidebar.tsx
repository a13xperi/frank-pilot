import type { HTMLAttributes, ReactNode } from 'react';
import { HF } from '@/styles/tokens';

export interface SidebarProps extends HTMLAttributes<HTMLElement> {
  variant?: 'mobile' | 'desktop';
  children?: ReactNode;
}

/**
 * Sidebar — vertical nav rail. Mobile variant collapses to drawer-ready
 * full-width; desktop variant is fixed ~240px column.
 */
export function Sidebar({
  variant = 'desktop',
  className = '',
  children,
  ...rest
}: SidebarProps) {
  const isMobile = variant === 'mobile';
  return (
    <nav
      data-variant={variant}
      className={`flex flex-col gap-1 p-4 ${isMobile ? 'w-full' : 'w-60 min-h-full'} ${className}`}
      style={{ background: HF.paper, color: HF.ink, fontFamily: HF.body }}
      {...rest}
    >
      {children}
    </nav>
  );
}

export default Sidebar;
