import { lazy, Suspense, useEffect, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { CheckCircle } from 'lucide-react';
import { api } from '@/api/client';
import { fetchVoicePrefill } from '@/api/voiceIntake';
import { ClaimedUnitHeader } from '@/components/ClaimedUnitHeader';
import { Card } from '@/components/primitives';
import { HF } from '@/styles/tokens';
import { useTranslation } from 'react-i18next';
import { useFlag } from '@/lib/flags';
import { useIsMobile } from '@/hooks/useIsMobile';
import { logDemoEvent } from '@/lib/demoCapture';
import {
  ApplyProvider,
  useWizState,
  type ApplyState,
  type Step,
} from './apply/ApplyContext';
import { useCobrowseStep } from './apply/useCobrowseStep';
import { StepIndicator } from './apply/StepIndicator';
import { MobileApplyShell } from './apply/MobileApplyShell';
import { Step1Register } from './apply/steps/Step1Register';
import { StepVerify } from './apply/steps/StepVerify';
import { StepIntent } from './apply/steps/StepIntent';
import { StepChecklist } from './apply/steps/StepChecklist';
import { StepPick } from './apply/steps/StepPick';
import { StepClaim } from './apply/steps/StepClaim';
import { Step2Details } from './apply/steps/Step2Details';
import type { Unit } from '@/api/units';

// FROZEN CONTRACT 1 — Lane W payment-wizard steps, lazy-loaded.
// W1 ships placeholder stubs; W2/W3 overwrite the file contents on merge.
const StepReview = lazy(() => import('./apply/steps/StepReview'));
const StepHousehold = lazy(() => import('./apply/steps/StepHousehold'));
const StepPayment = lazy(() => import('./apply/steps/StepPayment'));
const StepConfirm = lazy(() => import('./apply/steps/StepConfirm'));

// Issue #8 — placeholder painted while the intent-step hydration fetch is in
// flight on a fresh deep link (`?step=intent`). Mirrors the StepIntent layout
// (title, bedroom row, slider, date, household, income, CTA) so swapping in
// the real form doesn't shift layout. Reads as "loading" via aria-busy.
function IntentSkeleton() {
  const bar = (h: number, w: string) => (
    <div
      style={{
        height: h,
        width: w,
        background: HF.border,
        borderRadius: HF.r.sm,
        opacity: 0.5,
      }}
    />
  );
  return (
    <div aria-busy="true" aria-live="polite" data-testid="intent-skeleton" className="space-y-5">
      <div className="space-y-2">
        {bar(20, '60%')}
        {bar(14, '80%')}
      </div>
      <div className="space-y-2">
        {bar(12, '30%')}
        <div className="grid grid-cols-5 gap-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i}>{bar(40, '100%')}</div>
          ))}
        </div>
      </div>
      <div className="space-y-2">
        {bar(12, '40%')}
        {bar(16, '100%')}
      </div>
      <div className="space-y-2">
        {bar(12, '35%')}
        {bar(36, '100%')}
      </div>
      <div className="space-y-2">
        {bar(12, '35%')}
        {bar(36, '100%')}
      </div>
      <div className="space-y-2">
        {bar(12, '55%')}
        {bar(36, '100%')}
      </div>
      {bar(44, '100%')}
    </div>
  );
}

function parseStep(raw: string | null): Step {
  if (raw === '2') return 2;
  if (
    raw === 'verify' ||
    raw === 'intent' ||
    raw === 'checklist' ||
    raw === 'pick' ||
    raw === 'claim' ||
    raw === 'review' ||
    raw === 'household' ||
    raw === 'payment' ||
    raw === 'confirm'
  ) {
    return raw;
  }
  return 1;
}

