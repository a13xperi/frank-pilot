import { useApplyProgress, APPLY_STEP_KEYS, type ApplyStepKey } from '@/hooks/useApplyProgress';
import { useTranslation } from '@/i18n';

const LABEL_KEYS: Record<ApplyStepKey, string> = {
  register: 'register.title',
  verify: 'verify.title',
  intent: 'intent.title',
  checklist: 'checklist.title',
  pick: 'pick.title',
  claim: 'claim.continue',
  details: 'details.title',
};

export function StepIndicator() {
  const { current, total, stepKey } = useApplyProgress();
  const { t } = useTranslation('apply');
  const pct = Math.round((current / total) * 100);

  return (
    <>
      {/* Mobile: top progress bar */}
      <div className="lg:hidden" aria-label={t('progress.stepLabel').replace('{n}', String(current)).replace('{total}', String(total))}>
        <div className="mb-1 flex justify-between text-xs text-gray-500">
          <span>{t(LABEL_KEYS[stepKey])}</span>
          <span>
            {current}/{total}
          </span>
        </div>
        <div className="h-1.5 w-full rounded-full bg-gray-200">
          <div
            className="h-1.5 rounded-full bg-emerald-600 transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {/* Desktop: left-rail vertical list */}
      <nav
        className="hidden lg:block"
        aria-label={t('progress.stepLabel').replace('{n}', String(current)).replace('{total}', String(total))}
      >
        <ol className="space-y-3">
          {APPLY_STEP_KEYS.map((key, i) => {
            const n = i + 1;
            const isCurrent = key === stepKey;
            const isDone = n < current;
            return (
              <li key={key} className="flex items-center gap-3">
                <div
                  className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${
                    isCurrent
                      ? 'bg-emerald-600 text-white'
                      : isDone
                      ? 'bg-emerald-100 text-emerald-700'
                      : 'bg-gray-200 text-gray-500'
                  }`}
                >
                  {n}
                </div>
                <span
                  className={`text-sm ${
                    isCurrent ? 'font-medium text-gray-900' : 'text-gray-500'
                  }`}
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
