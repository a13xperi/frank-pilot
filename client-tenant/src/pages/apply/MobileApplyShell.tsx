/**
 * MobileApplyShell — mobile-first frame for the apply wizard, gated behind
 * `MOBILE_APPLY_ENABLED` + viewport `< md`. Wedge #7.
 *
 * Layout:
 *   ┌─────────────────────────────────┐
 *   │ compact progress strip (top)    │ ← Step n of N + 2px progress bar
 *   ├─────────────────────────────────┤
 *   │ scrollable step content (mid)   │ ← `flex: 1; overflow-y: auto`
 *   │                                 │
 *   ├─────────────────────────────────┤
 *   │ sticky CTA bar (bottom)         │ ← portal slot for StepCTA
 *   │ + env(safe-area-inset-bottom)   │
 *   └─────────────────────────────────┘
 *
 * Soft-keyboard handling: `100dvh` on the outer container (modern browsers
 * shrink dvh when the keyboard pops, keeping the bottom CTA visible). The
 * visualViewport API is layered on top for iOS Safari < 17.5, where the
 * keyboard does NOT shrink dvh and instead overlays the layout — we read
 * `visualViewport.height` and pin the CTA bar to that height instead of the
 * outer container's bottom.
 *
 * Sticky CTA: a portal slot. Each step's primary CTA renders through the
 * `<StepCTA>` wrapper (see `./StepCTA.tsx`), which targets this slot on
 * mobile and falls through to inline on desktop. This avoids modifying step
 * business logic / forms — only the CTA component swap. The portal slot is
 * inside the same React tree so submit-on-form semantics still work (the
 * portal preserves event bubbling through the React tree, not the DOM tree).
 *
 * Desktop fallback (flag off OR viewport >= md): renders children unchanged.
 */
import { createContext, useEffect, useState, type ReactNode } from 'react';
import { HF } from '@/styles/tokens';
import { useApplyProgress } from '@/hooks/useApplyProgress';
import { useTranslation } from 'react-i18next';
import type { ApplyStepKey } from '@/hooks/useApplyProgress';

// Slot DOM node for portaling step CTAs. Null when no mobile shell is
// active (desktop fallback or flag off) — StepCTA falls through to inline.
export const MobileStickyCtaContext = createContext<HTMLElement | null>(null);

const LABEL_KEYS: Record<ApplyStepKey, string> = {
  register: 'register.title',
  verify: 'verify.title',
  intent: 'intent.title',
  checklist: 'checklist.title',
  pick: 'pick.title',
  claim: 'claim.continue',
  review: 'review.title',
  household: 'household.title',
  payment: 'payment.title',
  details: 'details.title',
  confirm: 'confirm.title',
};

interface MobileApplyShellProps {
  /** Wizard content (current step body). */
  children: ReactNode;
}

/**
 * Tracks `visualViewport.height` so the sticky CTA bar can clear an
 * overlay-style soft-keyboard (iOS Safari < 17.5). Returns the delta — the
 * number of px the keyboard occupies — or 0 when no keyboard is open.
 */
function useKeyboardOffset(): number {
  const [offset, setOffset] = useState(0);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      // window.innerHeight minus visualViewport.height = keyboard intrusion.
      // Clamped to 0 because some browsers report tiny negative deltas during
      // safe-area transitions.
      const delta = Math.max(0, window.innerHeight - vv.height);
      setOffset(delta);
    };
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, []);
  return offset;
}

export function MobileApplyShell({ children }: MobileApplyShellProps) {
  const { current, total, stepKey } = useApplyProgress();
  const { t } = useTranslation('apply');
  const [slotEl, setSlotEl] = useState<HTMLElement | null>(null);
  const kbdOffset = useKeyboardOffset();
  const pct = Math.round((current / total) * 100);

  const stepLabel = t('progress.stepLabel')
    .replace('{n}', String(current))
    .replace('{total}', String(total));
  const titleKey = LABEL_KEYS[stepKey];

  return (
    <MobileStickyCtaContext.Provider value={slotEl}>
      <div
        data-testid="mobile-apply-shell"
        style={{
          // 100dvh shrinks when the soft-keyboard opens on Chrome / Safari
          // >= 17.5, so the sticky CTA stays visible without extra wiring.
          minHeight: '100dvh',
          height: '100dvh',
          display: 'flex',
          flexDirection: 'column',
          background: HF.cream,
          color: HF.ink,
          fontFamily: HF.body,
        }}
      >
        {/* Top: compact progress strip. */}
        <header
          data-testid="mobile-apply-progress"
          aria-label={stepLabel}
          style={{
            padding: '10px 16px 8px',
            background: HF.cream,
            borderBottom: `1px solid ${HF.border}`,
            // env() for the notch on iOS landscape — pads the strip out of
            // the rounded screen corner without painting white behind it.
            paddingTop: 'calc(10px + env(safe-area-inset-top))',
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'baseline',
              fontSize: 12,
              color: HF.ink3,
              marginBottom: 6,
            }}
          >
            <span style={{ fontWeight: 600, color: HF.ink2 }}>{t(titleKey)}</span>
            <span data-testid="mobile-apply-progress-count">
              {current}/{total}
            </span>
          </div>
          <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={total}
            aria-valuenow={current}
            aria-label={stepLabel}
            style={{
              height: 4,
              width: '100%',
              background: HF.border,
              borderRadius: HF.r.pill,
              overflow: 'hidden',
            }}
          >
            <div
              data-testid="mobile-apply-progress-bar"
              style={{
                width: `${pct}%`,
                height: '100%',
                background: HF.accent,
                borderRadius: HF.r.pill,
                transition: 'width 200ms ease',
              }}
            />
          </div>
        </header>

        {/* Middle: scrollable step content. */}
        <main
          data-testid="mobile-apply-content"
          style={{
            flex: 1,
            overflowY: 'auto',
            // Generous bottom padding so the last form field never hides
            // behind the sticky CTA bar. ~80px = CTA height + breathing room.
            padding: `16px 16px calc(80px + env(safe-area-inset-bottom)) 16px`,
            WebkitOverflowScrolling: 'touch',
          }}
        >
          {children}
        </main>

        {/* Bottom: sticky CTA bar, portal target. */}
        <footer
          data-testid="mobile-apply-cta-bar"
          ref={setSlotEl}
          style={{
            position: 'sticky',
            bottom: 0,
            background: HF.paper,
            borderTop: `1px solid ${HF.border}`,
            // Safe-area for iPhone home indicator. Plus a small visible
            // gap so the CTA breathes off the bezel.
            padding: `12px 16px calc(12px + env(safe-area-inset-bottom)) 16px`,
            boxShadow: HF.shadow.sm,
            zIndex: 30,
            // iOS Safari < 17.5: keyboard overlays layout instead of
            // shrinking dvh, so lift the bar by the keyboard's height.
            transform: kbdOffset > 0 ? `translateY(-${kbdOffset}px)` : undefined,
            transition: 'transform 120ms ease',
          }}
        />
      </div>
    </MobileStickyCtaContext.Provider>
  );
}

export default MobileApplyShell;
