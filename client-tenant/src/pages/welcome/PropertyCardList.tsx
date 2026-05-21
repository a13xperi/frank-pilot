import { useTranslation } from '@/i18n/useTranslation';
import type { UnitType } from './UnitTypeTiles';

export type PropertyVacancy = 'open' | 'waitlist' | 'closed';

export interface PropertySummary {
  id: string;
  slug: string;
  name: string;
  addr: string;
  phone: string;
  blurb: string;
  vacancy: PropertyVacancy;
  heroPhoto: string;
}

interface PropertyCardListProps {
  unitType: UnitType | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
  // Override vacancy badge (used by the `waitlist` / `allFull` state renderers).
  vacancyOverride?: PropertyVacancy;
}

// DL2 MVP — single property. Shape is designed to scale: an array of cards is
// the rendering primitive even though we only have one entry today.
const PROPERTIES: PropertySummary[] = [
  {
    id: 'donna-louise-2',
    slug: 'donna-louise-2',
    name: 'Donna Louise 2',
    addr: '2241 Sunrise Ave',
    phone: '(702) 555-0188',
    blurb: 'Brand new LIHTC community — Sunrise corridor.',
    vacancy: 'open',
    heroPhoto:
      'https://images.unsplash.com/photo-1502672023488-70e25813eb80?auto=format&fit=crop&w=900&q=70',
  },
];

function VacancyBadge({ kind }: { kind: PropertyVacancy }) {
  const { t } = useTranslation('welcome');
  const styles: Record<PropertyVacancy, string> = {
    open: 'bg-emerald-100 text-emerald-800 border-emerald-300',
    waitlist: 'bg-amber-100 text-amber-800 border-amber-300',
    closed: 'bg-stone-200 text-stone-700 border-stone-300',
  };
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${styles[kind]}`}
    >
      {t(`welcome.vacancy.${kind}`)}
    </span>
  );
}

export function PropertyCardList({
  unitType,
  selectedId,
  onSelect,
  vacancyOverride,
}: PropertyCardListProps) {
  const { t } = useTranslation('welcome');

  if (!unitType) {
    return (
      <p className="px-4 py-6 text-center text-sm text-stone-500">
        {t('welcome.tapToBegin')}
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-3 lg:grid lg:grid-cols-2 lg:gap-4">
      {PROPERTIES.map((p) => {
        const isSelected = selectedId === p.id;
        const vacancy = vacancyOverride ?? p.vacancy;
        return (
          <li key={p.id}>
            <button
              type="button"
              aria-pressed={isSelected}
              aria-label={`${p.name} — ${t(`welcome.vacancy.${vacancy}`)}`}
              onClick={() => onSelect(p.id)}
              className={[
                'flex w-full flex-col overflow-hidden rounded-xl border bg-white text-left shadow-sm transition',
                'focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:ring-offset-2',
                isSelected
                  ? 'border-emerald-600 ring-2 ring-emerald-600'
                  : 'border-stone-200 hover:border-stone-300',
              ].join(' ')}
            >
              <div
                className="h-40 w-full bg-stone-200 bg-cover bg-center lg:h-56"
                style={{ backgroundImage: `url(${p.heroPhoto})` }}
                aria-hidden="true"
              />
              <div className="flex flex-col gap-1 p-4">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-base font-semibold text-stone-900">{p.name}</h3>
                  <VacancyBadge kind={vacancy} />
                </div>
                <p className="text-xs text-stone-500">{p.addr} · {p.phone}</p>
                <p className="text-sm text-stone-700">{p.blurb}</p>
                {isSelected && (
                  <p className="mt-1 text-xs font-medium text-emerald-700">
                    ★ {t('welcome.topMatch')}
                  </p>
                )}
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export { PROPERTIES };
