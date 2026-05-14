import { Bed, Bath, Square } from 'lucide-react';
import type { Unit } from '@/api/units';

interface Props {
  unit: Unit;
  onClaim: (unitId: string) => void;
  claiming?: boolean;
}

function formatRent(rent: string | number): string {
  const n = typeof rent === 'string' ? Number(rent) : rent;
  return `$${Math.round(n).toLocaleString()}/mo`;
}

export function UnitCard({ unit, onClaim, claiming }: Props) {
  const photo = unit.photo_url || `https://picsum.photos/seed/${unit.id.slice(0, 8)}/800/600`;
  const location = [unit.property_city, unit.property_state].filter(Boolean).join(', ');

  return (
    <div className="overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-gray-200">
      <div className="aspect-[16/9] w-full overflow-hidden bg-gray-100">
        <img
          src={photo}
          alt={`Unit ${unit.unit_number}`}
          className="h-full w-full object-cover"
          loading="lazy"
        />
      </div>
      <div className="space-y-3 p-4">
        <div>
          <h3 className="text-base font-semibold text-gray-900">
            {unit.property_name} · Unit {unit.unit_number}
          </h3>
          {location && <p className="text-xs text-gray-500">{location}</p>}
        </div>

        <div className="text-lg font-bold text-emerald-700">{formatRent(unit.monthly_rent)}</div>

        <div className="flex flex-wrap gap-2 text-xs text-gray-600">
          <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-1">
            <Bed className="h-3 w-3" />
            {unit.bedrooms === 0 ? 'Studio' : `${unit.bedrooms} bd`}
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-1">
            <Bath className="h-3 w-3" />
            {unit.bathrooms} ba
          </span>
          {unit.sqft != null && (
            <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-1">
              <Square className="h-3 w-3" />
              {unit.sqft} sqft
            </span>
          )}
        </div>

        <button
          type="button"
          onClick={() => onClaim(unit.id)}
          disabled={claiming}
          className="btn-primary w-full"
        >
          {claiming ? 'Claiming…' : 'Claim this unit'}
        </button>
      </div>
    </div>
  );
}
