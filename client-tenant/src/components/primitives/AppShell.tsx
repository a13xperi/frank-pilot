import type { HTMLAttributes, ReactNode } from 'react';
import { HF } from '@/styles/tokens';

export interface AppShellProps extends HTMLAttributes<HTMLDivElement> {
  variant?: 'mobile' | 'desktop';
  sidebar?: ReactNode;
  topBar?: ReactNode;
  bottomBar?: ReactNode;
  children?: ReactNode;
}

/**
 * AppShell — outermost frame. Composes TopBar + Sidebar + main + BottomBar.
 * Mobile-first; on `lg:` (or desktop variant) sidebar shows, bottom bar hides.
 */
export function AppShell({
  variant,
  sidebar,
  topBar,
  bottomBar,
  className = '',
  children,
  ...rest
}: AppShellProps) {
  const isDesktop = variant === 'desktop';
  return (
    <div
      data-variant={variant ?? 'auto'}
      className={`min-h-screen flex flex-col ${className}`}
      style={{ background: HF.cream, color: HF.ink, fontFamily: HF.body }}
      {...rest}
    >
      {topBar}
      <div className={`flex flex-1 ${isDesktop ? 'flex-row' : 'flex-col lg:flex-row'}`}>
        {sidebar && (
          <aside
            className={`${isDesktop ? 'block' : 'hidden lg:block'} shrink-0`}
            style={{ borderRight: `1px solid ${HF.border}`, background: HF.paper }}
          >
            {sidebar}
          </aside>
        )}
        <main className="flex-1 min-w-0">{children}</main>
      </div>
      {bottomBar && (
        <div className={isDesktop ? 'hidden' : 'lg:hidden'}>{bottomBar}</div>
      )}
    </div>
  );
}

export default AppShell;
