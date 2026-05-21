import type { HTMLAttributes, ReactNode } from 'react';
import { HF } from '@/styles/tokens';

export type PillTone = 'neutral' | 'accent' | 'sage' | 'ok' | 'warn' | 'err';

export interface PillProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: 'mobile' | 'desktop';
  tone?: PillTone;
  children?: ReactNode;
}

const toneMap: Record<PillTone, { bg: string; fg: string; border: string }> = {
  neutral: { bg: HF.paper, fg: HF.ink2, border: HF.border },
  accent:  { bg: HF.accentLo, fg: HF.accentInk, border: '#F3D7CB' },
  sage:    { bg: HF.sageLo, fg: HF.sage, border: '#D7E2CF' },
  ok:      { bg: HF.okLo, fg: HF.ok, border: '#CBE3C5' },
  warn:    { bg: HF.warnLo, fg: HF.warn, border: '#EAD9A8' },
  err:     { bg: HF.errLo, fg: HF.err, border: '#EFC6BE' },
};

/**
 * Pill — small chip/tag/status indicator.
 */
export function Pill({
  variant,
  tone = 'neutral',
  className = '',
  style,
  children,
  ...rest
}: PillProps) {
  const t = toneMap[tone];
  return (
    <span
      data-variant={variant ?? 'auto'}
      data-tone={tone}
      className={`inline-flex items-center gap-1 ${className}`}
      style={{
        background: t.bg,
        color: t.fg,
        border: `1px solid ${t.border}`,
        borderRadius: HF.r.pill,
        padding: '2px 10px',
        fontSize: 12,
        fontWeight: 600,
        fontFamily: HF.body,
        lineHeight: 1.4,
        ...style,
      }}
      {...rest}
    >
      {children}
    </span>
  );
}

export default Pill;
