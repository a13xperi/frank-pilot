/**
 * StepConfirm — terminal receipt for the apply wizard (Lane W3 scaffold).
 *
 * Shows paid amount, paymentRef, queue position (if waitlist summary
 * available, else "position confirmed"), what-happens-next bullets,
 * link to /dashboard.
 *
 * Wedge #5 — when `outcome === 'waitlisted'` and `propertySlug` is provided,
 * a secondary CTA links to `/waitlist/position/:slug?bedrooms=N` so the
 * applicant can see their position immediately after joining the waitlist.
 */
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { HF } from '@/styles/tokens';
import { Card } from '@/components/primitives';
import { StepCTA } from '@/pages/apply/StepCTA';
import { useApply } from '@/pages/apply/context/ApplyContext';
import { PayHeader } from '@/pages/apply/PayHeader';

interface WaitlistSummary {
  position?: number | null;
}

export interface StepConfirmProps {
  /** Optional pre-fetched waitlist summary (W1/W2 may inject) */
  waitlist?: WaitlistSummary | null;
  /**
   * Wedge #5 — whether the applicant claimed a unit or joined the waitlist.
   * When `'waitlisted'`, a secondary CTA is rendered linking to the position
   * page. Defaults to null (no CTA) for backward compatibility.
   */
  outcome?: 'claimed' | 'waitlisted' | null;
  /**
   * Wedge #5 — the property slug used to build the waitlist position URL.
   * Required when `outcome === 'waitlisted'`; ignored otherwise.
   */
  propertySlug?: string | null;
  /**
   * Wedge #5 — the bedroom count to include in the position URL query param.
   * Passed by the caller who knows the applicant's selected bedroom tier.
   */
  bedrooms?: number | null;
}

export function StepConfirm({
  waitlist = null,
  outcome = null,
  propertySlug = null,
  bedrooms = null,
}: StepConfirmProps) {
  const { t, i18n } = useTranslation('apply');
  const lang = (i18n.language?.startsWith('es') ? 'es' : 'en') as 'en' | 'es';
  const { state } = useApply();

  const position = waitlist?.position;
  const hasRef = !!state.paymentRef;

  // Wedge #5 — build position URL when the applicant landed on the waitlist.
  const showPositionCta = outcome === 'waitlisted' && !!propertySlug;
  const positionTo = showPositionCta
    ? `/waitlist/position/${propertySlug}${typeof bedrooms === 'number' ? `?bedrooms=${bedrooms}` : ''}`
    : null;

  const nextSteps = t('confirm.nextSteps', { returnObjects: true }) as string[];

  return (
    <div style={{ background: HF.cream, minHeight: '100vh', color: HF.ink, fontFamily: HF.body }}>
      <PayHeader step={5} total={5} lang={lang} />
      <main className="mx-auto max-w-md p-4 flex flex-col gap-3" aria-label={t('confirm.title') as string}>
        <div style={{ textAlign: 'center', padding: '10px 0 4px' }}>
          <div
            aria-hidden
            style={{
              width: 64, height: 64, borderRadius: 999, margin: '0 auto',
              background: HF.okLo, border: `2px solid ${HF.ok}`,
              display: 'grid', placeItems: 'center', fontSize: 28, color: HF.ok, fontWeight: 700,
            }}
          >
            ✓
          </div>
        </div>
        <h1 style={{ fontFamily: HF.display, fontSize: 24, fontWeight: 700, textAlign: 'center' }}>
          {t('confirm.title')}
        </h1>
        <p style={{ textAlign: 'center', color: HF.ink3, fontSize: 13 }}>{t('confirm.subtitle')}</p>

        <Card padding={14} style={{ borderColor: HF.ok }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <span style={{ color: HF.ink3, fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, fontWeight: 600 }}>
              {t('confirm.paid')}
            </span>
            <span style={{ fontFamily: HF.display, fontSize: 22, fontWeight: 700 }}>${state.paymentTotal}</span>
          </div>
          <div style={{ height: 8 }} />
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: HF.ink2 }}>
            <span style={{ color: HF.ink3, textTransform: 'uppercase', letterSpacing: 1, fontWeight: 600, fontSize: 11 }}>
              {t('confirm.ref')}
            </span>
            <span style={{ fontFamily: HF.mono }} data-testid="payment-ref">
              {hasRef ? state.paymentRef : t('confirm.refMissing')}
            </span>
          </div>
          <div style={{ height: 8 }} />
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: HF.ink2 }}>
            <span style={{ color: HF.ink3, textTransform: 'uppercase', letterSpacing: 1, fontWeight: 600, fontSize: 11 }}>
              {t('confirm.queue')}
            </span>
            <span style={{ fontWeight: 700 }}>
              {typeof position === 'number' ? `#${position}` : (t('confirm.positionConfirmed') as string)}
            </span>
          </div>
        </Card>

        <Card padding={14}>
          <h2 style={{ fontFamily: HF.display, fontSize: 14, fontWeight: 700, marginBottom: 8 }}>
            {t('confirm.whatsNextTitle')}
          </h2>
          <ol style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingLeft: 0, margin: 0, listStyle: 'none' }}>
            {nextSteps.map((line, i) => (
              <li key={i} style={{ display: 'flex', gap: 8, fontSize: 13, color: HF.ink2 }}>
                <span
                  aria-hidden
                  style={{
                    width: 20, height: 20, borderRadius: 999, flex: '0 0 20px',
                    background: HF.accent, color: HF.paper, fontSize: 11, fontWeight: 700,
                    display: 'grid', placeItems: 'center',
                  }}
                >
                  {i + 1}
                </span>
                <span>{line}</span>
              </li>
            ))}
          </ol>
        </Card>

        {/* Wedge #5 — position CTA: only shown when outcome is waitlisted */}
        {showPositionCta && positionTo && (
          <Link
            to={positionTo}
            data-testid="check-position-cta"
            style={{
              display: 'block',
              textAlign: 'center',
              padding: '12px 16px',
              borderRadius: HF.r.md,
              border: `1px solid ${HF.accent}`,
              color: HF.accent,
              fontWeight: 600,
              fontSize: 15,
              textDecoration: 'none',
              background: HF.accentLo ?? 'transparent',
            }}
          >
            {t('confirm.checkPositionCta')}
          </Link>
        )}

        <StepCTA tone="primary" size="lg" block to="/dashboard">
          {t('confirm.toDashboard')}
        </StepCTA>
      </main>
    </div>
  );
}

export default StepConfirm;
