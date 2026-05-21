import type { HTMLAttributes, ReactNode } from 'react';
import { HF } from '@/styles/tokens';

export interface TwoPaneProps extends HTMLAttributes<HTMLDivElement> {
  variant?: 'mobile' | 'desktop';
  left: ReactNode;
  right: ReactNode;
  /** Left pane width (desktop only). Default `320px`. */
  leftWidth?: number | string;
}

/**
 * TwoPane — left rail + right detail. Mobile: stacked. Desktop: side-by-side.
 */
export function TwoPane({
  variant,
  left,
  right,
  leftWidth = 320,
  className = '',
  ...rest
}: TwoPaneProps) {
  const forceDesktop = variant === 'desktop';
  const forceMobile = variant === 'mobile';
  const layout = forceDesktop
    ? 'flex flex-row'
    : forceMobile
    ? 'flex flex-col'
    : 'flex flex-col lg:flex-row';
  return (
    <div className={`${layout} gap-4 p-4 ${className}`} style={{ color: HF.ink }} {...rest}>
      <div
        className={forceDesktop ? '' : forceMobile ? 'w-full' : 'w-full lg:shrink-0'}
        style={forceMobile ? undefined : { width: forceDesktop ? leftWidth : undefined }}
      >
        {left}
      </div>
      <div className="flex-1 min-w-0">{right}</div>
    </div>
  );
}

export default TwoPane;
