// Payment-wizard header — breadcrumb + 5-segment progress bar.
// HF skin only: Tailwind tokens, no Kalam/Caveat fonts. Semantics ported from
// the GPMGLV wireframe (PayHeader at /tmp/gpmglv-welcome/015caabf-...).
//
// Step mapping (FROZEN CONTRACT 1, wizard slice):
//   1 review · 2 household · 3 payment · 4 details (?step=2) · 5 confirm
import type { ReactNode } from 'react';
import { HF } from '@/styles/tokens';

export type PayHeaderStep = 'review' | 'household' | 'payment' | 'details' | 'confirm';

const STEP_ORDER: readonly PayHeaderStep[] = [
  'review',
  'household',
  'payment',
  'details',
  'confirm',
] as const;

const LABELS: Record<'en' | 'es', Record<PayHeaderStep, string>> = {
  en: {
    review: 'Review',
    household: 'Household',
    payment: 'Payment',
    details: 'Details',
    confirm: 'Confirm',
  },
  es: {
    review: 'Revisar',
    household: 'Hogar',
    payment: 'Pago',
    details: 'Detalles',
    confirm: 'Confirmar',
  },
};

const COPY = {
  en: { application: 'Application', back: 'Back' },
  es: { application: 'Solicitud', back: 'Atrás' },
};

export interface PayHeaderProps {
  step: PayHeaderStep;
  total: string; // formatted USD (e.g. "$71.90")
  lang: 'en' | 'es';
  onBack?: () => void;
}

export function PayHeader({ step, total, lang, onBack }: PayHeaderProps): ReactNode {
  const idx = STEP_ORDER.indexOf(step);
  const safeIdx = idx === -1 ? 0 : idx;
  const labels = LABELS[lang];
  const copy = COPY[lang];

  return (
    <header
      className="space-y-2 px-4 pb-2 pt-3"
      data-testid="pay-header"
      style={{ fontFamily: HF.body }}
    >
      <div className="flex items-center gap-2">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="text-xs"
            style={{ color: HF.ink3 }}
            aria-label={copy.back}
          >
            ← {copy.back}
          </button>
        )}
        <span
          className="ml-auto text-[10px] font-semibold uppercase tracking-wider"
          style={{ color: HF.ink3 }}
        >
          {copy.application} · {safeIdx + 1} / {STEP_ORDER.length}
        </span>
      </div>
      <div
        className="flex gap-1"
        role="progressbar"
        aria-valuenow={safeIdx + 1}
        aria-valuemin={1}
        aria-valuemax={STEP_ORDER.length}
      >
        {STEP_ORDER.map((s, i) => (
          <div
            key={s}
            className="h-1 flex-1"
            style={{
              background: i <= safeIdx ? HF.accent : HF.border,
              borderRadius: HF.r.pill,
            }}
            data-segment={s}
            data-active={i <= safeIdx ? 'true' : 'false'}
          />
        ))}
      </div>
      <div className="flex justify-between">
        {STEP_ORDER.map((s, i) => (
          <span
            key={s}
            className="text-[10px]"
            style={{
              color: i === safeIdx ? HF.ink : HF.ink3,
              fontWeight: i === safeIdx ? 700 : 400,
            }}
          >
            {labels[s]}
          </span>
        ))}
      </div>
      <div className="text-right text-xs" style={{ color: HF.ink3 }}>
        {total}
      </div>
    </header>
  );
}

export default PayHeader;
