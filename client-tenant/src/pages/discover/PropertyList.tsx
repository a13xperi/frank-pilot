import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
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

type TypeFilter = 'all' | GPMGType;
type CityFilter = 'all' | 'Las Vegas' | 'North Las Vegas' | 'Henderson';

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

function ChipButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-active={active}
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

export function PropertyList() {
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [cityFilter, setCityFilter] = useState<CityFilter>('all');

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
    return GPMG_FIXTURES.filter((p) => {
      if (typeFilter !== 'all' && p.type !== typeFilter) return false;
      if (cityFilter !== 'all' && p.city !== cityFilter) return false;
      return true;
    });
  }, [typeFilter, cityFilter]);

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
                Type
              </span>
              {(Object.keys(TYPE_LABELS) as TypeFilter[]).map((k) => (
                <ChipButton
                  key={k}
                  active={typeFilter === k}
                  onClick={() => setTypeFilter(k)}
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
                City
              </span>
              {(Object.keys(CITY_LABELS) as CityFilter[]).map((k) => (
                <ChipButton
                  key={k}
                  active={cityFilter === k}
                  onClick={() => setCityFilter(k)}
                >
                  {CITY_LABELS[k]}
                </ChipButton>
              ))}
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

function PropertyTile({ prop }: { prop: GPMGProperty }) {
  const slug = slugify(prop.name);
  const est = rentEstimate(prop);
  const unitsLine =
    prop.units !== null ? `${prop.units} units` : 'Contact for availability';

  return (
    <li>
      <Link
        to={`/property/${slug}`}
        aria-label={prop.name}
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
              <span style={{ fontSize: 12, color: HF.ink3 }}>{unitsLine}</span>
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
            <div
              className="flex items-center justify-between"
              style={{
                marginTop: 12,
                paddingTop: 12,
                borderTop: `1px solid ${HF.border}`,
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
        </Card>
      </Link>
    </li>
  );
}
