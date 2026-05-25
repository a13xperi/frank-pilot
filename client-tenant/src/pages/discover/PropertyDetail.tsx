import { useMemo, useState, useEffect } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft, WashingMachine, UserCheck, CigaretteOff, Bus, ArrowUpDown,
  Accessibility, Users, Car, Snowflake, Trees, Baby, Waves, TreePine,
  GraduationCap, ShoppingCart, Cross, Footprints, Volume1,
  type LucideIcon,
} from 'lucide-react';
import { useTranslation, Trans } from 'react-i18next';
import { findGPMGBySlug, rentEstimate, slugify } from '@/api/gpmg-fixtures';
import {
  representativeSqft,
  representativeAmenities,
  representativeNeighborhood,
  type AmenityKey,
  type NearbyKind,
} from '@/utils/propertyProfile';
import { CTA } from '@/components/primitives';
import { getToken } from '@/api/client';
import { placeholderFor } from '@/utils/unitPlaceholder';
import { HF } from '@/styles/tokens';
import {
  getPropertyAvailability,
  type BedroomBucket,
} from '@/utils/availability';
import {
  propertyRentRange,
  propertyAmiTier,
  formatRentBucket,
  populatedBuckets,
  type BedroomBucket as PricingBedroomBucket,
} from '@/utils/pricing';
import { incomeLimit, maxRent, type BedroomKey } from '@/lib/ami';
import { cityToCountyKey } from '@/lib/nv-counties';
import { LIMITS_2026 } from '@/lib/limits-2026.generated';
import { PropertyJsonLd } from '@/components/PropertyJsonLd';

// Household sizes 1–12 for the official 2026 income-limits disclosure.
const HOUSEHOLD_SIZES: ReadonlyArray<number> = [
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
];

const RENT_TABLE_BEDROOM_I18N: Record<PricingBedroomBucket, string> = {
  studio: 'availability.studio',
  br1: 'availability.1',
  br2: 'availability.2',
  br3: 'availability.3',
};

function formatUSD(n: number): string {
  return `$${n.toLocaleString('en-US')}`;
}

// Icon per representative amenity. Labels come from i18n (`amenities.item.*`).
const AMENITY_ICONS: Record<AmenityKey, LucideIcon> = {
  laundry: WashingMachine,
  manager: UserCheck,
  smokefree: CigaretteOff,
  transit: Bus,
  elevator: ArrowUpDown,
  accessible: Accessibility,
  community: Users,
  parking: Car,
  ac: Snowflake,
  courtyard: Trees,
  playground: Baby,
  pool: Waves,
};

// Icon per nearby place kind. Labels come from i18n (`neighborhood.place.*`).
const NEARBY_ICONS: Record<NearbyKind, LucideIcon> = {
  park: TreePine,
  school: GraduationCap,
  grocery: ShoppingCart,
  transit: Bus,
  pharmacy: Cross,
};

const VALID_AMI_TIERS = new Set(['30', '50', '60', '80'] as const);
type AmiTier = '30' | '50' | '60' | '80';

// Map the pricing bedroom buckets (studio/br1/br2/br3) onto the official
// rent-limit bedroom keys. Studio == Efficiency in the Novogradac export.
const BUCKET_TO_BEDROOM_KEY: Record<PricingBedroomBucket, BedroomKey> = {
  studio: 'eff',
  br1: 'br1',
  br2: 'br2',
  br3: 'br3',
};

/** Parse a set-aside label ("60% AMI") into a validated AMI tier ("60"). */
function parseSetAsideTier(setAside: string | null): AmiTier | null {
  if (!setAside) return null;
  const digits = setAside.match(/^\d+/)?.[0];
  return digits && VALID_AMI_TIERS.has(digits as AmiTier)
    ? (digits as AmiTier)
    : null;
}

const BEDROOM_BUCKETS: ReadonlyArray<{ key: BedroomBucket; i18nKey: string }> = [
  { key: 'studio', i18nKey: 'availability.studio' },
  { key: 'br1', i18nKey: 'availability.1' },
  { key: 'br2', i18nKey: 'availability.2' },
  { key: 'br3', i18nKey: 'availability.3' },
];

