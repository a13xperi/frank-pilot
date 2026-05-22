import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { findGPMGBySlug, rentEstimate } from '@/api/gpmg-fixtures';
import { CTA } from '@/components/primitives';
import { getToken } from '@/api/client';
import { UNIT_PLACEHOLDER } from '@/utils/unitPlaceholder';
import { HF } from '@/styles/tokens';

const AMENITIES = [
  'Affordable rents',
  'On-site laundry',
  'Manager on-site',
  'Senior-friendly',
  'Near transit',
  'Smoke-free',
];

export function PropertyDetail() {
  const { slug = '' } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const prop = findGPMGBySlug(slug);

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
  const onApply = () => {
    // Apply requires auth; bounce unauthed users through /login with a return.
    const target = `/apply?step=intent&unitType=2BR&propertyId=${encodeURIComponent(slug)}`;
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
