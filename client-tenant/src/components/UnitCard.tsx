import { Bed, Bath, Square, AlertCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Unit } from '@/api/units';
import { CTA } from '@/components/primitives';
import { HF } from '@/styles/tokens';
import { getUnitPhoto } from '@/utils/unitPlaceholder';
import { propertyAmiTier } from '@/utils/pricing';

export interface UnitMismatch {
  notes: string[];
}

interface Props {
  unit: Unit;
  onClaim: (unitId: string) => void;
  claiming?: boolean;
  mismatch?: UnitMismatch;
  // Wedge #9 — explicit AMI tier override. Defaults to the deterministic
  // mirror lookup by property name. Pass null to force-hide the tier line
  // (e.g., a future market-rate unit on the same surface).
  amiTier?: string | null;
}

function formatRent(rent: string | number): string {
  const n = typeof rent === 'string' ? Number(rent) : rent;
  return `$${Math.round(n).toLocaleString()}/mo`;
}

const chipStyle = {
  background: HF.cream,
  color: HF.ink3,
  border: `1px solid ${HF.border}`,
  borderRadius: HF.r.pill,
  padding: '4px 8px',
  fontFamily: HF.body,
} as const;

export function UnitCard({ unit, onClaim, claiming, mismatch, amiTier }: Props) {
  const { t } = useTranslation('discover');
  const photo = getUnitPhoto(unit.photo_url, unit.id);
  const location = [unit.property_city, unit.property_state].filter(Boolean).join(', ');
  const hasMismatch = mismatch && mismatch.notes.length > 0;
  // Resolve AMI tier: explicit prop wins (incl. null to hide); fall back to
  // the deterministic property→tier mirror.
  const resolvedAmiTier =
    amiTier === undefined ? propertyAmiTier(unit.property_name) : amiTier;

  return (
    <div
      className="overflow-hidden"
      style={{
        background: HF.paper,
        border: `1px solid ${HF.border}`,
        borderRadius: HF.r.lg,
        boxShadow: HF.shadow.sm,
        fontFamily: HF.body,
      }}
    >
      <div
        className="aspect-[16/9] w-full overflow-hidden"
        style={{ background: HF.cream }}
      >
        <img
          src={photo}
          alt={`Unit ${unit.unit_number}`}
          className="h-full w-full object-cover"
          loading="lazy"
        />
      </div>
      <div className="space-y-3 p-4">
        <div>
          <h3
            className="text-base font-semibold"
            style={{ color: HF.ink, fontFamily: HF.display }}
          >
            {unit.property_name} · Unit {unit.unit_number}
          </h3>
          {location && (
            <p className="text-xs" style={{ color: HF.ink3 }}>{location}</p>
          )}
        </div>

        <div className="text-lg font-bold" style={{ color: HF.accent }}>
          {formatRent(unit.monthly_rent)}
        </div>

        <div className="flex flex-wrap gap-2 text-xs">
          <span className="inline-flex items-center gap-1" style={chipStyle}>
            <Bed className="h-3 w-3" />
            {unit.bedrooms === 0 ? 'Studio' : `${unit.bedrooms} bd`}
          </span>
          <span className="inline-flex items-center gap-1" style={chipStyle}>
            <Bath className="h-3 w-3" />
            {unit.bathrooms} ba
          </span>
          {unit.sqft != null && (
            <span className="inline-flex items-center gap-1" style={chipStyle}>
              <Square className="h-3 w-3" />
              {unit.sqft} sqft
            </span>
          )}
        </div>

        {resolvedAmiTier && (
          <p
            data-testid="unit-ami-tier"
            aria-label={t('amiDisclosure.tooltip', { tier: resolvedAmiTier })}
            title={t('amiDisclosure.tooltip', { tier: resolvedAmiTier })}
            style={{
              margin: 0,
              fontSize: 12,
              color: HF.ink3,
              fontFamily: HF.body,
            }}
          >
            {t('amiDisclosure.setAsideHeading', { tier: resolvedAmiTier })}
          </p>
        )}

        {hasMismatch && (
          <ul
            aria-label="Differences from your preferences"
            className="space-y-1 text-xs"
            style={{
              background: `${HF.warn}14`,
              border: `1px solid ${HF.warn}33`,
              borderRadius: HF.r.sm,
              color: HF.warn,
              padding: '8px 10px',
              listStyle: 'none',
              margin: 0,
            }}
          >
            {mismatch!.notes.map((note, i) => (
              <li key={i} className="flex items-start gap-1.5">
                <AlertCircle className="h-3.5 w-3.5 shrink-0" style={{ marginTop: 1 }} />
                <span>{note}</span>
              </li>
            ))}
          </ul>
        )}

        <CTA
          type="button"
          onClick={() => onClaim(unit.id)}
          disabled={claiming}
        >
          {claiming ? 'Claiming…' : 'Claim this unit'}
        </CTA>
      </div>
    </div>
  );
}
