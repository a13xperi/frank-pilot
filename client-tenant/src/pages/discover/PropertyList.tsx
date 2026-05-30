import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Heart } from 'lucide-react';
import { fetchUnits } from '@/api/units';
import { getToken } from '@/api/client';
import {
  fetchPropertiesList,
  type ApiPropertyListing,
  type ApiAmiTier,
  type ApiBedroomFilter,
  type ApiAvailabilityFilter,
} from '@/api/properties';
import {
  GPMG_FIXTURES,
  slugify,
  rentEstimate,
  type GPMGProperty,
  type GPMGType,
} from '@/api/gpmg-fixtures';
import { Card } from '@/components/primitives';
import { SaveButton } from '@/components/SaveButton';
import { useShortlist } from '@/state/shortlist';
import { useFlag } from '@/lib/flags';
import { placeholderFor } from '@/utils/unitPlaceholder';
import { HF } from '@/styles/tokens';
import {
  getPropertyAvailability,
  propertyMatchesAmiTier,
  type BedroomBucket,
  type PropertyAvailability,
} from '@/utils/availability';
import {
  propertyRentRange,
  propertyAmiTier,
  formatRentBucket,
  populatedBuckets,
  type PropertyRentRange,
} from '@/utils/pricing';

type TypeFilter = 'all' | GPMGType;
type CityFilter =
  | 'all'
  | 'Las Vegas'
  | 'North Las Vegas'
  | 'Henderson'
  | 'Reno'
  | 'Sparks'
  | 'Carson City'
  | 'Elko';
type BedroomFilter = 'all' | 'studio' | '1' | '2' | '3';
type ViewMode = 'list' | 'map';

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
  Reno: 'Reno',
  Sparks: 'Sparks',
  'Carson City': 'Carson City',
  Elko: 'Elko',
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

/** Uppercase eyebrow label shared by every filter row (list + map views). */
function FilterRowLabel({ children }: { children: React.ReactNode }) {
  return (
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
      {children}
    </span>
  );
}

/**
 * Type / City / Availability chip rows. Map view reuses this (Phase 2-A
 * collapse) so the map's own filter rail can be deleted — React is now the
 * single source of filter truth for both views. Bedroom is intentionally NOT
 * here: the map has no bedroom dimension, and list view renders Bedroom
 * separately (it sits between City and Availability there).
 */
