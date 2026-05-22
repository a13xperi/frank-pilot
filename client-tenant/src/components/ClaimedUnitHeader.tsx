import { useEffect, useState } from 'react';
import { Clock } from 'lucide-react';
import type { Unit } from '@/api/units';
import { getUnitPhoto } from '@/utils/unitPlaceholder';

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
    <div className="sticky top-0 z-20 -mx-4 mb-4 border-b border-emerald-200 bg-emerald-50/95 px-4 py-3 backdrop-blur">
      <div className="mx-auto flex max-w-md items-center gap-3">
        <img
          src={photo}
          alt=""
          className="h-12 w-12 flex-shrink-0 rounded-lg object-cover"
        />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-gray-900">
            {unit.property_name} · Unit {unit.unit_number}
          </div>
          <div className="text-xs text-gray-600">{formatRent(unit.monthly_rent)}</div>
        </div>
        <div className="flex flex-col items-end">
          <div className="inline-flex items-center gap-1 text-xs text-emerald-800">
            <Clock className="h-3 w-3" />
            <span className="font-mono font-medium">{formatCountdown(remaining)}</span>
          </div>
          <div className="text-[10px] uppercase tracking-wide text-emerald-700">held</div>
        </div>
      </div>
    </div>
  );
}
