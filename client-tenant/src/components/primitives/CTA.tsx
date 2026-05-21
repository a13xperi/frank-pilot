import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { HF } from '@/styles/tokens';

export type CTATone = 'primary' | 'secondary' | 'ghost' | 'sage';
export type CTASize = 'sm' | 'md' | 'lg';

export interface CTAProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'mobile' | 'desktop';
  tone?: CTATone;
  size?: CTASize;
  /** Stretch to full width — defaults to true on mobile variant. */
  block?: boolean;
  children?: ReactNode;
}

const sizeMap: Record<CTASize, { px: number; py: number; fs: number }> = {
  sm: { px: 12, py: 6, fs: 13 },
  md: { px: 16, py: 10, fs: 14 },
  lg: { px: 20, py: 14, fs: 16 },
};

const toneStyle = (tone: CTATone): { bg: string; fg: string; border: string; shadow: string } => {
  switch (tone) {
    case 'primary':
      return {
        bg: HF.accent,
        fg: HF.paper,
        border: HF.accent,
        shadow: '0 1px 0 rgba(255,255,255,0.2) inset, 0 2px 6px rgba(201, 73, 42, 0.25)',
      };
    case 'sage':
      return {
        bg: HF.sage,
        fg: HF.paper,
        border: HF.sage,
        shadow: '0 2px 6px rgba(92, 122, 79, 0.25)',
      };
    case 'ghost':
      return { bg: 'transparent', fg: HF.ink, border: 'transparent', shadow: 'none' };
    case 'secondary':
    default:
      return { bg: HF.paper, fg: HF.ink, border: HF.border, shadow: HF.shadow.xs };
  }
};

/**
 * CTA — primary call-to-action button. Mobile variant defaults `block=true`.
 */
export function CTA({
  variant,
  tone = 'primary',
  size = 'md',
  block,
  className = '',
  style,
  children,
  ...rest
}: CTAProps) {
  const s = sizeMap[size];
  const t = toneStyle(tone);
  const isBlock = block ?? variant === 'mobile';
  return (
    <button
      data-variant={variant ?? 'auto'}
      data-tone={tone}
      className={`inline-flex items-center justify-center gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${isBlock ? 'w-full' : ''} ${className}`}
      style={{
        background: t.bg,
        color: t.fg,
        border: `1px solid ${t.border}`,
        borderRadius: HF.r.md,
        padding: `${s.py}px ${s.px}px`,
        fontSize: s.fs,
        fontWeight: 600,
        fontFamily: HF.body,
        boxShadow: t.shadow,
        cursor: 'pointer',
        ...style,
      }}
      {...rest}
    >
      {children}
    </button>
  );
}

export default CTA;
