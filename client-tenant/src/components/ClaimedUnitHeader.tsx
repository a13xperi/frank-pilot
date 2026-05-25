import { useEffect, useState } from 'react';
import { Clock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Unit } from '@/api/units';
import { getUnitPhoto } from '@/utils/unitPlaceholder';
import { HF } from '@/styles/tokens';

interface Props {
  unit: Unit;
  expiresAt: string;
}

function formatRent(rent: string | number): string {
  const n = typeof rent === 'string' ? Number(rent) : rent;
  return `$${Math.round(n).toLocaleString()}/mo`;
}

export function ClaimedUnitHeader({ unit, expiresAt }: Props) {
  const { t } = useTranslation('apply');
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(interval);
  }, []);

  const remaining = new Date(expiresAt).getTime() - now;
  const photo = getUnitPhoto(unit.photo_url, unit.id);
  const isExpired = remaining <= 0;

  const countdownLabel = isExpired
    ? t('claim.expired')
    : (() => {
        const totalMinutes = Math.floor(remaining / 60_000);
        const hours = Math.floor(totalMinutes / 60);
        const minutes = totalMinutes % 60;
        return t('claim.expiresIn', { hours, minutes });
      })();

  return (
    <div
      className="sticky top-0 z-20 -mx-4 mb-4 px-4 py-3 backdrop-blur"
      style={{
        background: HF.accentLo,
        borderBottom: `1px solid ${HF.border}`,
      }}
    >
      <div className="mx-auto flex max-w-md items-center gap-3">
        <img
          src={photo}
          alt=""
          className="h-12 w-12 flex-shrink-0 object-cover"
          style={{ borderRadius: HF.r.md }}
        />
        <div className="min-w-0 flex-1">
          <div
            className="truncate text-sm font-semibold"
            style={{ color: HF.ink }}
          >
            {unit.property_name} · Unit {unit.unit_number}
          </div>
          <div className="text-xs" style={{ color: HF.ink2 }}>
            {formatRent(unit.monthly_rent)}
          </div>
        </div>
        <div className="flex flex-col items-end">
          <div
            className="inline-flex items-center gap-1 text-xs"
            style={{ color: isExpired ? HF.ink3 : HF.accentInk }}
          >
            {!isExpired && <Clock className="h-3 w-3" />}
            <span
              data-testid="claim-countdown"
              className="font-medium"
              style={{ fontFamily: isExpired ? HF.body : HF.mono }}
            >
              {countdownLabel}
            </span>
          </div>
          <div
            className="text-[10px] uppercase tracking-wide"
            style={{ color: isExpired ? HF.ink3 : HF.accent }}
          >
            held
          </div>
        </div>
      </div>
    </div>
  );
}
