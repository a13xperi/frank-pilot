/**
 * StepReview — Lane W2. Boarding-pass recap of the applicant's selection.
 *
 * WF → HF TOKEN MAP:
 *   WF.ink    (#1a1814) → HF.ink
 *   WF.ink2              → HF.ink2
 *   WF.ink3              → HF.ink3
 *   WF.accent (#c9492a) → HF.accent
 *   WF.paper             → HF.paper
 *   WF.cream / #e2dccc  → HF.cream / HF.border
 *
 * Source: /tmp/gpmglv-welcome/015caabf-c0ea-44e7-bb16-1ff144fe250e
 *         ~lines 58–231 (ReviewSelection). Semantics preserved; primitives
 *         restyled to HF — Hand/SBox/sketchy dropped, no WF.* references,
 *         no Kalam/Caveat.
 */
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Card, CTA, Pill } from '@/components/primitives';
import { HF } from '@/styles/tokens';
import { useApply } from '../ApplyContext';

export function StepReview() {
  const { t } = useTranslation('apply');
  const [, setSearch] = useSearchParams();
  const { state } = useApply();

  const propName = state.property?.name ?? t('review.fallback.propertyName');
  const propPhoto = state.property?.photoUrl;
  const propAddress = state.property?.address ?? t('review.fallback.address');
  const bed = state.unit?.bedrooms;
  const bedLabel = bed == null ? t('review.fallback.studio')
    : bed === 0 ? t('review.fallback.studio') : `${bed} ${t('review.bed')}`;
  const sqft = state.unit?.sqft ?? 720;
  const waitlistPos = state.unit?.waitlistPosition ?? null;
  const incomeBand = state.criteria?.incomeBand ?? '50–60% AMI';
  const householdSize = state.criteria?.householdSize ?? 1;
  const moveIn = state.criteria?.moveInDate ?? '—';

  return (
    <div style={{ background: HF.cream, minHeight: '100vh', padding: 16 }}>
      <div style={{ maxWidth: 420, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div>
          <h1 style={{ fontFamily: HF.display, fontSize: 22, fontWeight: 700, color: HF.ink, margin: 0 }}>
            {t('review.title')}
          </h1>
          <p style={{ color: HF.ink3, fontSize: 13, margin: '4px 0 0' }}>{t('review.subtitle')}</p>
        </div>

        <Card padding={0} style={{ overflow: 'hidden', borderColor: HF.borderHi }}>
          {propPhoto && (
            <img src={propPhoto} alt="" style={{ width: '100%', height: 140, objectFit: 'cover', display: 'block' }} />
          )}
          <div style={{ padding: 14, position: 'relative' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 9, color: HF.ink3, fontWeight: 600, letterSpacing: 1.5, textTransform: 'uppercase' }}>
                  {t('review.applyingFor')}
                </div>
                <div style={{ fontFamily: HF.display, fontSize: 18, fontWeight: 700, color: HF.ink, marginTop: 2 }}>{propName}</div>
                <div style={{ fontSize: 12, color: HF.ink3 }}>{propAddress}</div>
              </div>
              <button onClick={() => setSearch({ step: 'intent' }, { replace: true })}
                      style={{ background: 'transparent', border: 'none', color: HF.accent, fontSize: 11, textDecoration: 'underline', cursor: 'pointer' }}>
                {t('review.edit')}
              </button>
            </div>

            <div style={{ height: 12 }} />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
              <Stat label={t('review.unit')} value={bedLabel} accent />
              <Stat label={t('review.size')} value={`${sqft} ${t('review.sqft')}`} />
              <Stat label={t('review.position')} value={waitlistPos ? `#${waitlistPos}` : t('review.openVacancy')} />
            </div>

            <div style={{ marginTop: 12, paddingTop: 10, borderTop: `1px dashed ${HF.borderHi}` }}>
              <div style={{ fontSize: 9, color: HF.ink3, fontWeight: 600, letterSpacing: 1, textTransform: 'uppercase' }}>
                {t('review.lockedCriteria')}
              </div>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 6 }}>
                <Pill>{incomeBand}</Pill>
                <Pill>{t('review.household', { count: householdSize })}</Pill>
                <Pill>{moveIn}</Pill>
                <button onClick={() => setSearch({ step: 'intent' }, { replace: true })}
                        style={{ background: 'transparent', border: 'none', color: HF.accent, fontSize: 11, textDecoration: 'underline', cursor: 'pointer', marginLeft: 'auto' }}>
                  {t('review.edit')}
                </button>
              </div>
            </div>
          </div>
        </Card>

        <Card padding={12} style={{ background: HF.accentLo, borderColor: HF.accent }}>
          <div style={{ fontFamily: HF.display, fontSize: 13, fontWeight: 700, color: HF.accentInk }}>
            {t('review.confirmHeader')}
          </div>
          <div style={{ fontSize: 11, color: HF.ink3, marginTop: 2 }}>{t('review.confirmBody')}</div>
        </Card>

        <CTA variant="mobile" onClick={() => setSearch({ step: 'household' }, { replace: true })}>
          {t('review.cta')}
        </CTA>
      </div>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: 9, color: HF.ink3, fontWeight: 600, letterSpacing: 1, textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontFamily: HF.display, fontSize: 15, fontWeight: 700, color: accent ? HF.accent : HF.ink, lineHeight: 1.1, marginTop: 2 }}>
        {value}
      </div>
    </div>
  );
}

export default StepReview;
