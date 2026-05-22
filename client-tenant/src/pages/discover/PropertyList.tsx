import { useEffect, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { fetchUnits } from '@/api/units';
import { getToken } from '@/api/client';
import {
  GPMG_FIXTURES,
  slugify,
  rentEstimate,
  type GPMGProperty,
  type GPMGType,
} from '@/api/gpmg-fixtures';
import { Card } from '@/components/primitives';
import { UNIT_PLACEHOLDER } from '@/utils/unitPlaceholder';
import { HF } from '@/styles/tokens';
import {
  getPropertyAvailability,
  propertyMatchesAmiTier,
  type BedroomBucket,
} from '@/utils/availability';
import {
  propertyRentRange,
  propertyAmiTier,
  formatRentBucket,
  populatedBuckets,
} from '@/utils/pricing';

type TypeFilter = 'all' | GPMGType;
type CityFilter = 'all' | 'Las Vegas' | 'North Las Vegas' | 'Henderson';
type BedroomFilter = 'all' | 'studio' | '1' | '2' | '3';

const TYPE_LABELS: Record<TypeFilter, string> = {
  all: 'All',
  senior: 'Senior',
  family: 'Family',
};

const CITY_LABELS: Record<CityFilter, string> = {
  all: 'All',
  'Las Vegas': 'Las Vegas',
  'North Las Vegas': 'N. Las Vegas',
  Henderson: 'Henderson',
};

const VALID_AMI_TIERS = new Set(['30', '50', '60', '80'] as const);
type AmiTier = '30' | '50' | '60' | '80';

function ChipButton({
  active,
  onClick,
  children,
  testId,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  testId?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-active={active}
      data-testid={testId}
      style={{
        background: active ? HF.accent : HF.paper,
        color: active ? HF.paper : HF.ink2,
        border: `1px solid ${active ? HF.accent : HF.border}`,
        borderRadius: HF.r.pill,
        padding: '6px 14px',
        fontSize: 13,
        fontWeight: 600,
        fontFamily: HF.body,
        cursor: 'pointer',
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </button>
  );
}

function bedroomBucketFromFilter(filter: BedroomFilter): BedroomBucket | null {
  switch (filter) {
    case 'studio':
      return 'studio';
    case '1':
      return 'br1';
    case '2':
      return 'br2';
    case '3':
      return 'br3';
    default:
      return null;
  }
}

export function PropertyList() {
  const { t } = useTranslation('discover');
  const [params, setParams] = useSearchParams();

  // Single source of truth for filters: URL params. This is what lets the
  // chips deep-link cleanly and what the AMI-banner X-button needs to
  // dismiss (just drop the param). It also means a reload preserves filter
  // state, which matches the rest of the wizard.
  const typeFilter = (params.get('type') as TypeFilter | null) ?? 'all';
  const cityFilter = (params.get('city') as CityFilter | null) ?? 'all';
  const bedroomFilter = (params.get('bedroom') as BedroomFilter | null) ?? 'all';
  const availableNow = params.get('availability') === 'available_now';

  const amiTierRaw = params.get('amiTier');
  const amiTier: AmiTier | null =
    amiTierRaw && VALID_AMI_TIERS.has(amiTierRaw as AmiTier)
      ? (amiTierRaw as AmiTier)
      : null;

  const updateParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value === null || value === '') {
      next.delete(key);
    } else {
      next.set(key, value);
    }
    setParams(next, { replace: true });
  };

  useEffect(() => {
    // Authed users still get the live catalog warm-fetched so cached
    // responses are ready for downstream pages (intent/pick).
    // The public discover view always renders from GPMG_FIXTURES below.
    const authed = !!getToken();
    if (!authed) return;
    let alive = true;
    fetchUnits({})
      .catch(() => {
        /* tolerate — discover doesn't depend on this */
      })
      .finally(() => {
        if (!alive) return;
      });
    return () => {
      alive = false;
    };
  }, []);

  const filtered = useMemo(() => {
    const bucket = bedroomBucketFromFilter(bedroomFilter);
    return GPMG_FIXTURES.filter((p) => {
      if (typeFilter !== 'all' && p.type !== typeFilter) return false;
      if (cityFilter !== 'all' && p.city !== cityFilter) return false;
      if (amiTier && !propertyMatchesAmiTier(p, amiTier)) return false;

      // Bedroom / availability filters compare against the deterministic
      // availability rollup (mirrors the seed). Studio/1BR/2BR/3BR show only
      // properties with at least one available unit of that size.
      if (bucket || availableNow) {
        const avail = getPropertyAvailability(p.name);
        if (availableNow && avail.availableCount === 0) return false;
        if (bucket && avail.bedroomBreakdown[bucket] === 0) return false;
      }
      return true;
    });
  }, [typeFilter, cityFilter, bedroomFilter, availableNow, amiTier]);

  return (
    <div
      style={{ background: HF.cream, minHeight: '100vh', fontFamily: HF.body, color: HF.ink }}
    >
      <div className="mx-auto max-w-5xl p-4 sm:p-6">
        <header className="mb-4">
          <h1
            style={{
              fontFamily: HF.display,
              fontWeight: 800,
              fontSize: 22,
              color: HF.ink,
              letterSpacing: '-0.01em',
            }}
          >
            Find your home
          </h1>
          <p style={{ marginTop: 4, fontSize: 14, color: HF.ink3 }}>
            17 affordable communities across the Las Vegas valley
          </p>
        </header>

        {amiTier && (
          <div
            data-testid="ami-banner"
            role="status"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              background: HF.accentLo,
              color: HF.accentInk,
              border: '1px solid #F3D7CB',
              borderRadius: HF.r.md,
              padding: '10px 14px',
              fontSize: 13,
              fontWeight: 600,
              marginBottom: 12,
            }}
          >
            <span style={{ flex: 1 }}>
              {t('amiBanner.text', { tier: amiTier })}
            </span>
            <button
              type="button"
              aria-label={t('amiBanner.dismiss')}
              data-testid="ami-banner-dismiss"
              onClick={() => updateParam('amiTier', null)}
              style={{
                background: 'transparent',
                border: 'none',
                color: HF.accentInk,
                cursor: 'pointer',
                fontSize: 18,
                lineHeight: 1,
                padding: 4,
              }}
            >
              ×
            </button>
          </div>
        )}

        <div
          className="sticky top-12 z-10 -mx-4 px-4 py-3 sm:-mx-6 sm:px-6"
          style={{ background: HF.cream, borderBottom: `1px solid ${HF.border}` }}
        >
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2 overflow-x-auto">
              <span
                style={{
                  fontSize: 12,
                  color: HF.ink3,
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  fontWeight: 700,
                  minWidth: 36,
                }}
              >
                {t('filter.type')}
              </span>
              {(Object.keys(TYPE_LABELS) as TypeFilter[]).map((k) => (
                <ChipButton
                  key={k}
                  active={typeFilter === k}
                  onClick={() => updateParam('type', k === 'all' ? null : k)}
                >
                  {TYPE_LABELS[k]}
                </ChipButton>
              ))}
            </div>
            <div className="flex items-center gap-2 overflow-x-auto">
              <span
                style={{
                  fontSize: 12,
                  color: HF.ink3,
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  fontWeight: 700,
                  minWidth: 36,
                }}
              >
                {t('filter.city')}
              </span>
              {(Object.keys(CITY_LABELS) as CityFilter[]).map((k) => (
                <ChipButton
                  key={k}
                  active={cityFilter === k}
                  onClick={() => updateParam('city', k === 'all' ? null : k)}
                >
                  {CITY_LABELS[k]}
                </ChipButton>
              ))}
            </div>
            <div
              className="flex items-center gap-2 overflow-x-auto"
              data-testid="bedroom-filter-row"
            >
              <span
                style={{
                  fontSize: 12,
                  color: HF.ink3,
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  fontWeight: 700,
                  minWidth: 36,
                }}
              >
                {t('filter.bedroom')}
              </span>
              {(['all', 'studio', '1', '2', '3'] as BedroomFilter[]).map((k) => (
                <ChipButton
                  key={k}
                  active={bedroomFilter === k}
                  testId={`chip-bedroom-${k}`}
                  onClick={() => updateParam('bedroom', k === 'all' ? null : k)}
                >
                  {k === 'all' ? TYPE_LABELS.all : t(`filter.bedroom.${k}`)}
                </ChipButton>
              ))}
            </div>
            <div className="flex items-center gap-2 overflow-x-auto">
              <span
                style={{
                  fontSize: 12,
                  color: HF.ink3,
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  fontWeight: 700,
                  minWidth: 36,
                }}
              >
                {t('filter.availability')}
              </span>
              <ChipButton
                active={availableNow}
                testId="chip-available-now"
                onClick={() =>
                  updateParam('availability', availableNow ? null : 'available_now')
                }
              >
                {t('filter.availableNow')}
              </ChipButton>
            </div>
          </div>
        </div>

        <p style={{ margin: '16px 0 8px', fontSize: 13, color: HF.ink3 }} data-testid="result-count">
          {filtered.length} {filtered.length === 1 ? 'community' : 'communities'}
        </p>

        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2" data-testid="property-grid">
          {filtered.map((p) => (
            <PropertyTile key={p.name} prop={p} />
          ))}
        </ul>
      </div>
    </div>
  );
}

