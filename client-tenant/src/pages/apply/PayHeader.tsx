/**
 * PayHeader — STUB per Contract 3 (W2 will replace with canonical).
 *
 * Props: { step, total, lang, onBack? }
 * HF tokens + Tailwind only. No WF.*, no Hand/SBox/sketchy, no Kalam/Caveat.
 */
import { HF } from '@/styles/tokens';

export interface PayHeaderProps {
  step: number;
  total: number;
  lang?: 'en' | 'es';
  onBack?: () => void;
}

export function PayHeader({ step, total, lang = 'en', onBack }: PayHeaderProps) {
  const stepLabel = lang === 'es' ? `Paso ${step} de ${total}` : `Step ${step} of ${total}`;
  const backLabel = lang === 'es' ? 'Atrás' : 'Back';

  return (
    <header
      className="flex items-center justify-between px-4 py-3"
      style={{
        background: HF.cream,
        borderBottom: `1px solid ${HF.border}`,
        color: HF.ink,
        fontFamily: HF.body,
      }}
    >
      {onBack ? (
        <button
          type="button"
          onClick={onBack}
          aria-label={backLabel}
          className="inline-flex items-center gap-1 px-2 py-1"
          style={{
            background: 'transparent',
            color: HF.ink2,
            fontSize: 13,
            fontWeight: 600,
            border: 'none',
            cursor: 'pointer',
          }}
        >
          ← {backLabel}
        </button>
      ) : (
        <span style={{ width: 56 }} aria-hidden />
      )}
      <span
        aria-label={stepLabel}
        style={{ color: HF.ink3, fontSize: 12, fontWeight: 600, letterSpacing: 1 }}
      >
        {stepLabel.toUpperCase()}
      </span>
      <span style={{ width: 56 }} aria-hidden />
    </header>
  );
}

export default PayHeader;
