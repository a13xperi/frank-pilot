import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bed, MapPin } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { fetchUnits, type Unit } from '@/api/units';
import { getToken } from '@/api/client';
import { DL2_FIXTURE } from '@/api/properties';
import { Card, CTA } from '@/components/primitives';
import { getUnitPhoto } from '@/utils/unitPlaceholder';

interface PropertyTile {
  slug: string;
  name: string;
  city: string | null;
  state: string | null;
  photo: string;
  rentMin: number;
  rentMax: number;
  hasAvailable: boolean;
}

function unitsToProperties(units: Unit[]): PropertyTile[] {
  if (units.length === 0) return [];
  // Group by property_id, derive rent range. Slug is hand-mapped for DL2;
  // multi-property registry expansion lives in canonical BP-03.
  const byProp = new Map<string, Unit[]>();
  for (const u of units) {
    const k = u.property_id;
    if (!byProp.has(k)) byProp.set(k, []);
    byProp.get(k)!.push(u);
  }
  const tiles: PropertyTile[] = [];
  for (const [, list] of byProp) {
    const first = list[0];
    const rents = list.map((u) =>
      typeof u.monthly_rent === 'string' ? Number(u.monthly_rent) : u.monthly_rent
    );
    tiles.push({
      slug: 'donna-louise-2', // MVP: only DL2 routes; multi-prop = BP-03 canonical
      name: first.property_name,
      city: first.property_city,
      state: first.property_state,
      photo: getUnitPhoto(first.photo_url),
      rentMin: Math.min(...rents),
      rentMax: Math.max(...rents),
      hasAvailable: list.some((u) => !!u.available_from),
    });
  }
  return tiles;
}

const STATIC_DL2: PropertyTile = {
  slug: DL2_FIXTURE.slug,
  name: DL2_FIXTURE.name,
  city: DL2_FIXTURE.city,
  state: DL2_FIXTURE.state,
  photo: DL2_FIXTURE.photos[0],
  rentMin: DL2_FIXTURE.rentMin,
  rentMax: DL2_FIXTURE.rentMax,
  hasAvailable: DL2_FIXTURE.unitTypes.some((u) => u.available),
};

function formatRent(n: number): string {
  return `$${Math.round(n).toLocaleString()}`;
}

export function PropertyList() {
  const { t } = useTranslation('discover');
  const [tiles, setTiles] = useState<PropertyTile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    const authed = !!getToken();
    const load = async () => {
      if (!authed) {
        // /discover is public — fall back to static fixture instead of forcing login.
        if (alive) {
          setTiles([STATIC_DL2]);
          setLoading(false);
        }
        return;
      }
      try {
        const { units } = await fetchUnits({});
        if (!alive) return;
        const grouped = unitsToProperties(units);
        setTiles(grouped.length > 0 ? grouped : [STATIC_DL2]);
      } catch (e) {
        if (!alive) return;
        // Public route — degrade to fixture rather than blocking.
        setTiles([STATIC_DL2]);
        setError(e instanceof Error ? e.message : 'unknown');
      } finally {
        if (alive) setLoading(false);
      }
    };
    load();
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:py-10">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">
          {t('list.title')}
        </h1>
        <p className="mt-1 text-sm text-gray-600">{t('list.subtitle')}</p>
      </header>

      {loading && (
        <p className="text-sm text-gray-500" role="status">
          {t('list.loading')}
        </p>
      )}

      {error && !loading && (
        <p className="mb-4 text-xs text-gray-400">
          {t('list.error', { message: error })}
        </p>
      )}

      {!loading && tiles.length === 0 && (
        <p className="text-sm text-gray-500">{t('list.empty')}</p>
      )}

      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {tiles.map((p) => {
          const location = [p.city, p.state].filter(Boolean).join(', ');
          return (
            <li key={p.slug}>
              <Card variant="mobile" className="h-full">
                <Link
                  to={`/property/${p.slug}`}
                  className="block focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600"
                >
                  <div className="aspect-[16/9] w-full overflow-hidden bg-gray-100">
                    <img
                      src={p.photo}
                      alt={p.name}
                      loading="lazy"
                      className="h-full w-full object-cover"
                    />
                  </div>
                  <div className="space-y-3 p-4">
                    <div>
                      <h2 className="text-base font-semibold text-gray-900">
                        {p.name}
                      </h2>
                      {location && (
                        <p className="mt-0.5 flex items-center gap-1 text-xs text-gray-500">
                          <MapPin className="h-3 w-3" />
                          {location}
                        </p>
                      )}
                    </div>
                    <div className="text-lg font-bold text-emerald-700">
                      {formatRent(p.rentMin)}–{formatRent(p.rentMax)}/mo
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-1 text-xs text-gray-600">
                        <Bed className="h-3 w-3" /> 1–3 bd
                      </span>
                      <CTA tone="primary">{t('list.viewDetails')}</CTA>
                    </div>
                  </div>
                </Link>
              </Card>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
