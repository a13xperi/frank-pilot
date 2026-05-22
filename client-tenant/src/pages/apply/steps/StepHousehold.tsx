/**
 * StepHousehold — Lane W2. Adults stepper drives fee math.
 *
 * Fee: $35.95 × (adults + 1) — applicant + each additional adult. Computed in
 * ApplyContext as `state.paymentTotal`. Adults range 1–12.
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
 *         ~lines 236–347 (HouseholdComposition). Hand/SBox/sketchy dropped;
 *         HF primitives only. No WF.* / Kalam / Caveat.
 */
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Card, CTA } from '@/components/primitives';
import { HF } from '@/styles/tokens';
import { APPLICATION_FEE, useApply } from '../ApplyContext';

const MIN = 1;
const MAX = 12;

export function StepHousehold() {
  const { t } = useTranslation('apply');
  const [, setSearch] = useSearchParams();
  const { adults, setAdults, paymentTotal } = useApply();
  const billable = adults + 1; // applicant + each additional adult
  const total = paymentTotal;

  return (
    <div style={{ background: HF.cream, minHeight: '100vh', padding: 16 }}>
      <div style={{ maxWidth: 420, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div>
          <h1 style={{ fontFamily: HF.display, fontSize: 22, fontWeight: 700, color: HF.ink, margin: 0 }}>
            {t('household.title')}
          </h1>
          <p style={{ color: HF.ink3, fontSize: 13, margin: '4px 0 0' }}>
            {t('household.subtitle', { fee: APPLICATION_FEE.toFixed(2) })}
          </p>
        </div>

        <Card padding={14}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontFamily: HF.display, fontSize: 15, fontWeight: 700, color: HF.ink }}>
                {t('household.adultsLabel')}
              </div>
              <div style={{ fontSize: 11, color: HF.ink3 }}>{t('household.adultsHint')}</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <StepBtn
                ariaLabel={t('household.decrement')}
                onClick={() => setAdults(adults - 1)}
                disabled={adults <= MIN}
              >−</StepBtn>
              <span
                aria-live="polite"
                data-testid="adults-count"
                style={{ fontFamily: HF.display, fontSize: 26, fontWeight: 700, color: HF.ink, minWidth: 28, textAlign: 'center' }}
              >
                {adults}
              </span>
              <StepBtn
                ariaLabel={t('household.increment')}
                onClick={() => setAdults(adults + 1)}
                disabled={adults >= MAX}
                primary
              >+</StepBtn>
            </div>
          </div>
        </Card>

        <Card padding={14} style={{ background: HF.accentLo, borderColor: HF.accent }}>
          <div style={{ fontFamily: HF.display, fontSize: 13, fontWeight: 700, color: HF.accentInk }}>
            {t('household.feeCalculator')}
          </div>
          <div style={{ height: 6 }} />
          <Row label={`$${APPLICATION_FEE.toFixed(2)} × ${billable} ${t('household.adults')}`}
               value={`$${(APPLICATION_FEE * billable).toFixed(2)}`} />
          <Row label={t('household.processing')} value="$0.00" muted />
          <div style={{ marginTop: 6, paddingTop: 6, borderTop: `1.4px solid ${HF.accent}`,
                        display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <span style={{ fontFamily: HF.display, fontSize: 14, fontWeight: 700, color: HF.ink }}>
              {t('household.totalDue')}
            </span>
            <span data-testid="payment-total"
                  style={{ fontFamily: HF.display, fontSize: 22, fontWeight: 700, color: HF.accent }}>
              {total}
            </span>
          </div>
          <div style={{ fontSize: 10, color: HF.ink3, marginTop: 4 }}>{t('household.disclaimer')}</div>
        </Card>

        <CTA variant="mobile" onClick={() => setSearch(prev => { const next = new URLSearchParams(prev); next.set('step', 'payment'); return next; }, { replace: true })}>
          {t('household.cta', { total })}
        </CTA>
      </div>
    </div>
  );
}

function Row({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  const color = muted ? HF.ink3 : HF.ink2;
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color }}>
      <span>{label}</span><span>{value}</span>
    </div>
  );
}

function StepBtn({ children, onClick, disabled, primary, ariaLabel }:
                 { children: React.ReactNode; onClick: () => void; disabled?: boolean; primary?: boolean; ariaLabel: string }) {
  return (
    <button type="button" aria-label={ariaLabel} onClick={onClick} disabled={disabled}
            style={{
              width: 36, height: 36, borderRadius: HF.r.pill,
              border: `1.4px solid ${primary ? HF.accent : HF.borderHi}`,
              background: primary ? HF.accent : HF.paper,
              color: primary ? HF.paper : HF.ink,
              fontFamily: HF.display, fontSize: 18, fontWeight: 700,
              cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.4 : 1,
              display: 'grid', placeItems: 'center',
            }}>
      {children}
    </button>
  );
}

export default StepHousehold;
