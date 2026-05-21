import { lazy, Suspense, useEffect, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { CheckCircle } from 'lucide-react';
import { api } from '@/api/client';
import { ClaimedUnitHeader } from '@/components/ClaimedUnitHeader';
import { Card } from '@/components/primitives';
import { useTranslation } from 'react-i18next';
import {
  ApplyProvider,
  useWizState,
  type ApplyState,
  type Step,
} from './apply/ApplyContext';
import { StepIndicator } from './apply/StepIndicator';
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
    // Preserve handoff params (unitType/propertyId/state) on step transitions.
    const nextParams = new URLSearchParams(search);
    if (value) nextParams.set('step', value);
    else nextParams.delete('step');
    setSearch(nextParams, { replace: true });
  }

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

  const [intentBedrooms, setIntentBedrooms] = useState<number | null>(null);
  const [intentBudgetMax, setIntentBudgetMax] = useState<number>(2000);
  const [intentMoveInDate, setIntentMoveInDate] = useState('');
  const [intentHouseholdSize, setIntentHouseholdSize] = useState<number>(1);

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

  // Hydrate identity + intent prefill on entering intent/checklist/pick/2 (deep links).
  useEffect(() => {
    if (step !== 'intent' && step !== 'checklist' && step !== 'pick' && step !== 2) return;
    if (email && firstName && lastName) return;
    let cancelled = false;
    (async () => {
      try {
        const me = await api.get<{ user?: { email: string; firstName: string; lastName: string } }>('/auth/me');
        if (cancelled || !me.user) return;
        if (!email) setEmail(me.user.email);
        if (!firstName) setFirstName(me.user.firstName);
        if (!lastName) setLastName(me.user.lastName);

        const apps = await api.get<{ applications?: Array<{
          id: string; property_id?: string; unit_number?: string;
          intent_bedrooms?: number | null;
          intent_budget_max?: string | number | null;
          intent_move_in_date?: string | null;
          intent_household_size?: number | null;
        }> }>('/applicants/me/applications');
        const latest = apps.applications?.[0];
        if (cancelled || !latest) return;
        if (latest.property_id && !propertyId) setPropertyId(latest.property_id);
        if (latest.unit_number && !unitNumber) setUnitNumber(latest.unit_number);
        if (latest.intent_bedrooms != null && intentBedrooms === null) setIntentBedrooms(latest.intent_bedrooms);
        if (latest.intent_budget_max != null) setIntentBudgetMax(Number(latest.intent_budget_max));
        if (latest.intent_move_in_date) setIntentMoveInDate(latest.intent_move_in_date.slice(0, 10));
        if (latest.intent_household_size != null) {
          setIntentHouseholdSize(latest.intent_household_size);
          setHouseholdSize(String(latest.intent_household_size));
        }
      } catch {
        /* ignored */
      }
    })();
    return () => { cancelled = true; };
  }, [step, email, firstName, lastName, propertyId, unitNumber, intentBedrooms]);

  const value: ApplyState = {
    step, setStep, error, setError, loading, setLoading,
    email, setEmail, firstName, setFirstName, lastName, setLastName, phone, setPhone,
    resending, setResending, resent, setResent, devLink, setDevLink,
    intentBedrooms, setIntentBedrooms, intentBudgetMax, setIntentBudgetMax,
    intentMoveInDate, setIntentMoveInDate, intentHouseholdSize, setIntentHouseholdSize,
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
    // Contract 2 — wizard
    adults: wiz.adults, setAdults: wiz.setAdults,
    paymentTotal: wiz.paymentTotal,
    paymentRef: wiz.paymentRef, setPaymentRef: wiz.setPaymentRef,
  };

  if (done) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 p-4">
        <div className="flex flex-col items-center gap-4 text-center">
          <CheckCircle className="h-12 w-12 text-emerald-600" />
          <h2 className="text-xl font-bold text-gray-900">{t('common.submitted')}</h2>
          <p className="text-sm text-gray-500">{t('common.redirecting')}</p>
        </div>
      </div>
    );
  }

  const containerWidth = step === 'pick' ? 'max-w-3xl' : 'max-w-md';

  return (
    <ApplyProvider value={value}>
      <div className="min-h-screen bg-gray-50 p-4">
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
              {error && (
                <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700" role="alert">
                  {error}
                </div>
              )}
              {step === 1 && <Step1Register />}
              {step === 'verify' && <StepVerify />}
              {step === 'intent' && <StepIntent />}
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
                <Suspense fallback={null}><StepConfirm /></Suspense>
              )}
            </Card>
            <p className="text-center text-sm text-gray-500">
              {t('common.alreadyHaveAccount')}{' '}
              <Link to="/login" className="font-medium text-emerald-600 hover:underline">
                {t('common.signIn')}
              </Link>
            </p>
          </div>
        </div>
      </div>
    </ApplyProvider>
  );
}
