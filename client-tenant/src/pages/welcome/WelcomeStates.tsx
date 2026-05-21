import { useTranslation } from '@/i18n/useTranslation';
import { UnitTypeTiles, type UnitType } from './UnitTypeTiles';
import { PropertyCardList, type PropertyVacancy } from './PropertyCardList';

export type WelcomeState =
  | 'empty'
  | 'available'
  | 'waitlist'
  | 'allFull'
  | 'referral'
  | 'returning';

export const WELCOME_STATES: WelcomeState[] = [
  'empty',
  'available',
  'waitlist',
  'allFull',
  'referral',
  'returning',
];

interface StateViewProps {
  state: WelcomeState;
  unitType: UnitType | null;
  setUnitType: (u: UnitType) => void;
  selectedPropertyId: string | null;
  setSelectedPropertyId: (id: string) => void;
}

interface BannerProps {
  state: WelcomeState;
}

function StateBanner({ state }: BannerProps) {
  const { t } = useTranslation('welcome');
  const palette: Record<WelcomeState, string> = {
    empty: 'bg-stone-50 border-stone-200 text-stone-800',
    available: 'bg-emerald-50 border-emerald-200 text-emerald-900',
    waitlist: 'bg-amber-50 border-amber-200 text-amber-900',
    allFull: 'bg-rose-50 border-rose-200 text-rose-900',
    referral: 'bg-orange-50 border-orange-200 text-orange-900',
    returning: 'bg-sky-50 border-sky-200 text-sky-900',
  };
  return (
    <div
      role="status"
      aria-live="polite"
      className={`rounded-xl border px-4 py-3 ${palette[state]}`}
    >
      <h2 className="text-base font-semibold">{t(`welcome.states.${state}.heading`)}</h2>
      <p className="mt-0.5 text-sm">{t(`welcome.states.${state}.body`)}</p>
    </div>
  );
}

/**
 * Renders the body for a given welcome state. Six states, each composing
 * `UnitTypeTiles` + `PropertyCardList` with state-appropriate adornments.
 */
export function WelcomeStateView({
  state,
  unitType,
  setUnitType,
  selectedPropertyId,
  setSelectedPropertyId,
}: StateViewProps) {
  const { t } = useTranslation('welcome');

  // Each state may override the vacancy badge.
  const vacancyOverride: PropertyVacancy | undefined =
    state === 'waitlist'
      ? 'waitlist'
      : state === 'allFull'
      ? 'closed'
      : state === 'available' || state === 'referral'
      ? 'open'
      : undefined;

  return (
    <div className="flex flex-col gap-5">
      <StateBanner state={state} />

      <section aria-labelledby="unit-type-heading">
        <h2
          id="unit-type-heading"
          className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-500"
        >
          {t('welcome.step2_label')}
        </h2>
        <UnitTypeTiles selected={unitType} onSelect={setUnitType} />
      </section>

      <section aria-labelledby="property-heading">
        <h2
          id="property-heading"
          className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-500"
        >
          {state === 'allFull' ? t('welcome.vacancy.closed') : t('welcome.brand')}
        </h2>
        <PropertyCardList
          unitType={unitType}
          selectedId={selectedPropertyId}
          onSelect={setSelectedPropertyId}
          vacancyOverride={vacancyOverride}
        />
      </section>
    </div>
  );
}
