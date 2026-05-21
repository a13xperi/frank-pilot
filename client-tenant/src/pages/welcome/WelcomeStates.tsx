import { useTranslation } from 'react-i18next';
import { HF } from '@/styles/tokens';
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

type BannerPalette = { bg: string; border: string; fg: string };

const STATE_PALETTE: Record<WelcomeState, BannerPalette> = {
  empty:     { bg: HF.paper,    border: HF.border,    fg: HF.ink     },
  available: { bg: HF.okLo,     border: '#CBE3C5',    fg: HF.ok      },
  waitlist:  { bg: HF.warnLo,   border: '#EAD9A8',    fg: HF.warn    },
  allFull:   { bg: HF.errLo,    border: '#EFC6BE',    fg: HF.err     },
  referral:  { bg: HF.accentLo, border: '#F3D7CB',    fg: HF.accentInk },
  returning: { bg: HF.sageLo,   border: '#D7E2CF',    fg: HF.sage    },
};

function StateBanner({ state }: BannerProps) {
  const { t } = useTranslation('welcome');
  const p = STATE_PALETTE[state];
  return (
    <div
      role="status"
      aria-live="polite"
      className="px-4 py-3"
      style={{
        background: p.bg,
        border: `1px solid ${p.border}`,
        borderRadius: HF.r.lg,
        color: p.fg,
        fontFamily: HF.body,
      }}
    >
      <h2
        className="text-base"
        style={{
          fontFamily: HF.display,
          fontWeight: 700,
          color: p.fg,
        }}
      >
        {t(`states.${state}.heading`)}
      </h2>
      <p className="mt-0.5 text-sm" style={{ color: p.fg }}>
        {t(`states.${state}.body`)}
      </p>
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

  const sectionLabelStyle = {
    color: HF.ink3,
    fontFamily: HF.body,
  } as const;

  return (
    <div className="flex flex-col gap-5">
      <StateBanner state={state} />

      <section aria-labelledby="unit-type-heading">
        <h2
          id="unit-type-heading"
          className="mb-2 text-xs font-semibold uppercase tracking-wide"
          style={sectionLabelStyle}
        >
          {t('step2_label')}
        </h2>
        <UnitTypeTiles selected={unitType} onSelect={setUnitType} />
      </section>

      <section aria-labelledby="property-heading">
        <h2
          id="property-heading"
          className="mb-2 text-xs font-semibold uppercase tracking-wide"
          style={sectionLabelStyle}
        >
          {state === 'allFull' ? t('vacancy.closed') : t('brand')}
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
