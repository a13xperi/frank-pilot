import { CheckCircle, Info, Clock } from 'lucide-react';
import { useApply } from '../ApplyContext';
import { useTranslation } from 'react-i18next';
import { ListRow } from '@/components/primitives';
import { StepCTA } from '../StepCTA';
import { HF } from '@/styles/tokens';

const ITEM_KEYS = ['id', 'income', 'ssn', 'refs', 'household'] as const;

export function StepChecklist() {
  const s = useApply();
  const { t } = useTranslation('apply');

  return (
    <>
      <h1 style={{ fontFamily: HF.display, fontWeight: 800, fontSize: 22, color: HF.ink, marginBottom: 4 }}>
        {t('checklist.title')}
      </h1>
      <p style={{ fontFamily: HF.body, fontSize: 13, color: HF.ink3, marginBottom: 16 }}>
        {t('checklist.subtitle')}
      </p>

      <ul
        style={{ borderTop: `1px solid ${HF.border}`, borderBottom: `1px solid ${HF.border}`, marginBottom: 20 }}
        aria-label={t('checklist.title') as string}
      >
        {ITEM_KEYS.map((key, i) => (
          <li
            key={key}
            style={i < ITEM_KEYS.length - 1 ? { borderBottom: `1px solid ${HF.border}` } : undefined}
          >
            <ListRow
              leading={<CheckCircle className="h-5 w-5" style={{ color: HF.sage }} aria-hidden="true" />}
              title={t(`checklist.items.${key}`)}
            />
          </li>
        ))}
      </ul>

      <div
        style={{
          background: HF.sageLo,
          border: `1px solid ${HF.sage}33`,
          borderRadius: HF.r.md,
          padding: 14,
          marginBottom: 12,
          display: 'flex',
          alignItems: 'flex-start',
          gap: 8,
        }}
      >
        <Info className="h-4 w-4 mt-0.5 shrink-0" style={{ color: HF.sage }} aria-hidden="true" />
        <div>
          <p style={{ fontFamily: HF.display, fontWeight: 700, fontSize: 13, color: HF.ink }}>
            {t('checklist.fee.title')}
          </p>
          <p style={{ fontFamily: HF.body, fontSize: 12, color: HF.ink2, marginTop: 4 }}>
            {t('checklist.fee.body')}
          </p>
        </div>
      </div>

      <div
        style={{
          background: HF.warnLo,
          border: `1px solid ${HF.warn}33`,
          borderRadius: HF.r.md,
          padding: 14,
          marginBottom: 20,
          display: 'flex',
          alignItems: 'flex-start',
          gap: 8,
        }}
      >
        <Clock className="h-4 w-4 mt-0.5 shrink-0" style={{ color: HF.warn }} aria-hidden="true" />
        <div>
          <p style={{ fontFamily: HF.display, fontWeight: 700, fontSize: 13, color: HF.ink }}>
            {t('checklist.rule120.title')}
          </p>
          <p style={{ fontFamily: HF.body, fontSize: 12, color: HF.ink2, marginTop: 4 }}>
            {t('checklist.rule120.body')}
          </p>
        </div>
      </div>

      <StepCTA tone="primary" block onClick={() => s.setStep('pick')}>
        {t('checklist.continue')}
      </StepCTA>
    </>
  );
}
