import { useTranslation } from 'react-i18next';
import { HF } from '@/styles/tokens';
import { Pill, type PillTone } from '@/components/primitives/Pill';
import type { UnitType } from './UnitTypeTiles';

export type PropertyVacancy = 'open' | 'waitlist' | 'closed';

const VACANCY_TONE: Record<PropertyVacancy, PillTone> = {
  open: 'ok',
  waitlist: 'warn',
  closed: 'neutral',
};

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

export function PropertyCardList({
  unitType,
  selectedId,
  onSelect,
  vacancyOverride,
}: PropertyCardListProps) {
  const { t } = useTranslation('welcome');

  if (!unitType) {
    return (
      <p
        className="px-4 py-6 text-center text-sm"
        style={{ color: HF.ink3, fontFamily: HF.body }}
      >
        {t('tapToBegin')}
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
              aria-label={`${p.name} — ${t(`vacancy.${vacancy}`)}`}
              onClick={() => onSelect(p.id)}
              className="flex w-full flex-col overflow-hidden text-left transition focus:outline-none"
              style={{
                background: HF.paper,
                border: `1px solid ${isSelected ? HF.accent : HF.border}`,
                borderRadius: HF.r.lg,
                boxShadow: isSelected
                  ? `${HF.shadow.sm}, 0 0 0 2px ${HF.accent}`
                  : HF.shadow.sm,
                color: HF.ink,
                fontFamily: HF.body,
              }}
            >
              <div
                className="h-40 w-full bg-cover bg-center lg:h-56"
                style={{
                  backgroundImage: `url(${p.heroPhoto})`,
                  backgroundColor: HF.borderHi,
                }}
                aria-hidden="true"
              />
              <div className="flex flex-col gap-1 p-4">
                <div className="flex items-start justify-between gap-2">
                  <h3
                    className="text-base"
                    style={{
                      fontFamily: HF.display,
                      fontWeight: 700,
                      color: HF.ink,
                    }}
                  >
                    {p.name}
                  </h3>
                  <Pill tone={VACANCY_TONE[vacancy]}>
                    {t(`vacancy.${vacancy}`)}
                  </Pill>
                </div>
                <p className="text-xs" style={{ color: HF.ink3 }}>
                  {p.addr} · {p.phone}
                </p>
                <p className="text-sm" style={{ color: HF.ink2 }}>
                  {p.blurb}
                </p>
                {isSelected && (
                  <p
                    className="mt-1 text-xs"
                    style={{ color: HF.accent, fontWeight: 600 }}
                  >
                    ★ {t('topMatch')}
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
