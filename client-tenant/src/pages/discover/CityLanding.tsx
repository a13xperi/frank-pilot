/**
 * City-named landing page — `/discover/city/:city`.
 *
 * The discover wedge's SEO play: one crawlable page per Nevada city that has
 * GPMG inventory, keyed off {@link GPMG_CITIES} (derived from the fixtures, so
 * it can never list a city with zero properties). Each page carries a real
 * `<h1>`, an intro copy block, a property card grid linking to the existing
 * `/property/{slug}` detail pages, and city-scoped `ItemList` JSON-LD via
 * {@link CityJsonLd}. Unknown slugs bounce to `/discover`.
 *
 * Cards here are intentionally lighter than `PropertyList`'s `PropertyTile`
 * (no per-card mini-map / live-availability fetch) — this page is a search
 * landing surface, not the interactive browser. The "view on the map" CTA
 * hands off to `/discover?city={canonical}` for the full filtered experience.
 *
 * SPA SEO caveat: there's no SSR/react-helmet on this app, so `document.title`
 * + the meta description are set via `useEffect`. Google's JS renderer + the
 * sitemap + JSON-LD carry crawl coverage (see the wedge plan); a prerender
 * step is deferred until coverage proves insufficient.
 */

import { useEffect, useMemo } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft } from 'lucide-react';
import {
  findCityBySlug,
  propertiesInCity,
  slugify,
  rentEstimate,
  type GPMGProperty,
} from '@/api/gpmg-fixtures';
import { CityJsonLd } from '@/components/CityJsonLd';
import { Card } from '@/components/primitives';
import { SaveButton } from '@/components/SaveButton';
import { placeholderFor } from '@/utils/unitPlaceholder';
import { HF } from '@/styles/tokens';

/** Canonical origin for JSON-LD item URLs — prefer the live origin in-browser. */
function canonicalOrigin(): string {
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin;
  }
  return (
    (import.meta.env.VITE_PUBLIC_SITE_URL as string | undefined) ??
    'https://frank-pilot-tenant.vercel.app'
  );
}

export function CityLanding() {
  const { city: citySlugParam = '' } = useParams<{ city: string }>();
  const { t } = useTranslation('discover');

  // Resolve once per slug — fixture scans shouldn't re-run on i18n suspense.
  const cityEntry = useMemo(() => findCityBySlug(citySlugParam), [citySlugParam]);
  const properties = useMemo<GPMGProperty[]>(
    () => (cityEntry ? propertiesInCity(cityEntry.name) : []),
    [cityEntry],
  );

  // Per-page <title> + meta description (no SSR — see file header). Restore the
  // previous title on unmount so SPA navigation away doesn't leak the city name.
  useEffect(() => {
    if (!cityEntry || typeof document === 'undefined') return;
    const prevTitle = document.title;
    document.title = t('city.metaTitle', {
      city: cityEntry.name,
      count: cityEntry.count,
    });

    const meta = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    const prevDesc = meta?.getAttribute('content') ?? null;
    const created = !meta;
    const el = meta ?? document.createElement('meta');
    if (created) {
      el.setAttribute('name', 'description');
      document.head.appendChild(el);
    }
    el.setAttribute(
      'content',
      t('city.metaDescription', { city: cityEntry.name, count: cityEntry.count }),
    );

    return () => {
      document.title = prevTitle;
      if (created) {
        el.remove();
      } else if (prevDesc !== null) {
        el.setAttribute('content', prevDesc);
      }
    };
  }, [cityEntry, t]);

  // Unknown city slug → the main discover page (no dead-end 404 for crawlers).
  if (!cityEntry) {
    return <Navigate to="/discover" replace />;
  }

  return (
    <div
      style={{ background: HF.cream, minHeight: '100vh', fontFamily: HF.body, color: HF.ink }}
    >
      <CityJsonLd
        city={cityEntry.name}
        properties={properties}
        origin={canonicalOrigin()}
      />
      <div className="mx-auto max-w-5xl p-4 sm:p-6">
        <Link
          to="/discover"
          data-testid="city-back-to-all"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 13,
            fontWeight: 600,
            color: HF.ink3,
            textDecoration: 'none',
            marginBottom: 12,
          }}
        >
          <ArrowLeft width={16} height={16} aria-hidden="true" />
          {t('city.backToAll')}
        </Link>

        <header className="mb-4">
          <h1
            data-testid="city-heading"
            style={{
              fontFamily: HF.display,
              fontWeight: 800,
              fontSize: 26,
              color: HF.ink,
              letterSpacing: '-0.01em',
              margin: 0,
            }}
          >
            {t('city.heading', { city: cityEntry.name })}
          </h1>
          <p style={{ marginTop: 6, fontSize: 14, color: HF.ink3, maxWidth: 560 }}>
            {t('city.intro', { city: cityEntry.name, count: cityEntry.count })}
          </p>
          <Link
            to={`/discover?city=${encodeURIComponent(cityEntry.name)}`}
            data-testid="city-view-on-map"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              marginTop: 12,
              padding: '8px 16px',
              borderRadius: HF.r.pill,
              background: HF.accent,
              color: HF.paper,
              fontSize: 13,
              fontWeight: 700,
              textDecoration: 'none',
            }}
          >
            {t('city.viewOnMap', { city: cityEntry.name })}
          </Link>
        </header>

        <ul
          className="grid grid-cols-1 gap-4 sm:grid-cols-2"
          data-testid="city-property-grid"
        >
          {properties.map((p) => (
            <CityPropertyCard key={p.name} prop={p} />
          ))}
        </ul>
      </div>
    </div>
  );
}

/**
 * Lean property card for the city grid — name, address, type, from-$ estimate,
 * ♥ save, and a tap-through to the detail page. No mini-map / availability
 * fetch (that's `PropertyList`'s job); this surface optimises for fast paint.
 */
function CityPropertyCard({ prop }: { prop: GPMGProperty }) {
  const slug = slugify(prop.name);
  return (
    <li>
      <Link
        to={`/property/${slug}`}
        aria-label={prop.name}
        data-testid={`city-tile-${slug}`}
        style={{ display: 'block', textDecoration: 'none', color: 'inherit', borderRadius: HF.r.md }}
      >
        <Card variant="mobile" padding={0} elevation="sm" style={{ overflow: 'hidden' }}>
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
            <div style={{ position: 'absolute', top: 8, right: 8 }}>
              <SaveButton slug={slug} size={36} />
            </div>
          </div>
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
                From ${rentEstimate(prop)}/mo
              </span>
              <div className="flex items-center" style={{ gap: 8 }}>
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
                <span style={{ fontSize: 13, color: HF.accent, fontWeight: 600 }}>
                  View →
                </span>
              </div>
            </div>
          </div>
        </Card>
      </Link>
    </li>
  );
}
