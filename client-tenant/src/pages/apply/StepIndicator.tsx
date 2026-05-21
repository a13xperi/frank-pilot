import { useApplyProgress, APPLY_STEP_KEYS, type ApplyStepKey } from '@/hooks/useApplyProgress';
import { useTranslation } from 'react-i18next';
import { HF } from '@/styles/tokens';

const LABEL_KEYS: Record<ApplyStepKey, string> = {
  register: 'register.title',
  verify: 'verify.title',
  intent: 'intent.title',
  checklist: 'checklist.title',
  pick: 'pick.title',
  claim: 'claim.continue',
  // Lane W payment-wizard steps (i18n strings supplied by W2/W3).
  review: 'review.title',
  household: 'household.title',
  payment: 'payment.title',
  details: 'details.title',
  confirm: 'confirm.title',
};

export function StepIndicator() {
  const { current, total, stepKey } = useApplyProgress();
  const { t } = useTranslation('apply');
  const pct = Math.round((current / total) * 100);
  const stepLabel = t('progress.stepLabel')
    .replace('{n}', String(current))
    .replace('{total}', String(total));

  return (
    <>
      {/* Mobile: top progress bar */}
      <div className="lg:hidden" aria-label={stepLabel}>
        <div
          className="mb-1 flex justify-between text-xs"
          style={{ color: HF.ink3, fontFamily: HF.body }}
        >
          <span>{t(LABEL_KEYS[stepKey])}</span>
          <span>
            {current}/{total}
          </span>
        </div>
        <div
          className="h-1.5 w-full"
          style={{
            background: HF.border,
            borderRadius: HF.r.pill,
            overflow: 'hidden',
          }}
        >
          <div
            className="h-full transition-all"
            style={{
              width: `${pct}%`,
              background: HF.accent,
              borderRadius: HF.r.pill,
            }}
          />
        </div>
      </div>

      {/* Desktop: left-rail vertical list */}
      <nav className="hidden lg:block" aria-label={stepLabel}>
        <ol className="space-y-3" style={{ fontFamily: HF.body }}>
          {APPLY_STEP_KEYS.map((key, i) => {
            const n = i + 1;
            const isCurrent = key === stepKey;
            const isDone = n < current;
            const circleStyle = isCurrent
              ? { background: HF.accent, color: HF.paper }
              : isDone
              ? { background: HF.sageLo, color: HF.sage }
              : { background: HF.border, color: HF.ink3 };
            return (
              <li key={key} className="flex items-center gap-3">
                <div
                  className="flex h-7 w-7 items-center justify-center text-xs font-bold"
                  style={{ ...circleStyle, borderRadius: HF.r.pill }}
                >
                  {n}
                </div>
                <span
                  className="text-sm"
                  style={{
                    color: isCurrent ? HF.ink : HF.ink3,
                    fontWeight: isCurrent ? 600 : 400,
                  }}
                >
                  {t(LABEL_KEYS[key])}
                </span>
              </li>
            );
          })}
        </ol>
      </nav>
    </>
  );
}
