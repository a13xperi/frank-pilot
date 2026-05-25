import { useState } from 'react';
import { Heart } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useShortlist } from '@/state/shortlist';
import { HF } from '@/styles/tokens';

export interface SaveButtonProps {
  /** Property slug — what /discover renders + saves by. */
  slug: string;
  /** Accessible name for the property (announced in the toggle label). */
  propertyName?: string;
  /** Diameter of the round hit-target. Defaults to 40 (mobile-friendly). */
  size?: number;
  /**
   * Render with a translucent paper backdrop + shadow (for use over a photo
   * hero). Off by default — bare heart for in-card placement.
   */
  floating?: boolean;
  /** Extra className passthrough. */
  className?: string;
}

/**
 * SaveButton — the ♥ shortlist toggle. Filled terracotta heart when saved,
 * outline when not. Optimistic via the shortlist store (so the heart and the
 * header count badge stay in sync). Shows a brief "Saved to your shortlist"
 * confirmation pill on save.
 *
 * No global toast system exists on this surface yet, so the confirmation is a
 * self-contained `aria-live` pill that auto-dismisses. Reuses the welcome
 * namespace string `savedShortlist` already shipped for this feature.
 */
export function SaveButton({
  slug,
  propertyName,
  size = 40,
  floating = false,
  className = '',
}: SaveButtonProps) {
  const { t } = useTranslation('welcome');
  const { isSaved, save, unsave } = useShortlist();
  const saved = isSaved(slug);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);

  const label = saved
    ? t('save.remove', 'Remove from shortlist')
    : t('save.add', 'Save to shortlist');

  const onToggle = async (e: React.MouseEvent) => {
    // SaveButton is frequently nested inside a card-level <Link>; never let the
    // toggle navigate.
    e.preventDefault();
    e.stopPropagation();
    if (busy) return;
    setBusy(true);
    if (saved) {
      await unsave(slug);
    } else {
      const ok = await save(slug);
      if (ok) {
        setConfirm(true);
        window.setTimeout(() => setConfirm(false), 1800);
      }
    }
    setBusy(false);
  };

  const iconSize = Math.round(size * 0.5);

  return (
    <span
      style={{ position: 'relative', display: 'inline-flex' }}
      className={className}
    >
      <button
        type="button"
        onClick={onToggle}
        disabled={busy}
        aria-pressed={saved}
        aria-label={propertyName ? `${label}: ${propertyName}` : label}
        title={label}
        data-testid={`save-button-${slug}`}
        data-saved={saved}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: size,
          width: size,
          borderRadius: HF.r.pill,
          border: floating ? 'none' : `1px solid ${HF.border}`,
          background: floating ? HF.paper : 'rgba(255,255,255,0.85)',
          boxShadow: floating ? HF.shadow.sm : HF.shadow.xs,
          cursor: busy ? 'default' : 'pointer',
          opacity: busy ? 0.6 : 1,
          transition: 'transform 120ms ease',
          padding: 0,
        }}
      >
        <Heart
          width={iconSize}
          height={iconSize}
          style={{
            color: saved ? HF.accent : HF.ink3,
            fill: saved ? HF.accent : 'none',
            transition: 'color 120ms ease, fill 120ms ease',
          }}
          aria-hidden="true"
        />
      </button>
      {confirm && (
        <span
          role="status"
          aria-live="polite"
          data-testid={`save-confirm-${slug}`}
          style={{
            position: 'absolute',
            top: '50%',
            right: size + 8,
            transform: 'translateY(-50%)',
            whiteSpace: 'nowrap',
            background: HF.ink,
            color: HF.paper,
            borderRadius: HF.r.pill,
            padding: '4px 10px',
            fontSize: 12,
            fontWeight: 600,
            fontFamily: HF.body,
            boxShadow: HF.shadow.sm,
            pointerEvents: 'none',
          }}
        >
          {t('savedShortlist')}
        </span>
      )}
    </span>
  );
}

export default SaveButton;
