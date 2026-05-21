import type { HTMLAttributes, ReactNode } from 'react';
import { HF } from '@/styles/tokens';

export interface ListRowProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  variant?: 'mobile' | 'desktop';
  leading?: ReactNode;
  trailing?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  /** Render as a Link-shaped row (cursor, hover). Default false. */
  interactive?: boolean;
}

/**
 * ListRow — horizontal row used in sidebars, settings, picker lists.
 * Mobile: larger touch target. Desktop: tighter density.
 */
export function ListRow({
  variant = 'mobile',
  leading,
  trailing,
  title,
  subtitle,
  interactive = false,
  className = '',
  style,
  ...rest
}: ListRowProps) {
  const pad = variant === 'desktop' ? '8px 12px' : '12px 14px';
  return (
    <div
      data-variant={variant}
      className={`flex items-center gap-3 ${interactive ? 'cursor-pointer' : ''} ${className}`}
      style={{
        background: HF.paper,
        border: `1px solid ${HF.border}`,
        borderRadius: HF.r.md,
        padding: pad,
        color: HF.ink,
        fontFamily: HF.body,
        ...style,
      }}
      {...rest}
    >
      {leading && <div className="shrink-0">{leading}</div>}
      <div className="flex-1 min-w-0">
        <div className="truncate" style={{ fontWeight: 600, fontSize: 14 }}>{title}</div>
        {subtitle && (
          <div className="truncate" style={{ color: HF.ink3, fontSize: 12, marginTop: 2 }}>
            {subtitle}
          </div>
        )}
      </div>
      {trailing && <div className="shrink-0">{trailing}</div>}
    </div>
  );
}

export default ListRow;
