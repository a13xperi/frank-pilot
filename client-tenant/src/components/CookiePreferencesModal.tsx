/**
 * CookiePreferencesModal — per-category opt-in.
 *
 * Opened from CookieBanner "Customize" and from the footer
 * "Cookie preferences" link. Four toggle rows: Essential (always on,
 * disabled), Functional, Analytics, Marketing.
 *
 * Save commits all four choices to the consent store at once (so
 * recordedAt is set exactly once per Save). Cancel closes without
 * writing.
 *
 * gpmglv wedge #15.
 */

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { HF } from '@/styles/tokens';
import {
  useConsent,
  setCategory,
  type ConsentCategory,
} from '@/state/consent';

interface Props {
  open: boolean;
  onClose: () => void;
}

type Draft = Record<ConsentCategory, boolean>;

function draftFromState(s: {
  functional?: boolean;
  analytics?: boolean;
  marketing?: boolean;
}): Draft {
  return {
    functional: s.functional === true,
    analytics: s.analytics === true,
    marketing: s.marketing === true,
  };
}

export function CookiePreferencesModal({ open, onClose }: Props) {
  const { t } = useTranslation('legal');
  const consent = useConsent();
  const [draft, setDraft] = useState<Draft>(() => draftFromState(consent));

  // Re-sync draft when the modal opens or the underlying consent state
  // changes from elsewhere (e.g. another tab via storage event — not
  // currently wired but cheap to be defensive).
  useEffect(() => {
    if (open) setDraft(draftFromState(consent));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Esc closes — modal version, separate from the banner's Esc handler.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  function handleSave() {
    // Single Save commits all three non-essential categories. We call
    // setCategory for each so recordedAt updates and the listeners
    // emit. Order is irrelevant — the store has no race because writes
    // are synchronous.
    setCategory('functional', draft.functional);
    setCategory('analytics', draft.analytics);
    setCategory('marketing', draft.marketing);
    onClose();
  }

  const categories: Array<{
    key: 'essential' | ConsentCategory;
    enabled: boolean;
    disabled: boolean;
    onToggle?: (v: boolean) => void;
  }> = [
    { key: 'essential', enabled: true, disabled: true },
    {
      key: 'functional',
      enabled: draft.functional,
      disabled: false,
      onToggle: (v) => setDraft((d) => ({ ...d, functional: v })),
    },
    {
      key: 'analytics',
      enabled: draft.analytics,
      disabled: false,
      onToggle: (v) => setDraft((d) => ({ ...d, analytics: v })),
    },
    {
      key: 'marketing',
      enabled: draft.marketing,
      disabled: false,
      onToggle: (v) => setDraft((d) => ({ ...d, marketing: v })),
    },
  ];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="cookie-prefs-title"
      data-testid="cookie-preferences-modal"
      className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center"
      style={{ background: 'rgba(31, 26, 18, 0.45)' }}
      onClick={(e) => {
        // Click outside the inner card closes — outer is the backdrop.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="w-full max-w-lg overflow-y-auto"
        style={{
          background: HF.paper,
          borderTopLeftRadius: HF.r.lg,
          borderTopRightRadius: HF.r.lg,
          borderBottomLeftRadius: HF.r.lg,
          borderBottomRightRadius: HF.r.lg,
          maxHeight: '85vh',
          color: HF.ink,
          fontFamily: HF.body,
          padding: 20,
          margin: 12,
        }}
      >
        <h2
          id="cookie-prefs-title"
          className="text-lg font-semibold"
          style={{ fontFamily: HF.display, color: HF.ink }}
        >
          {t('modal.title')}
        </h2>
        <p
          className="mt-1 text-sm"
          style={{ color: HF.ink2, lineHeight: 1.5 }}
        >
          {t('modal.intro')}
        </p>

        <ul className="mt-4 space-y-3">
          {categories.map((cat) => (
            <li
              key={cat.key}
              className="flex items-start gap-3"
              style={{
                border: `1px solid ${HF.border}`,
                borderRadius: HF.r.md,
                padding: 12,
                background: HF.paperHi,
              }}
            >
              <div className="flex-1">
                <div
                  className="text-sm font-semibold"
                  style={{ color: HF.ink }}
                >
                  {t(`modal.categories.${cat.key}.label`)}
                </div>
                <div
                  className="mt-1 text-xs"
                  style={{ color: HF.ink2, lineHeight: 1.5 }}
                >
                  {t(`modal.categories.${cat.key}.description`)}
                </div>
              </div>
              <ToggleSwitch
                category={cat.key}
                checked={cat.enabled}
                disabled={cat.disabled}
                onChange={cat.onToggle}
                label={t(`modal.categories.${cat.key}.label`)}
              />
            </li>
          ))}
        </ul>

        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            data-testid="cookie-preferences-cancel"
            onClick={onClose}
            className="text-sm font-medium"
            style={{
              background: 'transparent',
              color: HF.ink2,
              border: `1px solid ${HF.border}`,
              borderRadius: HF.r.md,
              padding: '8px 14px',
            }}
          >
            {t('modal.cancel')}
          </button>
          <button
            type="button"
            data-testid="cookie-preferences-save"
            onClick={handleSave}
            className="text-sm font-semibold"
            style={{
              background: HF.accent,
              color: '#FFFFFF',
              border: `1px solid ${HF.accent}`,
              borderRadius: HF.r.md,
              padding: '8px 14px',
            }}
          >
            {t('modal.save')}
          </button>
        </div>
      </div>
    </div>
  );
}

function ToggleSwitch({
  category,
  checked,
  disabled,
  onChange,
  label,
}: {
  category: 'essential' | ConsentCategory;
  checked: boolean;
  disabled: boolean;
  onChange?: (v: boolean) => void;
  label: string;
}) {
  return (
    <label
      className="relative inline-flex shrink-0 cursor-pointer items-center"
      style={{ width: 44, height: 24, cursor: disabled ? 'not-allowed' : 'pointer' }}
    >
      <input
        type="checkbox"
        data-testid={`cookie-prefs-toggle-${category}`}
        aria-label={label}
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange?.(e.target.checked)}
        className="sr-only"
      />
      <span
        aria-hidden="true"
        style={{
          position: 'absolute',
          inset: 0,
          background: checked ? HF.accent : HF.borderHi,
          opacity: disabled ? 0.6 : 1,
          borderRadius: HF.r.pill,
          transition: 'background 120ms ease',
        }}
      />
      <span
        aria-hidden="true"
        style={{
          position: 'absolute',
          top: 2,
          left: checked ? 22 : 2,
          width: 20,
          height: 20,
          background: '#FFFFFF',
          borderRadius: '50%',
          boxShadow: HF.shadow.xs,
          transition: 'left 120ms ease',
        }}
      />
    </label>
  );
}
