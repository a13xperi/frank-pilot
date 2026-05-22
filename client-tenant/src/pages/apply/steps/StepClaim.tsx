import { useEffect, useState } from 'react';
import { useApply } from '../ApplyContext';
import { useTranslation } from 'react-i18next';
import { CTA } from '@/components/primitives';
import { useFlag } from '@/lib/flags';
import { getUnitPhoto } from '@/utils/unitPlaceholder';
import { HF } from '@/styles/tokens';

export function StepClaim() {
  const s = useApply();
  const { t } = useTranslation('apply');
  // FROZEN CONTRACT 5 — flag off → ?step=2; flag on → ?step=review (wedge point).
  const wizardEnabled = useFlag('PAYMENT_WIZARD_ENABLED');
  const nextStep: 'review' | 2 = wizardEnabled ? 'review' : 2;

  if (!s.claimedUnit || !s.claimExpiresAt) {
    return (
      <div className="space-y-4 text-center">
        <p style={{ fontFamily: HF.body, fontSize: 13, color: HF.ink3 }}>{t('claim.noActive')}</p>
        <CTA tone="primary" block onClick={() => s.setStep('intent')}>
          {t('claim.startOver')}
        </CTA>
      </div>
    );
  }

  const unit = s.claimedUnit;

  return (
    <div className="space-y-4 text-center">
      <div
        style={{
          overflow: 'hidden',
          borderRadius: HF.r.lg,
          border: `1px solid ${HF.border}`,
        }}
      >
        <img
          src={getUnitPhoto(unit.photo_url)}
          alt=""
          className="aspect-[16/9] w-full object-cover"
        />
      </div>
      <div>
        <h1 style={{ fontFamily: HF.display, fontWeight: 800, fontSize: 22, color: HF.ink }}>
          {t('claim.yours').replace('{unitNumber}', unit.unit_number)}
        </h1>
        <p style={{ fontFamily: HF.body, fontSize: 13, color: HF.ink3, marginTop: 4 }}>
          {unit.property_name}
          {unit.property_city && `, ${unit.property_city}`}
        </p>
      </div>
      <ClaimCountdown expiresAt={s.claimExpiresAt} />
      <CTA tone="primary" block onClick={() => s.setStep(nextStep)}>
        {t('claim.continue')}
      </CTA>
      <button
        onClick={() => s.setStep('pick')}
        style={{
          background: 'none',
          border: 'none',
          padding: 0,
          fontFamily: HF.body,
          fontSize: 13,
          color: HF.ink3,
          textDecoration: 'underline',
          cursor: 'pointer',
        }}
      >
        {t('claim.pickDifferent')}
      </button>
    </div>
  );
}

function ClaimCountdown({ expiresAt }: { expiresAt: string }) {
  const { t } = useTranslation('apply');
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);
  const remaining = new Date(expiresAt).getTime() - now;
  const total = Math.max(0, Math.floor(remaining / 1000));
  const h = String(Math.floor(total / 3600)).padStart(2, '0');
  const m = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
  const sec = String(total % 60).padStart(2, '0');
  return (
    <div
      style={{
        background: HF.accent,
        color: HF.paper,
        borderRadius: HF.r.lg,
        padding: 16,
      }}
    >
      <div
        style={{
          fontFamily: HF.body,
          fontSize: 11,
          textTransform: 'uppercase',
          letterSpacing: 1,
          fontWeight: 700,
          color: 'rgba(255,255,255,0.85)',
        }}
      >
        {t('claim.heldUntil')}
      </div>
      <div
        style={{
          fontFamily: HF.mono,
          fontSize: 28,
          fontWeight: 800,
          marginTop: 4,
          color: HF.paper,
        }}
      >
        {h}:{m}:{sec}
      </div>
      <div
        style={{
          fontFamily: HF.body,
          fontSize: 11,
          color: 'rgba(255,255,255,0.85)',
          marginTop: 4,
        }}
      >
        {t('claim.finishBeforeTimer')}
      </div>
    </div>
  );
}
