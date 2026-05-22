/**
 * StepCTA — primary-action wrapper for apply wizard steps.
 *
 * Behaviour:
 *  - When mounted inside <MobileApplyShell>, renders the CTA into the
 *    shell's bottom sticky slot via `createPortal`. React event bubbling
 *    is preserved through the React tree (not the DOM tree), so a form's
 *    submit handler still fires when the portaled CTA has `type="submit"`.
 *  - When NOT inside the shell (desktop / flag-off), renders inline —
 *    pixel-stable fallback, identical to writing `<CTA>` directly.
 *
 * Tap target: forces `size="lg"` on mobile so the button clears the 44×44
 * WCAG / iOS HIG minimum. `size="lg"` => `py: 14, fs: 16` → ~46px tall
 * with the default font-line-height; combined with `block: true` the bar
 * stretches edge-to-edge, easily exceeding 44px width.
 *
 * Hard constraint from wedge brief: only layout / a11y / input attrs may
 * change on existing steps. This wrapper is a CTA-tag swap and a portal —
 * no business logic, validation, or i18n is touched.
 */
import { useContext, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { CTA, type CTAProps } from '@/components/primitives';
import { MobileStickyCtaContext } from './MobileApplyShell';

export interface StepCTAProps extends Omit<CTAProps, 'children'> {
  children?: ReactNode;
  /**
   * Optional router target. If provided, the CTA renders inside a
   * `<Link to={to}>` so existing role="link" semantics + the StepConfirm
   * test contract are preserved. Works in both desktop and mobile-shell
   * branches: desktop renders Link → CTA inline; mobile portals the
   * Link → CTA pair into the sticky bar slot, preserving navigation.
   */
  to?: string;
}

export function StepCTA({ size, block, variant, children, to, ...rest }: StepCTAProps) {
  const slot = useContext(MobileStickyCtaContext);
  const inMobileShell = slot !== null;

  // On mobile shell: force lg + block so the sticky bar is a comfortable
  // 46px+ tap target stretching edge-to-edge. On desktop: leave the
  // caller's sizing alone so existing layouts (Step2Details flex pair,
  // intent submit, etc.) keep their inline shape.
  const button = (
    <CTA
      {...rest}
      size={inMobileShell ? 'lg' : size}
      block={inMobileShell ? true : block}
      variant={inMobileShell ? 'mobile' : variant}
    >
      {children}
    </CTA>
  );

  // When a router target is provided, wrap the button in a Link so the
  // anchor goes WITH the button into the portal — clicking the portaled
  // CTA triggers the router. Wrapping in Link (not the other way around)
  // keeps the <a> in the same React subtree as the button.
  const rendered = to ? (
    <Link to={to} style={{ display: inMobileShell ? 'block' : 'inline-block', textDecoration: 'none' }}>
      {button}
    </Link>
  ) : (
    button
  );

  if (slot) {
    return createPortal(rendered, slot);
  }
  return rendered;
}

export default StepCTA;
