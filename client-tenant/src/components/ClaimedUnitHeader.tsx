import { useEffect, useState } from 'react';
import { Clock } from 'lucide-react';
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

function formatCountdown(ms: number): string {
  if (ms <= 0) return '00:00:00';
  const total = Math.floor(ms / 1000);
  const h = String(Math.floor(total / 3600)).padStart(2, '0');
  const m = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
  const s = String(total % 60).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

export function ClaimedUnitHeader({ unit, expiresAt }: Props) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  const remaining = new Date(expiresAt).getTime() - now;
  const photo = getUnitPhoto(unit.photo_url);

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
            style={{ color: HF.accentInk }}
          >
            <Clock className="h-3 w-3" />
            <span className="font-mono font-medium" style={{ fontFamily: HF.mono }}>
              {formatCountdown(remaining)}
            </span>
          </div>
          <div
            className="text-[10px] uppercase tracking-wide"
            style={{ color: HF.accent }}
          >
            held
          </div>
        </div>
      </div>
    </div>
  );
}
