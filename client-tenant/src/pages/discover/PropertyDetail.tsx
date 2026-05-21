import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Bed, Bath, Square } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  fetchProperty,
  DL2_FIXTURE,
  type PropertyDetail as PropertyDetailT,
} from '@/api/properties';
import { Pill, CTA, BottomBar } from '@/components/primitives';
import { PhotoCarousel } from './PhotoCarousel';
import { WaitlistBanner } from './WaitlistBanner';
import { getToken } from '@/api/client';

function formatRent(n: number): string {
  return `$${Math.round(n).toLocaleString()}`;
}

export function PropertyDetail() {
  const { slug = '' } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation('discover');
  const [prop, setProp] = useState<PropertyDetailT | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setNotFound(false);
    fetchProperty(slug)
      .then((p) => {
        if (alive) setProp(p);
      })
      .catch(() => {
        if (alive) {
          // Last-resort fallback: only DL2 has a fixture; other slugs => 404.
          if (slug === 'donna-louise-2') setProp(DL2_FIXTURE);
          else setNotFound(true);
        }
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [slug]);

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl p-6 text-sm text-gray-500" role="status">
        {t('detail.loading')}
      </div>
    );
  }

  if (notFound || !prop) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <Link
          to="/discover"
          className="inline-flex items-center gap-1 text-sm text-emerald-700"
        >
          <ArrowLeft className="h-4 w-4" /> {t('detail.back')}
        </Link>
        <p className="mt-4 text-sm text-gray-600">{t('detail.notFound')}</p>
      </div>
    );
  }

  const location = [prop.city, prop.state].filter(Boolean).join(', ');
  const onApply = () => {
    // /apply is auth-gated for the canonical flow; /welcome is the public landing
    // that funnels in. Route based on auth state so unauthed users don't bounce.
    navigate(
      getToken()
        ? `/apply?step=intent&unitType=2BR&propertyId=${prop.slug}`
        : `/login?return=${encodeURIComponent(`/apply?step=intent&unitType=2BR&propertyId=${prop.slug}`)}`
    );
  };

  return (
    <div className="mx-auto flex max-w-3xl flex-col">
      {/* Hero gallery */}
      <div className="relative">
        <PhotoCarousel photos={prop.photos} alt={prop.name} />
        <Link
          to="/discover"
          aria-label={t('detail.back')}
          className="absolute left-3 top-3 inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/95 text-gray-900 shadow ring-1 ring-gray-200"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
      </div>

      <div className="space-y-6 px-4 pb-32 pt-5 sm:px-6">
        {/* Headline + rent + waitlist banner */}
        <div>
          <div className="flex items-baseline justify-between gap-3">
            <div>
              <span className="text-2xl font-extrabold tracking-tight text-gray-900">
                {formatRent(prop.rentMin)}
              </span>
              <span className="text-sm text-gray-500">
                –{formatRent(prop.rentMax)}/mo
              </span>
            </div>
            {prop.community && <Pill tone="neutral">{prop.community}</Pill>}
          </div>
          <h1 className="mt-2 text-xl font-bold text-gray-900 sm:text-2xl">
            {prop.name}
          </h1>
          {(prop.address || location || prop.neighborhood) && (
            <p className="mt-1 text-sm text-gray-500">
              {[prop.address, location, prop.neighborhood]
                .filter(Boolean)
                .join(' · ')}
            </p>
          )}
        </div>

        <WaitlistBanner slug={prop.slug} />

        {/* Key facts band */}
        <div className="grid grid-cols-3 divide-x divide-gray-200 rounded-xl border border-gray-200 bg-white py-3 text-center">
          <div>
            <div className="flex items-center justify-center gap-1 text-base font-bold text-gray-900">
              <Bed className="h-4 w-4 text-gray-500" /> 1–3
            </div>
            <div className="mt-0.5 text-xs text-gray-500">{t('detail.beds')}</div>
          </div>
          <div>
            <div className="flex items-center justify-center gap-1 text-base font-bold text-gray-900">
              <Bath className="h-4 w-4 text-gray-500" /> 1–2
            </div>
            <div className="mt-0.5 text-xs text-gray-500">{t('detail.baths')}</div>
          </div>
          <div>
            <div className="flex items-center justify-center gap-1 text-base font-bold text-gray-900">
              <Square className="h-4 w-4 text-gray-500" /> 680–1,150
            </div>
            <div className="mt-0.5 text-xs text-gray-500">{t('detail.sqft')}</div>
          </div>
        </div>

        {/* About */}
        {prop.description && (
          <section>
            <h2 className="text-base font-semibold text-gray-900">
              {t('detail.aboutTitle')}
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-gray-700">
              {prop.description}
            </p>
          </section>
        )}

        {/* Unit types */}
        {prop.unitTypes.length > 0 && (
          <section>
            <h2 className="text-base font-semibold text-gray-900">
              {t('detail.unitTypes')}
            </h2>
            <ul className="mt-3 space-y-2">
              {prop.unitTypes.map((u) => (
                <li
                  key={u.bed}
                  className="flex items-center justify-between rounded-lg border border-gray-200 bg-white p-3"
                >
                  <div>
                    <div className="text-sm font-semibold text-gray-900">
                      {u.bed}
                    </div>
                    <div className="text-xs text-gray-500">
                      {u.sqftRange} sq ft
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {u.available ? (
                      <Pill tone="ok">Available</Pill>
                    ) : (
                      <Pill tone="warn">~{u.waitMonths}mo wait</Pill>
                    )}
                    <span className="text-sm font-bold text-emerald-700">
                      {formatRent(u.rent)}/mo
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Eligibility */}
        {prop.eligibility && prop.eligibility.length > 0 && (
          <section>
            <h2 className="text-base font-semibold text-gray-900">
              {t('detail.whoCanApplyTitle')}
            </h2>
            <ul className="mt-2 space-y-1.5">
              {prop.eligibility.map((line, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                  <span className="mt-1 text-emerald-600">✓</span>
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Amenities */}
        {prop.amenities.length > 0 && (
          <section>
            <h2 className="text-base font-semibold text-gray-900">
              {t('detail.amenitiesTitle')}
            </h2>
            <ul className="mt-3 flex flex-wrap gap-2">
              {prop.amenities.map((a) => (
                <li
                  key={a}
                  className="rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs text-gray-700"
                >
                  {a}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      {/* Sticky CTA */}
      <BottomBar variant="mobile">
        <CTA intent="primary" full onClick={onApply} data-testid="apply-cta">
          {t('detail.apply')} →
        </CTA>
      </BottomBar>
    </div>
  );
}
