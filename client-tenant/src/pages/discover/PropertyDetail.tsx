import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { findGPMGBySlug, rentEstimate } from '@/api/gpmg-fixtures';
import { CTA } from '@/components/primitives';
import { getToken } from '@/api/client';
import { UNIT_PLACEHOLDER } from '@/utils/unitPlaceholder';
import { HF } from '@/styles/tokens';
import {
  getPropertyAvailability,
  type BedroomBucket,
} from '@/utils/availability';

const AMENITIES = [
  'Affordable rents',
  'On-site laundry',
  'Manager on-site',
  'Senior-friendly',
  'Near transit',
  'Smoke-free',
];

const VALID_AMI_TIERS = new Set(['30', '50', '60', '80'] as const);
type AmiTier = '30' | '50' | '60' | '80';

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
  const prop = findGPMGBySlug(slug);

  // Preserve a deep-linked amiTier when bouncing to /apply so the W0 funnel
  // continues to know the applicant's tier. Validated against the same set
  // as the AMI calculator emits.
  const amiTierRaw = params.get('amiTier');
  const amiTier: AmiTier | null =
    amiTierRaw && VALID_AMI_TIERS.has(amiTierRaw as AmiTier)
      ? (amiTierRaw as AmiTier)
      : null;

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

  const est = rentEstimate(prop);
  const availability = getPropertyAvailability(prop.name);
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
      <div className="mx-auto max-w-3xl">
        <div className="relative">
          <div
            className="aspect-[16/9] w-full"
            style={{
              background: HF.sageLo,
              backgroundImage: `url(${UNIT_PLACEHOLDER})`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
            }}
            aria-hidden="true"
          />
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

          <section
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

          <section style={{ marginTop: 24 }}>
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
            >
              {AMENITIES.map((a) => (
                <li
                  key={a}
                  style={{
                    background: HF.paper,
                    border: `1px solid ${HF.border}`,
                    borderRadius: HF.r.sm,
                    padding: '10px 12px',
                    fontSize: 13,
                    color: HF.ink2,
                  }}
                >
                  {a}
                </li>
              ))}
            </ul>
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