function AvailabilityBadge({ availableCount }: { availableCount: number }) {
  const { t } = useTranslation('discover');
  if (availableCount === 0) {
    return (
      <span
        data-testid="availability-badge"
        data-state="fully-leased"
        style={{
          background: HF.paper,
          color: HF.ink3,
          border: `1px solid ${HF.border}`,
          borderRadius: HF.r.pill,
          padding: '2px 10px',
          fontSize: 11,
          fontWeight: 700,
          fontFamily: HF.body,
        }}
      >
        {t('badge.fullyLeased')}
      </span>
    );
  }
  return (
    <span
      data-testid="availability-badge"
      data-state="available"
      style={{
        background: HF.sageLo,
        color: HF.ink2,
        border: `1px solid ${HF.border}`,
        borderRadius: HF.r.pill,
        padding: '2px 10px',
        fontSize: 11,
        fontWeight: 700,
        fontFamily: HF.body,
      }}
    >
      {t('badge.available', { count: availableCount })}
    </span>
  );
}

function PropertyTile({ prop }: { prop: GPMGProperty }) {
  const { t } = useTranslation('discover');
  const slug = slugify(prop.name);
  const est = rentEstimate(prop);
  const availability = getPropertyAvailability(prop.name);
  // For DL2 (units=null in fixture, but seed.ts seeds 48), we still want a
  // count. We trust the rollup even when fixture `units` is null — the
  // sentinel test asserts the rollup totals reflect the seed truth.
  const showCount = availability.totalUnits > 0;

  // Wedge #9 — per-bedroom rent ranges + AMI tier. Only populated buckets
  // render (no "Studio $0" placeholders) and the chip only appears for
  // properties with a real set-aside (all 17 GPMG fixtures qualify today).
  const rentRange = propertyRentRange(prop.name);
  const buckets = populatedBuckets(rentRange);
  const amiTier = propertyAmiTier(prop.name);

  return (
    <li>
      <Link
        to={`/property/${slug}`}
        aria-label={prop.name}
        data-testid={`property-tile-${slug}`}
        style={{
          display: 'block',
          textDecoration: 'none',
          color: 'inherit',
          borderRadius: HF.r.md,
        }}
      >
        <Card variant="mobile" padding={0} elevation="sm" style={{ overflow: 'hidden' }}>
          <div
            className="aspect-[16/9] w-full"
            style={{
              background: `${HF.sageLo}`,
              backgroundImage: `url(${UNIT_PLACEHOLDER})`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
            }}
            aria-hidden="true"
          />
          <div style={{ padding: 16 }}>
            <h2
              style={{
                fontFamily: HF.display,
                fontWeight: 700,
                fontSize: 16,
                color: HF.ink,
                margin: 0,
                lineHeight: 1.25,
              }}
            >
              {prop.name}
            </h2>
            <p style={{ margin: '4px 0 0', fontSize: 12, color: HF.ink3 }}>
              {prop.addr} · {prop.city}, NV {prop.zip}
            </p>
            <div
              className="flex items-center justify-between"
              style={{ marginTop: 10, gap: 8 }}
            >
              <span style={{ fontSize: 12, color: HF.ink3 }}>
                {showCount
                  ? `${availability.totalUnits} units`
                  : prop.units !== null
                  ? `${prop.units} units`
                  : ''}
              </span>
              <div className="flex items-center" style={{ gap: 6 }}>
                {amiTier && (
                  <span
                    data-testid={`ami-tier-chip-${slug}`}
                    aria-label={t('amiDisclosure.tooltip', { tier: amiTier })}
                    title={t('amiDisclosure.tooltip', { tier: amiTier })}
                    style={{
                      background: HF.sageLo,
                      color: HF.sage,
                      border: `1px solid ${HF.border}`,
                      borderRadius: HF.r.pill,
                      padding: '2px 10px',
                      fontSize: 11,
                      fontWeight: 700,
                      fontFamily: HF.body,
                    }}
                  >
                    {t('amiDisclosure.chipLabel', { tier: amiTier })}
                  </span>
                )}
                <span
                  style={{
                    background: HF.accentLo,
                    color: HF.accentInk,
                    border: '1px solid #F3D7CB',
                    borderRadius: HF.r.pill,
                    padding: '2px 10px',
                    fontSize: 11,
                    fontWeight: 700,
                    textTransform: 'capitalize',
                    fontFamily: HF.body,
                  }}
                >
                  {prop.type}
                </span>
              </div>
            </div>
            <div
              className="flex items-center justify-between"
              style={{
                marginTop: 12,
                paddingTop: 12,
                borderTop: `1px solid ${HF.border}`,
                gap: 8,
              }}
            >
              <span
                style={{
                  fontFamily: HF.display,
                  fontWeight: 700,
                  fontSize: 14,
                  color: HF.ink,
                }}
              >
                From ${est}/mo
              </span>
              <div className="flex items-center" style={{ gap: 8 }}>
                <AvailabilityBadge availableCount={availability.availableCount} />
                <span
                  style={{
                    fontSize: 13,
                    color: HF.accent,
                    fontWeight: 600,
                  }}
                >
                  View →
                </span>
              </div>
            </div>
            {buckets.length > 0 && (
              <div
                data-testid={`rent-row-${slug}`}
                style={{
                  marginTop: 10,
                  fontSize: 12,
                  color: HF.ink2,
                  fontFamily: HF.body,
                  lineHeight: 1.5,
                }}
              >
                {buckets.map(({ key, bucket }, idx) => (
                  <span key={key}>
                    {idx > 0 && (
                      <span aria-hidden="true" style={{ color: HF.ink4, margin: '0 6px' }}>
                        ·
                      </span>
                    )}
                    <span style={{ fontWeight: 600, color: HF.ink }}>
                      {t(`pricing.label.${key}`)}
                    </span>{' '}
                    <span>{formatRentBucket(bucket)}</span>
                  </span>
                ))}
              </div>
            )}
          </div>
        </Card>
      </Link>
    </li>
  );
}