function TypeCityAvailabilityFilters({
  t,
  typeFilter,
  cityFilter,
  availableNow,
  updateParam,
}: {
  t: (key: string) => string;
  typeFilter: TypeFilter;
  cityFilter: CityFilter;
  availableNow: boolean;
  updateParam: (key: string, value: string | null) => void;
}) {
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <FilterRowLabel>{t('filter.type')}</FilterRowLabel>
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
      <div className="flex flex-wrap items-center gap-2">
        <FilterRowLabel>{t('filter.city')}</FilterRowLabel>
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
      <div className="flex flex-wrap items-center gap-2">
        <FilterRowLabel>{t('filter.availability')}</FilterRowLabel>
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
    </>
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

/**
 * Server uses the same kebab/lowercase chip values as the URL chips, so
 * `BedroomFilter` maps 1:1 onto `ApiBedroomFilter` except for the synthetic
 * 'all' slot which means "omit the param entirely".
 */
function apiBedroomFromFilter(filter: BedroomFilter): ApiBedroomFilter | undefined {
  return filter === 'all' ? undefined : filter;
}

/**
 * Normalized tile shape — the rendering layer reads from this regardless of
 * data source. When the live `/api/properties` call succeeds, we hydrate from
 * the API response (using its `availability` rollup + `rentRange`). When the
 * call errors (e.g. unauthed public visitor, network outage, server 500), we
 * fall back to the GPMG_FIXTURES + `getPropertyAvailability` deterministic
 * render — the gpmglv-demo offline guarantee.
 *
 * Why a normalized shape instead of branching at the JSX level? Because the
 * filter-chip semantics need to operate on whichever source is live without
 * the UI knowing or caring, AND because the existing PropertyTile reads from
 * `GPMGProperty` today; introducing branches all the way down would multiply
 * the diff. One adapter at the top, one shape downstream.
 */
interface TileSource {
  name: string;
  slug: string;
  addr: string;
  city: string;
  zip: string;
  type: GPMGType;
  /** Display unit count for the "N units" subhead. */
  unitsLabel: string;
  /** From-$X estimate for the "From $X/mo" line. */
  rentEstimateDollars: number;
  /** Per-property availability rollup — same shape as `getPropertyAvailability`. */
  availability: PropertyAvailability;
  /** Per-bedroom rent range — same shape `populatedBuckets()` consumes. */
  rentRange: PropertyRentRange;
  /** Normalized AMI tier label, e.g. "60". null for market-rate. */
  amiTier: string | null;
}

/**
 * Hydrate a TileSource from the live API response. The server's `propertyType`
 * narrows down to senior/family/mixed_use; we surface 'mixed_use' as 'family'
 * for the chip + tile labels (the chip set is just senior|family today).
 */
function tileFromApi(p: ApiPropertyListing): TileSource {
  const slug = slugify(p.name);
  const type: GPMGType = p.propertyType === 'senior' ? 'senior' : 'family';
  // Server returns the canonical label verbatim (e.g. "60% AMI" — see
  // `normalizeAmiTier()` in src/modules/properties/service.ts). The chip i18n
  // template ({{tier}}) renders this as-is, matching how the fixture path
  // hydrates via `propertyAmiTier()`.
  const amiTier = p.amiTier;
  return {
    name: p.name,
    slug,
    addr: p.addressLine1,
    city: p.city,
    zip: p.zip,
    type,
    unitsLabel:
      p.availability.totalUnits > 0 ? `${p.availability.totalUnits} units` : '',
    rentEstimateDollars: type === 'senior' ? 747 : 920,
    availability: {
      availableCount: p.availability.availableCount,
      leasedCount: p.availability.leasedCount,
      heldCount: 0,
      totalUnits: p.availability.totalUnits,
      bedroomBreakdown: { ...p.availability.bedroomBreakdown },
    },
    rentRange: {
      studio: p.rentRange.studio,
      br1: p.rentRange.br1,
      br2: p.rentRange.br2,
      br3: p.rentRange.br3,
    },
    amiTier,
  };
}

/**
 * Hydrate a TileSource from the deterministic GPMG fixture. Mirrors the
 * pre-wedge-8 render path so the gpmglv demo keeps working when the API is
 * unreachable.
 */
function tileFromFixture(p: GPMGProperty): TileSource {
  const slug = slugify(p.name);
  const availability = getPropertyAvailability(p.name);
  const rentRange = propertyRentRange(p.name);
  const amiTierLabel = propertyAmiTier(p.name); // e.g. "60% AMI"
  const showCount = availability.totalUnits > 0;
  return {
    name: p.name,
    slug,
    addr: p.addr,
    city: p.city,
    zip: p.zip,
    type: p.type,
    unitsLabel: showCount
      ? `${availability.totalUnits} units`
      : p.units !== null
      ? `${p.units} units`
      : '',
    rentEstimateDollars: rentEstimate(p),
    availability,
    rentRange,
    amiTier: amiTierLabel,
  };
}

export function PropertyList() {
  const { t } = useTranslation('discover');
  const { count: savedCount } = useShortlist();
  const [params, setParams] = useSearchParams();
  // Frank-only mode (demo deployment): scope the embedded map to Frank's
  // managed portfolio and suppress the statewide "universal" directory.
  const frankOnly = useFlag('FRANK_ONLY_ENABLED');

  // Single source of truth for filters: URL params. This is what lets the
  // chips deep-link cleanly and what the AMI-banner X-button needs to
  // dismiss (just drop the param). It also means a reload preserves filter
  // state, which matches the rest of the wizard.
  const typeFilter = (params.get('type') as TypeFilter | null) ?? 'all';
  const cityFilter = (params.get('city') as CityFilter | null) ?? 'all';
  const bedroomFilter = (params.get('bedroom') as BedroomFilter | null) ?? 'all';
  const availableNow = params.get('availability') === 'available_now';
  const viewMode: ViewMode = params.get('view') === 'map' ? 'map' : 'list';

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

  // ── Map view: React is the single source of filter truth ────────────────
  //
  // Phase 2-A collapses the duplicated filter rail. In map view the React
  // chips above drive the map; the map itself is a near-pure render surface.
  // We push filter changes into the iframe via postMessage (NOT by changing
  // src — that would reload the whole Leaflet map). The iframe still boots
  // from its src querystring (initFiltersFromURL) so deep-links + hard reloads
  // paint the right slice on first render; postMessage only handles
  // subsequent in-session changes.
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  // The iframe `src` is computed once at mount and never changed thereafter
  // (changing it remounts the iframe). We capture the filters present at first
  // entry into map view; later changes flow over postMessage. Recomputing this
  // on every render is fine because React diffs the string — it only differs
  // from the live DOM attribute if the component fully remounts.
  const initialMapSrc = useMemo(() => {
    const mapParams = new URLSearchParams(params);
    mapParams.delete('view');
    // Frank-only: the map reads `frankOnly` and skips the statewide directory
    // fetch, rendering only Frank's availability layer (~17 properties). Strip
    // any inbound `frankOnly` from the page URL first so the build-time flag is
    // the single source of truth — a hand-typed `?frankOnly=1` must NOT scope
    // the statewide deploy down.
    mapParams.delete('frankOnly');
    if (frankOnly) mapParams.set('frankOnly', '1');
    const qs = mapParams.toString();
    return qs ? `/nv-housing-map.html?${qs}` : '/nv-housing-map.html';
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally mount-only — see comment above

  // Post the current filters down to the iframe. Same-origin only — we always
  // pass an explicit targetOrigin (never '*').
  const postFiltersToMap = () => {
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    win.postMessage(
      {
        type: 'frank:filters',
        filters: {
          type: typeFilter,
          city: cityFilter,
          availability: availableNow ? 'available_now' : null,
        },
      },
      window.location.origin,
    );
  };

  // Handshake + change propagation. The iframe posts 'frank:ready' once its
  // script is listening; we (re)send the current filters then, which closes
  // the race where React posts before the iframe wired its listener. We also
  // resend whenever the filter dimensions change while in map view.
  useEffect(() => {
    if (viewMode !== 'map') return;
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      const d = event.data;
      if (!d || typeof d !== 'object' || d.type !== 'frank:ready') return;
      postFiltersToMap();
    };
    window.addEventListener('message', onMessage);
    // Also push immediately in case the iframe was already ready (e.g. a
    // re-render after the handshake already fired).
    postFiltersToMap();
    return () => window.removeEventListener('message', onMessage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode, typeFilter, cityFilter, availableNow]);

  // Card mini-maps: a single fetch of the committed coords snapshot (the same
  // /nv-gpmg-map-props.json the map iframe reads), keyed by slug, so each list
  // card can render a small non-interactive locator without a per-card request.
  // Cards whose slug has no coords simply omit the map.
  const [coordsBySlug, setCoordsBySlug] = useState<
    Record<string, { lat: number; lng: number }>
  >({});
  useEffect(() => {
    let alive = true;
    fetch('/nv-gpmg-map-props.json')
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then(
        (rows: Array<{ slug?: string; name?: string; lat?: number; lng?: number }>) => {
          if (!alive) return;
          const m: Record<string, { lat: number; lng: number }> = {};
          for (const row of rows) {
            if (typeof row.lat !== 'number' || typeof row.lng !== 'number') continue;
            const coords = { lat: row.lat, lng: row.lng };
            if (row.slug) m[row.slug] = coords;
            if (row.name) m[slugify(row.name)] = coords;
          }
          setCoordsBySlug(m);
        },
      )
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

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

  // ── Wedge #8 — live `/api/properties` data layer ────────────────────────
  //
  // Two-source rendering: when the live call succeeds, tiles render from the
  // API response (so availability counts + rent ranges reflect what the DB
  // actually has, not the seed mirror). When the call errors (401 for an
  // unauthed visitor, network outage, server 500), we silently fall back to
  // the GPMG_FIXTURES + `getPropertyAvailability` deterministic render —
  // identical to the pre-wedge-8 behaviour. The gpmglv-demo offline
  // guarantee is load-bearing for the runbook walkthrough.
  //
  // The chip values map 1:1 onto the server's zod-validated param names
  // (`amiTier`, `bedroom`, `availability`) so a typo would fail loudly with a
  // 400 — no silent "unfiltered list" surprise.
  const [apiProperties, setApiProperties] = useState<ApiPropertyListing[] | null>(
    null,
  );

  useEffect(() => {
    let alive = true;
    const filters: {
      amiTier?: ApiAmiTier;
      bedroom?: ApiBedroomFilter;
      availability?: ApiAvailabilityFilter;
    } = {};
    if (amiTier) filters.amiTier = amiTier;
    const apiBedroom = apiBedroomFromFilter(bedroomFilter);
    if (apiBedroom) filters.bedroom = apiBedroom;
    if (availableNow) filters.availability = 'available_now';

    fetchPropertiesList(filters)
      .then((res) => {
        if (alive) setApiProperties(res.properties);
      })
      .catch(() => {
        // Tolerate — fall back to the deterministic fixture render below.
        // The catch path is the unauthed-public default today since
        // `property:view` is admin-gated; the offline render carries the
        // demo regardless.
        if (alive) setApiProperties(null);
      });
    return () => {
      alive = false;
    };
  }, [amiTier, bedroomFilter, availableNow]);

  // Server doesn't have `?type` or `?city` params today (those are not part
  // of the public discover contract; see the deferred wedges in
  // `make-a-plan-of-zany-book.md`). When the API succeeds we still apply the
  // Type + City chips client-side over the API response — that keeps the
  // visible behaviour identical regardless of source. When the API fails we
  // run the full filter set over GPMG_FIXTURES as before.
  const tiles = useMemo<TileSource[]>(() => {
    const bucket = bedroomBucketFromFilter(bedroomFilter);
    // Suppress internal smoke-test artifacts (e.g. the "NAU-SMOKE Test
    // Property" seeded into prod for the NAU lifecycle smoke) from the
    // public browse surface. Match on the unique `nau-smoke` token only —
    // a bare "test property" substring could swallow a real listing.
    const isTestProperty = (name: string) => /nau-smoke/i.test(name);
    if (apiProperties !== null) {
      return apiProperties
        .filter((p) => !isTestProperty(p.name))
        .map(tileFromApi)
        .filter((t) => {
          if (typeFilter !== 'all' && t.type !== typeFilter) return false;
          if (cityFilter !== 'all' && t.city !== cityFilter) return false;
          // Bedroom / availability already filtered server-side; type/city
          // narrowing happens here. The server's amiTier filter narrowed
          // there too, so we don't double-apply it.
          return true;
        });
    }
    // Fallback: deterministic fixture render. Identical to pre-wedge-8 logic.
    return GPMG_FIXTURES.filter((p) => {
      if (typeFilter !== 'all' && p.type !== typeFilter) return false;
      if (cityFilter !== 'all' && p.city !== cityFilter) return false;
      if (amiTier && !propertyMatchesAmiTier(p, amiTier)) return false;
      if (bucket || availableNow) {
        const avail = getPropertyAvailability(p.name);
        if (availableNow && avail.availableCount === 0) return false;
        if (bucket && avail.bedroomBreakdown[bucket] === 0) return false;
      }
      return true;
    }).map(tileFromFixture);
  }, [apiProperties, typeFilter, cityFilter, bedroomFilter, availableNow, amiTier]);

  const filtered = tiles;

  return (
    <div
      style={{ background: HF.cream, minHeight: '100vh', fontFamily: HF.body, color: HF.ink }}
    >
      <div className="mx-auto max-w-5xl p-4 sm:p-6">
        <header className="mb-4 flex items-start justify-between" style={{ gap: 12 }}>
          <div>
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
              Affordable communities across Nevada
            </p>
          </div>
          {/* Saved-shortlist entry point — heart + live count badge. */}
          <Link
            to="/saved"
            aria-label={t('saved.viewShortlist', { count: savedCount })}
            data-testid="saved-shortlist-link"
            style={{
              position: 'relative',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              height: 40,
              width: 40,
              flexShrink: 0,
              borderRadius: HF.r.pill,
              border: `1px solid ${HF.border}`,
              background: HF.paper,
              boxShadow: HF.shadow.xs,
              color: savedCount > 0 ? HF.accent : HF.ink3,
              textDecoration: 'none',
            }}
          >
            <Heart
              width={20}
              height={20}
              style={{
                color: savedCount > 0 ? HF.accent : HF.ink3,
                fill: savedCount > 0 ? HF.accent : 'none',
              }}
              aria-hidden="true"
            />
            {savedCount > 0 && (
              <span
                data-testid="saved-count-badge"
                style={{
                  position: 'absolute',
                  top: -6,
                  right: -6,
                  minWidth: 18,
                  height: 18,
                  padding: '0 5px',
                  borderRadius: HF.r.pill,
                  background: HF.accent,
                  color: HF.paper,
                  fontSize: 11,
                  fontWeight: 700,
                  fontFamily: HF.body,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  lineHeight: 1,
                }}
              >
                {savedCount}
              </span>
            )}
          </Link>
        </header>

        <div
          role="tablist"
          aria-label="View mode"
          data-testid="view-toggle"
          style={{
            display: 'inline-flex',
            gap: 0,
            marginBottom: 14,
            background: HF.paper,
            border: `1px solid ${HF.border}`,
            borderRadius: HF.r.pill,
            padding: 3,
          }}
        >
          {(['list', 'map'] as ViewMode[]).map((mode) => {
            const active = viewMode === mode;
            return (
              <button
                key={mode}
                type="button"
                role="tab"
                aria-selected={active}
                data-active={active}
                data-testid={`view-toggle-${mode}`}
                onClick={() => updateParam('view', mode === 'list' ? null : mode)}
                style={{
                  background: active ? HF.accent : 'transparent',
                  color: active ? HF.paper : HF.ink2,
                  border: 'none',
                  borderRadius: HF.r.pill,
                  padding: '6px 18px',
                  fontSize: 13,
                  fontWeight: 700,
                  fontFamily: HF.body,
                  cursor: 'pointer',
                }}
              >
                {mode === 'list' ? 'List' : 'Map'}
              </button>
            );
          })}
        </div>

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

        {viewMode === 'map' ? (
          <>
            {/* React owns the filter rail (Phase 2-A). These chips drive the
                map below via postMessage — the map no longer has its own
                interactive rail. Type / City / Availability only: the map has
                no Bedroom dimension, and Funding was dropped from the UI. */}
            <div
              className="-mx-4 px-4 py-3 sm:-mx-6 sm:px-6 mb-3"
              style={{ background: HF.cream, borderBottom: `1px solid ${HF.border}` }}
            >
              <div className="flex flex-col gap-2">
                <TypeCityAvailabilityFilters
                  t={t}
                  typeFilter={typeFilter}
                  cityFilter={cityFilter}
                  availableNow={availableNow}
                  updateParam={updateParam}
                />
              </div>
            </div>
            <iframe
              ref={iframeRef}
              // Initial src carries the current filters so a deep-link / hard
              // reload paints the right slice via the map's initFiltersFromURL.
              // We never mutate src on filter change — that reloads the iframe.
              // Subsequent changes ride the 'frank:filters' postMessage.
              // `view` is stripped — it's the parent's tab state.
              src={initialMapSrc}
              title="Nevada affordable housing map"
              data-testid="discover-map-iframe"
              className="w-full h-[86vh] md:h-[72vh]"
              style={{
                border: 'none',
                borderRadius: HF.r.md,
                boxShadow: '0 1px 3px rgba(31,26,18,.10)',
                background: HF.paper,
              }}
            />
          </>
        ) : (
          <>
        <div
          className="sticky top-12 z-10 -mx-4 px-4 py-3 sm:-mx-6 sm:px-6"
          style={{ background: HF.cream, borderBottom: `1px solid ${HF.border}` }}
        >
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
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
            <div className="flex flex-wrap items-center gap-2">
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
              className="flex flex-wrap items-center gap-2"
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
            <div className="flex flex-wrap items-center gap-2">
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
            <PropertyTile key={p.name} prop={p} coords={coordsBySlug[p.slug]} />
          ))}
        </ul>
          </>
        )}
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

function PropertyTile({
  prop,
  coords,
}: {
  prop: TileSource;
  coords?: { lat: number; lng: number };
}) {
  const { t } = useTranslation('discover');
  const { slug, availability, rentRange, amiTier } = prop;

  // Wedge #9 — per-bedroom rent ranges + AMI tier. Only populated buckets
  // render (no "Studio $0" placeholders) and the chip only appears for
  // properties with a real set-aside (all 17 GPMG fixtures qualify today).
  const buckets = populatedBuckets(rentRange);

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
          <div className="relative">
            <div
              className="aspect-[16/9] w-full"
              style={{
                background: `${HF.sageLo}`,
                backgroundImage: `url(${placeholderFor(slug, prop.name)})`,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
              }}
              aria-hidden="true"
            />
            {/* ♥ shortlist toggle — corner of the card photo. Stops propagation
                so tapping the heart never follows the card's <Link>. */}
            <div style={{ position: 'absolute', top: 8, right: 8 }}>
              {/* No propertyName here on purpose: a name-bearing aria-label
                  would collide with the card link in name-based queries
                  (the card context already associates the heart). */}
              <SaveButton slug={slug} size={36} />
            </div>
          </div>
          {coords && (
            <iframe
              title={`Map — ${prop.name}`}
              loading="lazy"
              src={`/property-minimap.html?lat=${coords.lat}&lng=${coords.lng}&type=${prop.type}&label=${encodeURIComponent(
                prop.name,
              )}&ui=min`}
              data-testid={`minimap-${slug}`}
              style={{
                display: 'block',
                width: '100%',
                height: 116,
                border: 'none',
                borderTop: `1px solid ${HF.border}`,
                // Non-interactive: clicks/drags fall through to the card Link so
                // the whole tile stays one tap-target (map is a locator only).
                pointerEvents: 'none',
              }}
              aria-hidden="true"
            />
          )}
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
              <span style={{ fontSize: 12, color: HF.ink3 }}>{prop.unitsLabel}</span>
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
                From ${prop.rentEstimateDollars}/mo
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