export function PropertyDetail() {
  const { slug = '' } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { t } = useTranslation('discover');
  // Fixture lookup is an array scan — memoize on slug so i18n-namespace loads
  // and searchParams churn don't re-scan the catalog on every render.
  const prop = useMemo(() => findGPMGBySlug(slug), [slug]);

  // Coordinates for the location mini-map. The GPMG fixtures don't carry
  // lat/lng — coords live in nv-gpmg-map-props.json, the same dataset the
  // /discover map uses (single source of truth), keyed by slug. Fetched once
  // per slug; the map section only renders when a match is found.
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  useEffect(() => {
    if (!slug) return;
    let cancelled = false;
    fetch('/nv-gpmg-map-props.json')
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((rows: Array<{ slug?: string; name?: string; lat?: number; lng?: number }>) => {
        if (cancelled) return;
        const hit = rows.find(
          (r) => r.slug === slug || (r.name != null && slugify(r.name) === slug),
        );
        if (hit && typeof hit.lat === 'number' && typeof hit.lng === 'number') {
          setCoords({ lat: hit.lat, lng: hit.lng });
        } else {
          setCoords(null);
        }
      })
      .catch(() => {
        /* dataset unavailable → no map, no error surfaced */
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  // Preserve a deep-linked amiTier when bouncing to /apply so the W0 funnel
  // continues to know the applicant's tier. Validated against the same set
  // as the AMI calculator emits.
  const amiTierRaw = params.get('amiTier');
  const amiTier: AmiTier | null =
    amiTierRaw && VALID_AMI_TIERS.has(amiTierRaw as AmiTier)
      ? (amiTierRaw as AmiTier)
      : null;

  // All per-property derivations are pure functions of `prop`. Memoizing the
  // whole block on the fixture identity means the availability/pricing/AMI
  // rollups (small loops, but several of them) run once per navigation rather
  // than on every render (i18n suspense resolve, searchParams update, etc.).
  // Computed before the early return to keep hook order stable when `prop` is
  // undefined; the values are simply unused in the not-found branch.
  const derived = useMemo(() => {
    if (!prop) return null;
    // Wedge #9 — rent range + AMI disclosure. `rentBuckets` drives the per-
    // bedroom table; `propertySetAside` is "60% AMI" for every GPMG fixture
    // today. Distinct from the URL `amiTier` deep-link (applicant's tier).
    const rentRange = propertyRentRange(prop.name);
    const rentBuckets = populatedBuckets(rentRange);
    const propertySetAside = propertyAmiTier(prop.name);
    const countyKey = cityToCountyKey(prop.city);
    const setAsideTier = parseSetAsideTier(propertySetAside);
    const availability = getPropertyAvailability(prop.name);
    // Floor plans = REAL rent (rentBuckets) + REAL availability (per-bucket
    // counts) + a representative unit size. One card per bedroom bucket the
    // property actually offers (drives off the rent schedule).
    const floorPlans = rentBuckets.map(({ key, bucket }) => ({
      key,
      bucket,
      sqft: representativeSqft(slug, key),
      available: availability.bedroomBreakdown[key],
    }));
    return {
      est: rentEstimate(prop),
      availability,
      rentBuckets,
      floorPlans,
      amenities: representativeAmenities(slug, prop.type),
      neighborhood: representativeNeighborhood(slug),
      propertySetAside,
      countyKey,
      setAsideTier,
      countyMsa: countyKey ? LIMITS_2026[countyKey].msa : '',
      showAmiDisclosure: !!propertySetAside && rentBuckets.length > 0,
    };
  }, [prop, slug]);

  if (!prop) {
    return (
      <div
        style={{ background: HF.cream, minHeight: '100vh', fontFamily: HF.body }}
      >
        <div className="mx-auto max-w-3xl p-6">
          <Link
            to="/discover"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 14,
              color: HF.accent,
              textDecoration: 'none',
              fontWeight: 600,
            }}
          >
            <ArrowLeft className="h-4 w-4" /> Back
          </Link>
          <p style={{ marginTop: 16, fontSize: 14, color: HF.ink3 }}>
            Property not found.
          </p>
        </div>
      </div>
    );
  }

  // `derived` is non-null here: it returns null only when `prop` is falsy,
  // and that path already returned above.
  const {
    est,
    availability,
    rentBuckets,
    floorPlans,
    amenities,
    neighborhood,
    propertySetAside,
    countyKey,
    setAsideTier,
    countyMsa,
    showAmiDisclosure,
  } = derived!;
  const hasAvailability = availability.availableCount > 0;

  const onApply = () => {
    // Apply requires auth; bounce unauthed users through /login with a return.
    // Preserve the AMI deep-link signal so W0 prefill still works when the
    // user reaches /apply via /discover.
    const qs = new URLSearchParams({
      step: 'intent',
      unitType: '2BR',
      propertyId: slug,
    });
    if (amiTier) qs.set('amiTier', amiTier);
    const target = `/apply?${qs.toString()}`;
    navigate(getToken() ? target : `/login?return=${encodeURIComponent(target)}`);
  };

  const onApplyForProperty = () => {
    // CTA shown only when the property has at least one available unit.
    // Forwards amiTier when deep-linked so the funnel continues to know the
    // applicant's tier.
    const qs = new URLSearchParams({
      propertyId: slug,
    });
    if (amiTier) qs.set('amiTier', amiTier);
    const target = `/apply?${qs.toString()}`;
    navigate(getToken() ? target : `/login?return=${encodeURIComponent(target)}`);
  };

  return (
    <div
      style={{ background: HF.cream, minHeight: '100vh', fontFamily: HF.body, color: HF.ink }}
    >
      {/* wedge #14 — RealEstateListing JSON-LD. Renders null; injects a single
          <script type="application/ld+json"> into <head> for the lifetime of
          the page. No visual impact. */}
      <PropertyJsonLd property={prop} />
      <div className="mx-auto max-w-3xl">
        <div className="relative">
          <div
            className="aspect-[16/9] w-full"
            style={{
              background: HF.sageLo,
              backgroundImage: `url(${placeholderFor(slug, prop.name)})`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
            }}
            aria-hidden="true"
          />
          {/* Hero is a generated neutral brand placeholder (gradient + glyph +
              property name), not a photo — so no "photo" label is needed. */}
          <Link
            to="/discover"
            aria-label="Back"
            style={{
              position: 'absolute',
              left: 12,
              top: 12,
              display: 'inline-flex',
              height: 40,
              width: 40,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: HF.r.pill,
              background: HF.paper,
              color: HF.ink,
              boxShadow: HF.shadow.sm,
              textDecoration: 'none',
            }}
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
        </div>

        <div className="px-4 pb-32 pt-5 sm:px-6">
          <header>
            <h1
              style={{
                fontFamily: HF.display,
                fontWeight: 800,
                fontSize: 24,
                color: HF.ink,
                margin: 0,
                letterSpacing: '-0.01em',
              }}
            >
              {prop.name}
            </h1>
            <p style={{ margin: '6px 0 0', fontSize: 14, color: HF.ink3 }}>
              {prop.addr} · {prop.city}, NV {prop.zip}
            </p>
            <div className="flex items-center gap-3" style={{ marginTop: 10 }}>
              <span
                style={{
                  background: HF.accentLo,
                  color: HF.accentInk,
                  border: '1px solid #F3D7CB',
                  borderRadius: HF.r.pill,
                  padding: '2px 12px',
                  fontSize: 12,
                  fontWeight: 700,
                  textTransform: 'capitalize',
                }}
              >
                {prop.type}
              </span>
              <span
                style={{
                  fontFamily: HF.display,
                  fontWeight: 700,
                  fontSize: 16,
                  color: HF.ink,
                }}
              >
                From ${est}/mo
              </span>
            </div>
          </header>

          {/* Location mini-map. Renders only when we have coords for this slug
              (from nv-gpmg-map-props.json). Embedded as an iframe — same Leaflet
              + warmed-OSM stack as the /discover map, no map dep in the bundle.
              "Approximate location" + a directions link keep it honest. */}
          {coords && (
            <section
              data-testid="property-minimap"
              style={{
                marginTop: 24,
                background: HF.paper,
                border: `1px solid ${HF.border}`,
                borderRadius: HF.r.md,
                overflow: 'hidden',
                boxShadow: HF.shadow.xs,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'baseline',
                  justifyContent: 'space-between',
                  gap: 12,
                  padding: '14px 16px 10px',
                }}
              >
                <h2
                  style={{
                    fontFamily: HF.display,
                    fontWeight: 700,
                    fontSize: 14,
                    color: HF.ink2,
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    margin: 0,
                  }}
                >
                  Location
                </h2>
                <a
                  href={`https://www.google.com/maps/search/?api=1&query=${coords.lat},${coords.lng}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    fontSize: 13,
                    fontWeight: 700,
                    color: HF.accent,
                    textDecoration: 'none',
                    whiteSpace: 'nowrap',
                  }}
                >
                  Directions ↗
                </a>
              </div>
              <iframe
                title={`Map of ${prop.name}`}
                src={`/property-minimap.html?lat=${coords.lat}&lng=${coords.lng}&type=${prop.type}&label=${encodeURIComponent(prop.name)}`}
                loading="lazy"
                style={{
                  display: 'block',
                  width: '100%',
                  height: 200,
                  border: 'none',
                }}
              />
              <p
                style={{
                  margin: 0,
                  padding: '8px 16px 12px',
                  fontSize: 12,
                  color: HF.ink3,
                  fontFamily: HF.body,
                }}
              >
                {prop.addr} · {prop.city}, NV {prop.zip} · approximate location
              </p>
            </section>
          )}

          {/* Wedge #9 — Rent & AMI disclosure (the gpmglv differentiator).
              Honest, public, per-bedroom rent figures + the 60% AMI set-
              aside callout. Sits above Live availability so a user can see
              "yes, I can afford this and I qualify" before counting units. */}
          {showAmiDisclosure && (
            <section
              data-testid="rent-ami-disclosure"
              style={{
                marginTop: 24,
                background: HF.paper,
                border: `1px solid ${HF.border}`,
                borderRadius: HF.r.md,
                padding: 16,
                boxShadow: HF.shadow.xs,
              }}
            >
              <h2
                style={{
                  fontFamily: HF.display,
                  fontWeight: 700,
                  fontSize: 14,
                  color: HF.ink2,
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  margin: 0,
                }}
              >
                {t('amiDisclosure.sectionTitle')}
              </h2>

              <table
                data-testid="rent-table"
                style={{
                  width: '100%',
                  marginTop: 12,
                  borderCollapse: 'collapse',
                  fontSize: 13,
                  color: HF.ink2,
                }}
              >
                <thead>
                  <tr style={{ textAlign: 'left', color: HF.ink3 }}>
                    <th
                      scope="col"
                      style={{
                        padding: '6px 8px',
                        borderBottom: `1px solid ${HF.border}`,
                        fontWeight: 700,
                        fontSize: 12,
                        textTransform: 'uppercase',
                        letterSpacing: '0.04em',
                      }}
                    >
                      {t('amiDisclosure.tableHeader.bedroom')}
                    </th>
                    <th
                      scope="col"
                      style={{
                        padding: '6px 8px',
                        borderBottom: `1px solid ${HF.border}`,
                        fontWeight: 700,
                        fontSize: 12,
                        textTransform: 'uppercase',
                        letterSpacing: '0.04em',
                        textAlign: 'right',
                      }}
                    >
                      {t('amiDisclosure.tableHeader.rent')}
                    </th>
                    {countyKey && setAsideTier && (
                      <th
                        scope="col"
                        style={{
                          padding: '6px 8px',
                          borderBottom: `1px solid ${HF.border}`,
                          fontWeight: 700,
                          fontSize: 12,
                          textTransform: 'uppercase',
                          letterSpacing: '0.04em',
                          textAlign: 'right',
                        }}
                      >
                        {t('amiDisclosure.tableHeader.maxRent', {
                          tier: propertySetAside,
                        })}
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {rentBuckets.map(({ key, bucket }) => (
                    <tr key={key} data-testid={`rent-row-${key}`}>
                      <td
                        style={{
                          padding: '8px',
                          borderBottom: `1px solid ${HF.border}`,
                          color: HF.ink,
                          fontWeight: 600,
                        }}
                      >
                        {t(RENT_TABLE_BEDROOM_I18N[key])}
                      </td>
                      <td
                        style={{
                          padding: '8px',
                          borderBottom: `1px solid ${HF.border}`,
                          color: HF.ink,
                          textAlign: 'right',
                          fontVariantNumeric: 'tabular-nums',
                        }}
                      >
                        {formatRentBucket(bucket)}
                        <span style={{ color: HF.ink3 }}>{t('pricing.suffix')}</span>
                      </td>
                      {countyKey && setAsideTier && (
                        <td
                          data-testid={`rent-cap-${key}`}
                          style={{
                            padding: '8px',
                            borderBottom: `1px solid ${HF.border}`,
                            color: HF.ink3,
                            textAlign: 'right',
                            fontVariantNumeric: 'tabular-nums',
                          }}
                        >
                          {(() => {
                            const cap = maxRent(
                              countyKey,
                              setAsideTier,
                              BUCKET_TO_BEDROOM_KEY[key],
                            );
                            return cap != null ? formatUSD(cap) : '—';
                          })()}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>

              <div
                data-testid="set-aside-explainer"
                style={{
                  marginTop: 14,
                  background: HF.sageLo,
                  border: `1px solid ${HF.border}`,
                  borderRadius: HF.r.sm,
                  padding: 12,
                }}
              >
                <p
                  style={{
                    margin: 0,
                    fontFamily: HF.display,
                    fontWeight: 700,
                    fontSize: 14,
                    color: HF.sage,
                  }}
                >
                  {t('amiDisclosure.setAsideHeading', { tier: propertySetAside })}
                </p>
                <p
                  style={{
                    margin: '6px 0 0',
                    fontSize: 13,
                    color: HF.ink2,
                    lineHeight: 1.5,
                  }}
                >
                  <Trans
                    i18nKey="amiDisclosure.explainer"
                    t={t}
                    values={{ tier: propertySetAside }}
                    components={{
                      1: (
                        <Link
                          to="/"
                          data-testid="income-calculator-link"
                          style={{
                            color: HF.accent,
                            textDecoration: 'underline',
                            fontWeight: 600,
                          }}
                        />
                      ),
                    }}
                  />
                </p>
              </div>

              <details
                data-testid="income-limits-disclosure"
                style={{ marginTop: 12 }}
              >
                <summary
                  style={{
                    cursor: 'pointer',
                    fontSize: 13,
                    color: HF.accent,
                    fontWeight: 600,
                    fontFamily: HF.body,
                  }}
                >
                  {t('amiDisclosure.incomeLimitsToggle')}
                </summary>
                {countyKey && setAsideTier ? (
                  <>
                <p
                  style={{
                    margin: '10px 0 0',
                    fontSize: 12,
                    color: HF.ink3,
                  }}
                >
                  {t('amiDisclosure.incomeLimitsTitle', {
                    tier: propertySetAside,
                    msa: countyMsa,
                  })}
                </p>
                <table
                  data-testid="income-limits-table"
                  style={{
                    width: '100%',
                    marginTop: 8,
                    borderCollapse: 'collapse',
                    fontSize: 13,
                    color: HF.ink2,
                  }}
                >
                  <thead>
                    <tr style={{ textAlign: 'left', color: HF.ink3 }}>
                      <th
                        scope="col"
                        style={{
                          padding: '6px 8px',
                          borderBottom: `1px solid ${HF.border}`,
                          fontWeight: 700,
                          fontSize: 12,
                          textTransform: 'uppercase',
                          letterSpacing: '0.04em',
                        }}
                      >
                        {t('amiDisclosure.incomeLimitsHeader.size')}
                      </th>
                      <th
                        scope="col"
                        style={{
                          padding: '6px 8px',
                          borderBottom: `1px solid ${HF.border}`,
                          fontWeight: 700,
                          fontSize: 12,
                          textTransform: 'uppercase',
                          letterSpacing: '0.04em',
                          textAlign: 'right',
                        }}
                      >
                        {t('amiDisclosure.incomeLimitsHeader.max')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {HOUSEHOLD_SIZES.map((size) => (
                      <tr key={size} data-testid={`income-limits-row-${size}`}>
                        <td
                          style={{
                            padding: '6px 8px',
                            borderBottom: `1px solid ${HF.border}`,
                            color: HF.ink,
                          }}
                        >
                          {t('amiDisclosure.incomeLimitsRow', { count: size })}
                        </td>
                        <td
                          style={{
                            padding: '6px 8px',
                            borderBottom: `1px solid ${HF.border}`,
                            color: HF.ink,
                            textAlign: 'right',
                            fontVariantNumeric: 'tabular-nums',
                          }}
                        >
                          {formatUSD(incomeLimit(countyKey, setAsideTier, size))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p
                  data-testid="income-limits-source"
                  style={{
                    margin: '8px 0 0',
                    fontSize: 11,
                    color: HF.ink3,
                    lineHeight: 1.4,
                  }}
                >
                  {t('amiDisclosure.incomeLimitsSource')}
                </p>
                  </>
                ) : (
                  <p
                    data-testid="income-limits-coming-soon"
                    style={{
                      margin: '10px 0 0',
                      fontSize: 13,
                      color: HF.ink3,
                      lineHeight: 1.5,
                    }}
                  >
                    {t('amiDisclosure.comingSoonNote', { city: prop.city })}
                  </p>
                )}
              </details>
            </section>
          )}

          {/* Live availability section — bedroom-grouped counts derived from
              the deterministic seed rollup. Hidden when totalUnits=0 (e.g.
              an off-catalog or unfixtured property). */}
          {availability.totalUnits > 0 && (
            <section
              data-testid="live-availability"
              style={{
                marginTop: 24,
                background: HF.paper,
                border: `1px solid ${HF.border}`,
                borderRadius: HF.r.md,
                padding: 16,
                boxShadow: HF.shadow.xs,
              }}
            >
              <h2
                style={{
                  fontFamily: HF.display,
                  fontWeight: 700,
                  fontSize: 14,
                  color: HF.ink2,
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  margin: 0,
                }}
              >
                {t('availability.title')}
              </h2>
              {hasAvailability ? (
                <ul
                  className="grid grid-cols-2 gap-2"
                  style={{ margin: '12px 0 0', padding: 0, listStyle: 'none' }}
                  data-testid="availability-grid"
                >
                  {BEDROOM_BUCKETS.map(({ key, i18nKey }) => {
                    const count = availability.bedroomBreakdown[key];
                    if (count === 0) return null;
                    return (
                      <li
                        key={key}
                        data-testid={`availability-${key}`}
                        style={{
                          background: HF.cream,
                          border: `1px solid ${HF.border}`,
                          borderRadius: HF.r.sm,
                          padding: '10px 12px',
                          fontSize: 13,
                          color: HF.ink2,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                        }}
                      >
                        <span style={{ fontWeight: 700, color: HF.ink }}>
                          {t(i18nKey)}
                        </span>
                        <span style={{ color: HF.accentInk }}>
                          {t('availability.unit', { count })}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p
                  style={{ margin: '12px 0 0', fontSize: 13, color: HF.ink3 }}
                  data-testid="availability-empty"
                >
                  {t('availability.empty')}
                </p>
              )}
              {hasAvailability && (
                <div style={{ marginTop: 16 }}>
                  <CTA
                    tone="primary"
                    block
                    onClick={onApplyForProperty}
                    data-testid="apply-for-property-cta"
                  >
                    {t('applyForProperty')} →
                  </CTA>
                </div>
              )}
            </section>
          )}

          {/* Floor plans — one card per bedroom bucket the community offers.
              Rent and availability are REAL (seeded rollups); unit sizes are
              representative, called out in the footnote. */}
          {floorPlans.length > 0 && (
            <section
              data-testid="floor-plans"
              style={{
                marginTop: 24,
                background: HF.paper,
                border: `1px solid ${HF.border}`,
                borderRadius: HF.r.md,
                padding: 16,
                boxShadow: HF.shadow.xs,
                contentVisibility: 'auto',
                containIntrinsicSize: '0 240px',
              }}
            >
              <h2
                style={{
                  fontFamily: HF.display,
                  fontWeight: 700,
                  fontSize: 14,
                  color: HF.ink2,
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  margin: 0,
                }}
              >
                {t('floorPlans.title')}
              </h2>
              <ul
                style={{ margin: '12px 0 0', padding: 0, listStyle: 'none', display: 'grid', gap: 8 }}
                data-testid="floor-plan-grid"
              >
                {floorPlans.map(({ key, bucket, sqft, available }) => (
                  <li
                    key={key}
                    data-testid={`floor-plan-${key}`}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 12,
                      background: HF.cream,
                      border: `1px solid ${HF.border}`,
                      borderRadius: HF.r.sm,
                      padding: '12px 14px',
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: 14, color: HF.ink }}>
                        {t(`pricing.label.${key}`)}
                      </div>
                      <div style={{ fontSize: 12, color: HF.ink3, marginTop: 2 }}>
                        {t('floorPlans.approxSqft', { sqft: sqft.toLocaleString('en-US') })}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: 14, color: HF.ink }}>
                        {formatRentBucket(bucket)}
                        <span style={{ fontWeight: 400, fontSize: 12, color: HF.ink3 }}>
                          {t('pricing.suffix')}
                        </span>
                      </div>
                      <div
                        style={{
                          fontSize: 12,
                          marginTop: 2,
                          fontWeight: 700,
                          color: available > 0 ? HF.accentInk : HF.ink3,
                        }}
                      >
                        {available > 0
                          ? t('availability.unit', { count: available })
                          : t('floorPlans.waitlist')}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
              <p style={{ margin: '12px 0 0', fontSize: 12, color: HF.ink3 }}>
                {t('floorPlans.note')}
              </p>
            </section>
          )}

          {/* Neighborhood ("what's around") — representative walkability /
              transit / quiet estimates + nearby places. Neutral framing, not
              the trademarked Walk Score®; labelled representative. */}
          <section
            data-testid="neighborhood"
            style={{
              marginTop: 24,
              background: HF.paper,
              border: `1px solid ${HF.border}`,
              borderRadius: HF.r.md,
              padding: 16,
              boxShadow: HF.shadow.xs,
              contentVisibility: 'auto',
              containIntrinsicSize: '0 240px',
            }}
          >
            <h2
              style={{
                fontFamily: HF.display,
                fontWeight: 700,
                fontSize: 14,
                color: HF.ink2,
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                margin: 0,
              }}
            >
              {t('neighborhood.title')}
            </h2>
            <div
              className="grid grid-cols-3 gap-2"
              style={{ margin: '12px 0 0' }}
              data-testid="neighborhood-scores"
            >
              {([
                { label: t('neighborhood.walk'), score: neighborhood.walk, Icon: Footprints },
                { label: t('neighborhood.transit'), score: neighborhood.transit, Icon: Bus },
                { label: t('neighborhood.quiet'), score: neighborhood.quiet, Icon: Volume1 },
              ] as const).map(({ label, score, Icon }) => (
                <div
                  key={label}
                  style={{
                    background: HF.cream,
                    border: `1px solid ${HF.border}`,
                    borderRadius: HF.r.sm,
                    padding: '12px 8px',
                    textAlign: 'center',
                  }}
                >
                  <Icon className="h-5 w-5" style={{ color: HF.accent, margin: '0 auto' }} aria-hidden="true" />
                  <div style={{ fontFamily: HF.display, fontWeight: 800, fontSize: 22, color: HF.ink, marginTop: 4 }}>
                    {score}
                  </div>
                  <div style={{ fontSize: 11, color: HF.ink3, marginTop: 2 }}>{label}</div>
                </div>
              ))}
            </div>
            <h3
              style={{
                fontFamily: HF.display,
                fontWeight: 700,
                fontSize: 13,
                color: HF.ink2,
                margin: '16px 0 0',
              }}
            >
              {t('neighborhood.nearbyTitle')}
            </h3>
            <ul
              className="grid grid-cols-2 gap-2"
              style={{ margin: '8px 0 0', padding: 0, listStyle: 'none' }}
              data-testid="neighborhood-nearby"
            >
              {neighborhood.nearby.map(({ kind, miles }) => {
                const Icon = NEARBY_ICONS[kind];
                return (
                  <li
                    key={kind}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      fontSize: 13,
                      color: HF.ink2,
                    }}
                  >
                    <Icon className="h-4 w-4" style={{ color: HF.ink3, flexShrink: 0 }} aria-hidden="true" />
                    <span style={{ color: HF.ink }}>{t(`neighborhood.place.${kind}`)}</span>
                    <span style={{ color: HF.ink3, marginLeft: 'auto' }}>
                      {t('neighborhood.miles', { mi: miles.toFixed(1) })}
                    </span>
                  </li>
                );
              })}
            </ul>
            <p style={{ margin: '12px 0 0', fontSize: 12, color: HF.ink3 }}>
              {t('neighborhood.note')}
            </p>
          </section>

          <section
            style={{
              marginTop: 24,
              background: HF.paper,
              border: `1px solid ${HF.border}`,
              borderRadius: HF.r.md,
              padding: 16,
              boxShadow: HF.shadow.xs,
              // Below-fold: skip render/layout work until scrolled near.
              // containIntrinsicSize reserves the box so there's no shift.
              contentVisibility: 'auto',
              containIntrinsicSize: '0 200px',
            }}
          >
            <h2
              style={{
                fontFamily: HF.display,
                fontWeight: 700,
                fontSize: 14,
                color: HF.ink2,
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                margin: 0,
              }}
            >
              Contact
            </h2>
            <dl style={{ margin: '12px 0 0', display: 'grid', gap: 8, fontSize: 14 }}>
              <div className="flex items-center gap-2">
                <dt style={{ color: HF.ink3, minWidth: 60 }}>Phone</dt>
                <dd style={{ margin: 0, color: HF.ink }}>{prop.phone}</dd>
              </div>
              {prop.email && (
                <div className="flex items-center gap-2">
                  <dt style={{ color: HF.ink3, minWidth: 60 }}>Email</dt>
                  <dd style={{ margin: 0, color: HF.ink }}>
                    <a
                      href={`mailto:${prop.email}`}
                      style={{ color: HF.accent, textDecoration: 'none' }}
                    >
                      {prop.email}
                    </a>
                  </dd>
                </div>
              )}
              {prop.units !== null && (
                <div className="flex items-center gap-2">
                  <dt style={{ color: HF.ink3, minWidth: 60 }}>Units</dt>
                  <dd style={{ margin: 0, color: HF.ink }}>{prop.units}</dd>
                </div>
              )}
            </dl>
          </section>

          <section
            style={{
              marginTop: 24,
              // Always below the fold — defer its paint to keep first paint cheap.
              contentVisibility: 'auto',
              containIntrinsicSize: '0 180px',
            }}
          >
            <h2
              style={{
                fontFamily: HF.display,
                fontWeight: 700,
                fontSize: 16,
                color: HF.ink,
                margin: 0,
              }}
            >
              Amenities
            </h2>
            <ul
              className="grid grid-cols-2 gap-2"
              style={{ margin: '12px 0 0', padding: 0, listStyle: 'none' }}
              data-testid="amenities-grid"
            >
              {amenities.map((a) => {
                const Icon = AMENITY_ICONS[a];
                return (
                  <li
                    key={a}
                    data-testid={`amenity-${a}`}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      background: HF.paper,
                      border: `1px solid ${HF.border}`,
                      borderRadius: HF.r.sm,
                      padding: '10px 12px',
                      fontSize: 13,
                      color: HF.ink2,
                    }}
                  >
                    <Icon className="h-4 w-4" style={{ color: HF.accent, flexShrink: 0 }} aria-hidden="true" />
                    {t(`amenities.item.${a}`)}
                  </li>
                );
              })}
            </ul>
            <p style={{ margin: '12px 0 0', fontSize: 12, color: HF.ink3 }}>
              {t('amenities.note')}
            </p>
          </section>
        </div>

        <div
          style={{
            position: 'fixed',
            left: 0,
            right: 0,
            bottom: 0,
            background: HF.paper,
            borderTop: `1px solid ${HF.border}`,
            padding: 16,
            boxShadow: HF.shadow.md,
          }}
        >
          <div className="mx-auto max-w-3xl">
            <CTA tone="primary" block onClick={onApply} data-testid="apply-cta">
              Apply now →
            </CTA>
          </div>
        </div>
      </div>
    </div>
  );
}
