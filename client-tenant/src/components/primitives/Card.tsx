import type { HTMLAttributes, ReactNode } from 'react';
import { HF } from '@/styles/tokens';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: 'mobile' | 'desktop';
  /** Elevation. Default `sm`. */
  elevation?: 'none' | 'xs' | 'sm' | 'md' | 'lg';
  /** Inner padding (px). Default 16. */
  padding?: number;
  children?: ReactNode;
}

/**
 * Card — surface container with HF warm-white background, border, shadow.
 */
export function Card({
  variant,
  elevation = 'sm',
  padding = 16,
  className = '',
  style,
  children,
  ...rest
}: CardProps) {
  const shadow = elevation === 'none' ? 'none' : HF.shadow[elevation];
  return (
    <div
      data-variant={variant ?? 'auto'}
      className={className}
      style={{
        background: HF.paper,
        border: `1px solid ${HF.border}`,
        borderRadius: HF.r.md,
        padding,
        boxShadow: shadow,
        color: HF.ink,
        fontFamily: HF.body,
        ...style,
      }}
      {...rest}
    >
      {children}
    </div>
  );
}

export default Card;
