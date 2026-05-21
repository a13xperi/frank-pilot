import { useEffect, useState } from 'react';
import { useApply } from '../ApplyContext';
import { useTranslation } from 'react-i18next';
import { CTA } from '@/components/primitives';

export function StepClaim() {
  const s = useApply();
  const { t } = useTranslation('apply');

  if (!s.claimedUnit || !s.claimExpiresAt) {
    return (
      <div className="space-y-4 text-center">
        <p className="text-sm text-gray-500">{t('claim.noActive')}</p>
        <CTA onClick={() => s.setStep('intent')}>{t('claim.startOver')}</CTA>
      </div>
    );
  }

  const unit = s.claimedUnit;

  return (
    <div className="space-y-4 text-center">
      <div className="overflow-hidden rounded-xl">
        <img
          src={unit.photo_url || `https://picsum.photos/seed/${unit.id.slice(0, 8)}/800/600`}
          alt=""
          className="aspect-[16/9] w-full object-cover"
        />
      </div>
      <div>
        <h1 className="text-xl font-bold text-gray-900">
          {t('claim.yours').replace('{unitNumber}', unit.unit_number)}
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          {unit.property_name}
          {unit.property_city && `, ${unit.property_city}`}
        </p>
      </div>
      <ClaimCountdown expiresAt={s.claimExpiresAt} />
      <CTA onClick={() => s.setStep(2)}>{t('claim.continue')}</CTA>
      <button
        onClick={() => s.setStep('pick')}
        className="text-sm text-gray-500 hover:text-gray-700 hover:underline"
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
    <div className="rounded-lg bg-emerald-50 p-4">
      <div className="text-xs uppercase tracking-wide text-emerald-700">{t('claim.heldUntil')}</div>
      <div className="mt-1 font-mono text-2xl font-bold text-emerald-800">
        {h}:{m}:{sec}
      </div>
      <div className="mt-1 text-xs text-emerald-700">{t('claim.finishBeforeTimer')}</div>
    </div>
  );
}
