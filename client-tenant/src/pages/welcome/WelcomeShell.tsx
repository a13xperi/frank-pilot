import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { HF } from '@/styles/tokens';
import { CTA } from '@/components/primitives/CTA';
import { DisclosureSheet } from './DisclosureSheet';
import {
  WelcomeStateView,
  WELCOME_STATES,
  type WelcomeState,
} from './WelcomeStates';
import type { UnitType } from './UnitTypeTiles';
import { AmiCalculator, type AmiCalculatorResult } from '@/components/AmiCalculator';

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
  const [amiResult, setAmiResult] = useState<AmiCalculatorResult | null>(null);

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
    // Carry W0 prefill into Apply when the calculator has been run. Tier may
    // legitimately be null (over-income); we still forward income + hh so
    // StepIntent doesn't re-ask for them.
    if (amiResult) {
      qs.set('hh', String(amiResult.householdSize));
      qs.set('income', String(amiResult.grossAnnualIncome));
      if (amiResult.tier) qs.set('amiTier', amiResult.tier);
    }
    navigate(`/apply?${qs.toString()}`);
  };

  const handleAmiResult = (r: AmiCalculatorResult) => {
    setAmiResult(r);
    // Wedge #8 — when the calculator yields a qualifying tier, deep-link
    // the applicant into /discover with their tier preselected so the
    // landing → browse → apply loop closes. Over-income (tier=null) and
    // missing-tier cases stay on the welcome shell so the operator can
    // still walk them through the standard CTA path.
    if (r.tier) {
      navigate(`/discover?amiTier=${encodeURIComponent(r.tier)}`);
    }
  };

  return (
    <div
      className="min-h-screen"
      style={{ background: HF.cream, color: HF.ink, fontFamily: HF.body }}
    >
      {/* Brand header */}
      <header
        className="px-4 py-3 lg:px-8 lg:py-5"
        style={{
          background: HF.paper,
          borderBottom: `1px solid ${HF.border}`,
        }}
      >
        <div className="mx-auto flex max-w-5xl items-center justify-between">
          <div>
            <h1
              className="text-lg lg:text-2xl"
              style={{
                fontFamily: HF.display,
                fontWeight: 800,
                color: HF.ink,
                letterSpacing: '-0.01em',
              }}
            >
              {t('brand')}
            </h1>
            <p className="text-xs lg:text-sm" style={{ color: HF.ink3 }}>
              {t('tagline')}
            </p>
          </div>
          <CTA
            type="button"
            tone="secondary"
            size="sm"
            aria-label={t('help')}
            style={{ borderRadius: HF.r.pill }}
          >
            {t('help')}
          </CTA>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 pb-32 pt-5 lg:px-8 lg:pb-12 lg:pt-8">
        {/* Fee strip */}
        <div
          className="mb-5 flex items-center gap-3 px-3 py-2 text-sm"
          aria-label={t('feeStrip')}
          style={{
            background: HF.accentLo,
            border: `1px solid #F3D7CB`,
            borderRadius: HF.r.md,
            color: HF.accentInk,
          }}
        >
          <span style={{ fontFamily: HF.display, fontWeight: 700, color: HF.accentInk }}>
            $35.95
          </span>
          <span style={{ color: HF.ink2 }}>{t('feeStrip')}</span>
          <button
            type="button"
            className="ml-auto text-xs underline"
            style={{ color: HF.ink3, fontFamily: HF.body }}
          >
            {t('feeDetails')}
          </button>
        </div>

        <WelcomeStateView
          state={state}
          unitType={unitType}
          setUnitType={setUnitType}
          selectedPropertyId={selectedPropertyId}
          setSelectedPropertyId={setSelectedPropertyId}
        />

        {/* AMI pre-qualifier — optional, but if the applicant runs it the
            result flows into Apply via query params (no re-entry needed). */}
        <section className="mt-6">
          <AmiCalculator onResult={handleAmiResult} />
        </section>

        {/* Desktop CTA — inline */}
        <div className="mt-8 hidden lg:block">
          <CTA
            type="button"
            tone="primary"
            size="lg"
            block
            disabled={!canContinue}
            onClick={() => setDisclosureOpen(true)}
          >
            {t('start')}
          </CTA>
        </div>
      </main>

      {/* Mobile sticky footer */}
      <div
        className="fixed inset-x-0 bottom-0 z-40 p-3 lg:hidden"
        style={{
          background: HF.paper,
          borderTop: `1px solid ${HF.border}`,
          boxShadow: HF.shadow.md,
        }}
      >
        <CTA
          type="button"
          tone="primary"
          size="lg"
          block
          disabled={!canContinue}
          onClick={() => setDisclosureOpen(true)}
        >
          {t('start')}
        </CTA>
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