export function Apply() {
  const [search, setSearch] = useSearchParams();
  const { t } = useTranslation('apply');
  const [step, setStepState] = useState<Step>(parseStep(search.get('step')));

  function setStep(next: Step) {
    setStepState(next);
    const value = next === 1 ? null : String(next);
    // Issue #9 — merge with the LATEST URLSearchParams snapshot rather than
    // the closure-captured `search`. The functional form guarantees we don't
    // clobber utm_* / unitType / propertyId / state / any inbound params that
    // were added between renders or in a sibling effect.
    setSearch(
      (prev) => {
        const nextParams = new URLSearchParams(prev);
        if (value) nextParams.set('step', value);
        else nextParams.delete('step');
        return nextParams;
      },
      { replace: true },
    );
  }

  // Sync step state when the URL changes externally — child steps (Household,
  // Review, Payment) call setSearch directly and browser back/forward also
  // mutate `search` without going through setStep.
  useEffect(() => {
    const next = parseStep(search.get('step'));
    setStepState((prev) => (prev === next ? prev : next));
  }, [search]);

  // Funnel drop-off: stamp each step the tester reaches into the demo event
  // log. No-op outside a `?demo=` session. The timeline of `step-entered`
  // events is what surfaces where people stall or abandon the application.
  useEffect(() => {
    logDemoEvent('step-entered', { step: String(step) });
  }, [step]);

  // Tier 1 guided co-pilot: when opened from Frank's co-browse link
  // (`?cobrowse=&vt=`), report the wizard step so Frank can coach in sync.
  // No-op otherwise; only the step KEY is sent, never field values.
  useCobrowseStep(step);

  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const [email, setEmail] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');

  const [resending, setResending] = useState(false);
  const [resent, setResent] = useState(false);
  const [devLink, setDevLink] = useState<string | null>(null);

  const [intentBudgetMax, setIntentBudgetMax] = useState<number>(2000);
  const [intentMoveInDate, setIntentMoveInDate] = useState('');

  const [units, setUnits] = useState<Unit[]>([]);
  const [unitsLoading, setUnitsLoading] = useState(false);
  const [claimingUnitId, setClaimingUnitId] = useState<string | null>(null);

  const [claimedUnit, setClaimedUnit] = useState<Unit | null>(null);
  const [claimExpiresAt, setClaimExpiresAt] = useState<string | null>(null);

  const [properties, setProperties] = useState<ApplyState['properties']>([]);
  const [propertiesLoading, setPropertiesLoading] = useState(false);
  const [propertiesFailed, setPropertiesFailed] = useState(false);

  const [propertyId, setPropertyId] = useState('');
  const [unitNumber, setUnitNumber] = useState('');
  const [ssn, setSsn] = useState('');
  const [ssnError, setSsnError] = useState<string | null>(null);
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [addressLine1, setAddressLine1] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [zip, setZip] = useState('');
  const [employerName, setEmployerName] = useState('');
  const [annualIncome, setAnnualIncome] = useState('');
  const [householdSize, setHouseholdSize] = useState('1');
  const [moveInDate, setMoveInDate] = useState('');

  // FROZEN CONTRACT 2 — wizard state (adults / paymentTotal / paymentRef),
  // persisted to sessionStorage under key `frank_apply_state`.
  const wiz = useWizState();

  // Wedge #5 — seed propertySlug from the ?propertyId= query param (set by
  // PropertyDetail when bouncing the user to /apply). Falls back to wiz state
  // (persisted) so a reload on the confirm step doesn't lose the CTA.
  useEffect(() => {
    const slugFromUrl = search.get('propertyId');
    if (slugFromUrl && !wiz.propertySlug) {
      wiz.setPropertySlug(slugFromUrl);
    }
    // Run only on mount — URL param is consumed once, wiz state owns it after.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Phase B.2 — voice-intake prefill. When the applicant arrives from a "Talk
  // to Frank" call, the magic link carried `?intake=<conversationId>` (preserved
  // through AuthCallback). Hydrate the wizard with what Frank collected on the
  // call. Best-effort and fill-only-empty: never clobber a value the user typed
  // or one the Issue #8 /auth/me + applications hydration already set. Any
  // failure (soft-404 / 401 / network) falls back to the blank form — identical
  // to a cold start. Mount-once, like the Wedge #5 propertyId consumer above.
  useEffect(() => {
    const conversationId = search.get('intake');
    if (!conversationId) return;
    let cancelled = false;
    (async () => {
      try {
        const { prefill: p } = await fetchVoicePrefill(conversationId);
        if (cancelled || !p) return;
        if (p.firstName) setFirstName((prev) => prev || p.firstName!);
        if (p.lastName) setLastName((prev) => prev || p.lastName!);
        if (p.phone) setPhone((prev) => prev || p.phone!);
        if (p.currentCity) setCity((prev) => prev || p.currentCity!);
        if (p.householdSize != null) {
          // Local field defaults to '1'; only override the untouched default so
          // we don't stomp a value the user changed or an application supplied.
          setHouseholdSize((prev) => (prev === '1' ? String(p.householdSize) : prev));
          // intentHouseholdSize defaults to 1 (ApplyContext) — never null. Guard
          // on the untouched default so we fill it but never stomp a user/app value.
          if (wiz.intentHouseholdSize === 1) wiz.setIntentHouseholdSize(p.householdSize);
        }
        if (p.monthlyIncome != null) {
          // Frank collects MONTHLY income; the wizard's details step holds gross
          // ANNUAL. Convert once here so AMI tiering downstream sees annual.
          setAnnualIncome((prev) => prev || String(Math.round(p.monthlyIncome! * 12)));
        }
      } catch {
        /* best-effort — soft-404 / 401 / network all fall back to blank form */
      }
    })();
    return () => { cancelled = true; };
    // Consume the intake handle once on mount, mirroring Wedge #5 above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Issue #8 — gate render on intent-step deep links until hydration completes.
  // Without this, landing on `?step=intent` paints the empty quiz form for a
  // tick before /auth/me + /applicants/me/applications resolve and backfill
  // bedrooms / budget / move-in / household size. We flip `hydrated` true in
  // the same effect that does the fetch — including the early-out paths — so
  // any code path that "doesn't need hydration" still unlocks render.
  const [hydrated, setHydrated] = useState(false);

  // Hydrate identity + intent prefill on entering intent/checklist/pick/2 (deep links).
  useEffect(() => {
    if (step !== 'intent' && step !== 'checklist' && step !== 'pick' && step !== 2) {
      // Non-hydrating step (1 / verify / claim / review / household / payment /
      // confirm): nothing to wait on, render immediately.
      setHydrated(true);
      return;
    }
    if (email && firstName && lastName) {
      // Identity already in memory — no fetch needed, unblock render.
      setHydrated(true);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const me = await api.get<{ user?: { email: string; firstName: string; lastName: string } }>('/auth/me');
        if (cancelled) return;
        if (me.user) {
          if (!email) setEmail(me.user.email);
          if (!firstName) setFirstName(me.user.firstName);
          if (!lastName) setLastName(me.user.lastName);
        }

        const apps = await api.get<{ applications?: Array<{
          id: string; property_id?: string; unit_number?: string;
          intent_bedrooms?: number | null;
          intent_budget_max?: string | number | null;
          intent_move_in_date?: string | null;
          intent_household_size?: number | null;
        }> }>('/applicants/me/applications');
        if (cancelled) return;
        const latest = apps.applications?.[0];
        if (latest) {
          if (latest.property_id && !propertyId) setPropertyId(latest.property_id);
          if (latest.unit_number && !unitNumber) setUnitNumber(latest.unit_number);
          if (latest.intent_bedrooms != null && wiz.intentBedrooms === null) wiz.setIntentBedrooms(latest.intent_bedrooms);
          if (latest.intent_budget_max != null) setIntentBudgetMax(Number(latest.intent_budget_max));
          if (latest.intent_move_in_date) setIntentMoveInDate(latest.intent_move_in_date.slice(0, 10));
          if (latest.intent_household_size != null) {
            // Fill-only-default, mirroring the Phase B.2 voice prefill above:
            // these two effects both write household at mount and race, so
            // whichever resolves first wins and neither clobbers the other.
            const hh = latest.intent_household_size;
            if (wiz.intentHouseholdSize === 1) wiz.setIntentHouseholdSize(hh);
            setHouseholdSize((prev) => (prev === '1' ? String(hh) : prev));
          }
        }
      } catch {
        /* ignored — hydration is best-effort, unblock render on failure too */
      } finally {
        if (!cancelled) setHydrated(true);
      }
    })();
    return () => { cancelled = true; };
  }, [step, email, firstName, lastName, propertyId, unitNumber, wiz]);

  // Wedge #7 — mobile-first shell behind MOBILE_APPLY_ENABLED. Active only
  // when (a) flag on AND (b) viewport < md. Desktop and flag-off paths
  // continue to render the legacy layout pixel-stable. These hooks MUST run
  // before any early-return below to keep the hook count stable across
  // renders (otherwise `if (done) return ...` short-circuits these).
  const mobileFlag = useFlag('MOBILE_APPLY_ENABLED');
  const isMobile = useIsMobile();
  const useMobileShell = mobileFlag && isMobile;

  const value: ApplyState = {
    step, setStep, error, setError, loading, setLoading,
    email, setEmail, firstName, setFirstName, lastName, setLastName, phone, setPhone,
    resending, setResending, resent, setResent, devLink, setDevLink,
    intentBedrooms: wiz.intentBedrooms, setIntentBedrooms: wiz.setIntentBedrooms,
    intentBudgetMax, setIntentBudgetMax,
    intentMoveInDate, setIntentMoveInDate,
    intentHouseholdSize: wiz.intentHouseholdSize, setIntentHouseholdSize: wiz.setIntentHouseholdSize,
    grossAnnualIncome: wiz.grossAnnualIncome, setGrossAnnualIncome: wiz.setGrossAnnualIncome,
    qualifyingAmiTier: wiz.qualifyingAmiTier, setQualifyingAmiTier: wiz.setQualifyingAmiTier,
    qualifyingAmiCalculatedAt: wiz.qualifyingAmiCalculatedAt,
    setQualifyingAmiCalculatedAt: wiz.setQualifyingAmiCalculatedAt,
    qualifyingHouseholdSize: wiz.qualifyingHouseholdSize,
    setQualifyingHouseholdSize: wiz.setQualifyingHouseholdSize,
    units, setUnits, unitsLoading, setUnitsLoading, claimingUnitId, setClaimingUnitId,
    claimedUnit, setClaimedUnit, claimExpiresAt, setClaimExpiresAt,
    properties, setProperties, propertiesLoading, setPropertiesLoading, propertiesFailed, setPropertiesFailed,
    propertyId, setPropertyId, unitNumber, setUnitNumber, ssn, setSsn, ssnError, setSsnError,
    dateOfBirth, setDateOfBirth, addressLine1, setAddressLine1, city, setCity, state, setState, zip, setZip,
    employerName, setEmployerName, annualIncome, setAnnualIncome, householdSize, setHouseholdSize, moveInDate, setMoveInDate,
    done, setDone,
    // Wedge #5 — waitlist outcome
    outcome: wiz.outcome, setOutcome: wiz.setOutcome,
    propertySlug: wiz.propertySlug, setPropertySlug: wiz.setPropertySlug,
    // Contract 2 — wizard
    adults: wiz.adults, setAdults: wiz.setAdults,
    paymentTotal: wiz.paymentTotal,
    paymentRef: wiz.paymentRef, setPaymentRef: wiz.setPaymentRef,
  };

  if (done) {
    return (
      <div
        className="flex min-h-screen items-center justify-center p-4"
        style={{ background: HF.cream, color: HF.ink, fontFamily: HF.body }}
      >
        <div className="flex flex-col items-center gap-4 text-center">
          <CheckCircle className="h-12 w-12" style={{ color: HF.ok }} />
          <h2 className="text-xl font-bold" style={{ fontFamily: HF.display, color: HF.ink }}>
            {t('common.submitted')}
          </h2>
          <p className="text-sm" style={{ color: HF.ink3 }}>{t('common.redirecting')}</p>
        </div>
      </div>
    );
  }

  const containerWidth = step === 'pick' ? 'max-w-3xl' : 'max-w-md';

  const stepBody = (
    <>
      {step === 1 && <Step1Register />}
      {step === 'verify' && <StepVerify />}
      {step === 'intent' && (hydrated ? <StepIntent /> : <IntentSkeleton />)}
      {step === 'checklist' && <StepChecklist />}
      {step === 'pick' && <StepPick />}
      {step === 'claim' && <StepClaim />}
      {step === 'review' && (
        <Suspense fallback={null}><StepReview /></Suspense>
      )}
      {step === 'household' && (
        <Suspense fallback={null}><StepHousehold /></Suspense>
      )}
      {step === 'payment' && (
        <Suspense fallback={null}><StepPayment /></Suspense>
      )}
      {step === 2 && <Step2Details />}
      {step === 'confirm' && (
        <Suspense fallback={null}>
          <StepConfirm
            outcome={value.outcome}
            propertySlug={value.propertySlug}
            bedrooms={value.intentBedrooms}
          />
        </Suspense>
      )}
    </>
  );

  const errorBanner = error && (
    <div
      className="mb-4 p-3 text-sm"
      role="alert"
      style={{
        background: HF.errLo,
        color: HF.err,
        border: `1px solid ${HF.err}33`,
        borderRadius: HF.r.sm,
      }}
    >
      {error}
    </div>
  );

  if (useMobileShell) {
    // Mobile shell — own progress strip (top) and sticky CTA bar
    // (bottom, portaled into by StepCTA). Steps render edge-to-edge
    // inside the scrollable middle region; no outer Card chrome.
    return (
      <ApplyProvider value={value}>
        <MobileApplyShell>
          {step === 2 && claimedUnit && claimExpiresAt && (
            <ClaimedUnitHeader unit={claimedUnit} expiresAt={claimExpiresAt} />
          )}
          {errorBanner}
          {stepBody}
          <p
            className="text-center text-sm"
            style={{ color: HF.ink3, marginTop: 24 }}
          >
            {t('common.alreadyHaveAccount')}{' '}
            <Link
              to="/login"
              className="font-medium hover:underline"
              style={{ color: HF.accent }}
            >
              {t('common.signIn')}
            </Link>
          </p>
        </MobileApplyShell>
      </ApplyProvider>
    );
  }

  return (
    <ApplyProvider value={value}>
      <div
        className="min-h-screen p-4"
        style={{ background: HF.cream, color: HF.ink, fontFamily: HF.body }}
      >
        <div className="mx-auto flex max-w-6xl gap-8 py-8">
          <aside className="hidden w-56 shrink-0 lg:block">
            <StepIndicator />
          </aside>
          <div className={`mx-auto ${containerWidth} flex-1 space-y-6`}>
            {step === 2 && claimedUnit && claimExpiresAt && (
              <ClaimedUnitHeader unit={claimedUnit} expiresAt={claimExpiresAt} />
            )}
            <div className="lg:hidden"><StepIndicator /></div>
            <Card>
              {errorBanner}
              {stepBody}
            </Card>
            <p className="text-center text-sm" style={{ color: HF.ink3 }}>
              {t('common.alreadyHaveAccount')}{' '}
              <Link
                to="/login"
                className="font-medium hover:underline"
                style={{ color: HF.accent }}
              >
                {t('common.signIn')}
              </Link>
            </p>
          </div>
        </div>
      </div>
    </ApplyProvider>
  );
}
