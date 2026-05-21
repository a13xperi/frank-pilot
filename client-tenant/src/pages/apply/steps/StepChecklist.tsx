import { CheckCircle, Info, Clock } from 'lucide-react';
import { useApply } from '../ApplyContext';
import { useTranslation } from 'react-i18next';
import { CTA, ListRow } from '@/components/primitives';

const ITEM_KEYS = ['id', 'income', 'ssn', 'refs', 'household'] as const;

export function StepChecklist() {
  const s = useApply();
  const { t } = useTranslation('apply');

  return (
    <>
      <h1 className="mb-1 text-xl font-bold text-gray-900">{t('checklist.title')}</h1>
      <p className="mb-4 text-sm text-gray-500">{t('checklist.subtitle')}</p>

      <ul className="mb-5 divide-y divide-gray-100" aria-label={t('checklist.title')}>
        {ITEM_KEYS.map((key) => (
          <li key={key}>
            <ListRow
              leading={<CheckCircle className="h-5 w-5 text-emerald-600" aria-hidden="true" />}
              title={t(`checklist.items.${key}`)}
            />
          </li>
        ))}
      </ul>

      <div className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50 p-4">
        <div className="flex items-start gap-2">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" aria-hidden="true" />
          <div>
            <p className="text-sm font-medium text-emerald-900">{t('checklist.fee.title')}</p>
            <p className="mt-1 text-xs text-emerald-800">{t('checklist.fee.body')}</p>
          </div>
        </div>
      </div>

      <div className="mb-5 rounded-lg border border-amber-200 bg-amber-50 p-4">
        <div className="flex items-start gap-2">
          <Clock className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" aria-hidden="true" />
          <div>
            <p className="text-sm font-medium text-amber-900">{t('checklist.rule120.title')}</p>
            <p className="mt-1 text-xs text-amber-800">{t('checklist.rule120.body')}</p>
          </div>
        </div>
      </div>

      <CTA onClick={() => s.setStep('pick')}>{t('checklist.continue')}</CTA>
    </>
  );
}
