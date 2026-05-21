import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from '@/i18n/useTranslation';
import { DisclosureSheet } from './DisclosureSheet';
import {
  WelcomeStateView,
  WELCOME_STATES,
  type WelcomeState,
} from './WelcomeStates';
import type { UnitType } from './UnitTypeTiles';

function parseState(raw: string | null): WelcomeState {
  if (raw && (WELCOME_STATES as readonly string[]).includes(raw)) {
    return raw as WelcomeState;
  }
  return 'available';
}

// Initial unit-type guess per state (matches direction-2-cards.jsx).
function defaultUnitType(state: WelcomeState): UnitType | null {
  switch (state) {
    case 'available':
    case 'waitlist':
    case 'referral':
      return '2BR';
    case 'allFull':
    case 'returning':
      return '1BR';
    case 'empty':
    default:
      return null;
  }
}

export function WelcomeShell() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { t } = useTranslation('welcome');

  const state = useMemo(() => parseState(params.get('state')), [params]);

  const [unitType, setUnitType] = useState<UnitType | null>(() => defaultUnitType(state));
  const [selectedPropertyId, setSelectedPropertyId] = useState<string | null>(
    'donna-louise-2',
  );
  const [disclosureOpen, setDisclosureOpen] = useState(false);

  const canContinue = unitType !== null && selectedPropertyId !== null;

  const handleAccept = () => {
    setDisclosureOpen(false);
    if (!unitType || !selectedPropertyId) return;
    const qs = new URLSearchParams({
      step: 'intent',
      unitType,
      propertyId: selectedPropertyId,
      state,
    });
    navigate(`/apply?${qs.toString()}`);
  };

  return (
    <div className="min-h-screen bg-stone-50">
      {/* Brand header */}
      <header className="border-b border-stone-200 bg-white px-4 py-3 lg:px-8 lg:py-5">
        <div className="mx-auto flex max-w-5xl items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-stone-900 lg:text-2xl">
              {t('welcome.brand')}
            </h1>
            <p className="text-xs text-stone-500 lg:text-sm">{t('welcome.tagline')}</p>
          </div>
          <button
            type="button"
            className="rounded-full border border-stone-300 px-3 py-1 text-xs text-stone-600 hover:bg-stone-100"
            aria-label={t('welcome.help')}
          >
            {t('welcome.help')}
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 pb-32 pt-5 lg:px-8 lg:pb-12 lg:pt-8">
        {/* Fee strip */}
        <div
          className="mb-5 flex items-center gap-3 rounded-lg border border-stone-200 bg-amber-50 px-3 py-2 text-sm"
          aria-label={t('welcome.feeStrip')}
        >
          <span className="font-semibold text-stone-900">$35.95</span>
          <span className="text-stone-700">{t('welcome.feeStrip')}</span>
          <button
            type="button"
            className="ml-auto text-xs underline text-stone-600"
          >
            {t('welcome.feeDetails')}
          </button>
        </div>

        <WelcomeStateView
          state={state}
          unitType={unitType}
          setUnitType={setUnitType}
          selectedPropertyId={selectedPropertyId}
          setSelectedPropertyId={setSelectedPropertyId}
        />

        {/* Desktop CTA — inline */}
        <div className="mt-8 hidden lg:block">
          <button
            type="button"
            disabled={!canContinue}
            onClick={() => setDisclosureOpen(true)}
            className="w-full rounded-xl bg-emerald-600 px-6 py-3 text-base font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-stone-300"
          >
            {t('welcome.start')}
          </button>
        </div>
      </main>

      {/* Mobile sticky footer */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-stone-200 bg-white p-3 shadow-lg lg:hidden">
        <button
          type="button"
          disabled={!canContinue}
          onClick={() => setDisclosureOpen(true)}
          className="w-full rounded-xl bg-emerald-600 px-6 py-3 text-base font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-stone-300"
        >
          {t('welcome.start')}
        </button>
      </div>

      <DisclosureSheet
        open={disclosureOpen}
        onAccept={handleAccept}
        onCancel={() => setDisclosureOpen(false)}
      />
    </div>
  );
}

export default WelcomeShell;
