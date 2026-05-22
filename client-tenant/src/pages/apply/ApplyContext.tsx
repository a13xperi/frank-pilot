import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Unit } from '@/api/units';
import type { AmiTier } from '@/lib/ami';

// FROZEN CONTRACT 1 — step-key union, in order:
// 1 · verify · intent · checklist · pick · claim · review · household · payment · 2 · confirm
// `claim → review` is the wedge point. `2` stays after `payment`. `confirm` is terminal.
export type Step =
  | 1
  | 'verify'
  | 'intent'
  | 'checklist'
  | 'pick'
  | 'claim'
  | 'review'
  | 'household'
  | 'payment'
  | 2
  | 'confirm';

// FROZEN CONTRACT 2 — payment wizard fields, persisted to sessionStorage.
const SESSION_KEY = 'frank_apply_state';

export const APPLICATION_FEE = 35.95;

export function formatPaymentTotal(adults: number): string {
  return (APPLICATION_FEE * adults).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
  });
}

interface WizPersisted {
  adults: number;
  paymentRef: string | null;
  // W0 — persist tier across mid-funnel refreshes so the applicant doesn't
  // re-enter income when sessionStorage survives a reload of /apply.
  grossAnnualIncome: number | null;
  qualifyingAmiTier: AmiTier | null;
  qualifyingAmiCalculatedAt: string | null;
  qualifyingHouseholdSize: number | null;
  // Welcome→apply handoff: bedroom + household size must survive the
  // /auth/callback route hop (Apply unmounts during verify).
  intentBedrooms: number | null;
  intentHouseholdSize: number;
  // Wedge #5 — persist waitlist outcome so StepConfirm CTA survives a reload.
  outcome: 'claimed' | 'waitlisted' | null;
  propertySlug: string | null;
}

const DEFAULTS: WizPersisted = {
  adults: 1,
  paymentRef: null,
  grossAnnualIncome: null,
  qualifyingAmiTier: null,
  qualifyingAmiCalculatedAt: null,
  qualifyingHouseholdSize: null,
  intentBedrooms: null,
  intentHouseholdSize: 1,
  outcome: null,
  propertySlug: null,
};

const TIER_SET: ReadonlySet<AmiTier> = new Set(['30', '50', '60', '80']);

function readPersisted(): WizPersisted {
  if (typeof window === 'undefined') return { ...DEFAULTS };
  try {
    const raw = window.sessionStorage.getItem(SESSION_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<WizPersisted>;
    return {
      adults: typeof parsed.adults === 'number' ? parsed.adults : DEFAULTS.adults,
      paymentRef: typeof parsed.paymentRef === 'string' ? parsed.paymentRef : null,
      grossAnnualIncome:
        typeof parsed.grossAnnualIncome === 'number' ? parsed.grossAnnualIncome : null,
      qualifyingAmiTier:
        typeof parsed.qualifyingAmiTier === 'string' &&
        TIER_SET.has(parsed.qualifyingAmiTier as AmiTier)
          ? (parsed.qualifyingAmiTier as AmiTier)
          : null,
      qualifyingAmiCalculatedAt:
        typeof parsed.qualifyingAmiCalculatedAt === 'string'
          ? parsed.qualifyingAmiCalculatedAt
          : null,
      qualifyingHouseholdSize:
        typeof parsed.qualifyingHouseholdSize === 'number'
          ? parsed.qualifyingHouseholdSize
          : null,
      intentBedrooms:
        typeof parsed.intentBedrooms === 'number' ? parsed.intentBedrooms : null,
      intentHouseholdSize:
        typeof parsed.intentHouseholdSize === 'number' && parsed.intentHouseholdSize >= 1
          ? parsed.intentHouseholdSize
          : DEFAULTS.intentHouseholdSize,
      outcome:
        parsed.outcome === 'claimed' || parsed.outcome === 'waitlisted' ? parsed.outcome : null,
      propertySlug: typeof parsed.propertySlug === 'string' ? parsed.propertySlug : null,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

function writePersisted(data: WizPersisted) {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(data));
  } catch {
    /* sessionStorage may be unavailable; ignore */
  }
}

export interface ApplyState {
  step: Step;
  setStep: (s: Step) => void;
  error: string | null;
  setError: (e: string | null) => void;
  loading: boolean;
  setLoading: (b: boolean) => void;

  // Identity
  email: string; setEmail: (v: string) => void;
  firstName: string; setFirstName: (v: string) => void;
  lastName: string; setLastName: (v: string) => void;
  phone: string; setPhone: (v: string) => void;

  // Verify
  resending: boolean; setResending: (b: boolean) => void;
  resent: boolean; setResent: (b: boolean) => void;
  devLink: string | null; setDevLink: (v: string | null) => void;

  // Intent
  intentBedrooms: number | null; setIntentBedrooms: (n: number | null) => void;
  intentBudgetMax: number; setIntentBudgetMax: (n: number) => void;
  intentMoveInDate: string; setIntentMoveInDate: (s: string) => void;
  intentHouseholdSize: number; setIntentHouseholdSize: (n: number) => void;

  // W0 — AMI pre-qualifier
  grossAnnualIncome: number | null; setGrossAnnualIncome: (n: number | null) => void;
  qualifyingAmiTier: AmiTier | null; setQualifyingAmiTier: (t: AmiTier | null) => void;
  qualifyingAmiCalculatedAt: string | null; setQualifyingAmiCalculatedAt: (s: string | null) => void;
  qualifyingHouseholdSize: number | null; setQualifyingHouseholdSize: (n: number | null) => void;

  // Pick
  units: Unit[]; setUnits: (u: Unit[]) => void;
  unitsLoading: boolean; setUnitsLoading: (b: boolean) => void;
  claimingUnitId: string | null; setClaimingUnitId: (id: string | null) => void;

  // Claim
  claimedUnit: Unit | null; setClaimedUnit: (u: Unit | null) => void;
  claimExpiresAt: string | null; setClaimExpiresAt: (s: string | null) => void;

  // Step 2
  properties: Array<{ id: string; name: string; city?: string; state?: string }>;
  setProperties: (p: ApplyState['properties']) => void;
  propertiesLoading: boolean; setPropertiesLoading: (b: boolean) => void;
  propertiesFailed: boolean; setPropertiesFailed: (b: boolean) => void;
  propertyId: string; setPropertyId: (v: string) => void;
  unitNumber: string; setUnitNumber: (v: string) => void;
  ssn: string; setSsn: (v: string) => void;
  ssnError: string | null; setSsnError: (v: string | null) => void;
  dateOfBirth: string; setDateOfBirth: (v: string) => void;
  addressLine1: string; setAddressLine1: (v: string) => void;
  city: string; setCity: (v: string) => void;
  state: string; setState: (v: string) => void;
  zip: string; setZip: (v: string) => void;
  employerName: string; setEmployerName: (v: string) => void;
  annualIncome: string; setAnnualIncome: (v: string) => void;
  householdSize: string; setHouseholdSize: (v: string) => void;
  moveInDate: string; setMoveInDate: (v: string) => void;

  done: boolean; setDone: (b: boolean) => void;

  // Wedge #5 — waitlist outcome, persisted so StepConfirm CTA survives a reload.
  outcome: 'claimed' | 'waitlisted' | null; setOutcome: (v: 'claimed' | 'waitlisted' | null) => void;
  propertySlug: string | null; setPropertySlug: (v: string | null) => void;

  // FROZEN CONTRACT 2 — payment wizard
  adults: number; setAdults: (n: number) => void;
  paymentTotal: string; // computed from adults; not settable directly
  paymentRef: string | null; setPaymentRef: (v: string | null) => void;
}

const Ctx = createContext<ApplyState | null>(null);

export function ApplyProvider({ value, children }: { value: ApplyState; children: ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApply(): ApplyState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApply must be used inside ApplyProvider');
  return v;
}

// Hook for callers (Apply.tsx) to build the wiz slice with sessionStorage persistence.
// Returned object: payment fields (adults / paymentTotal / paymentRef) plus W0 fields
// (grossAnnualIncome / qualifyingAmiTier / qualifyingAmiCalculatedAt / qualifyingHouseholdSize).
export function useWizState() {
  const initial = readPersisted();
  const [adults, setAdultsRaw] = useState<number>(initial.adults);
  const [paymentRef, setPaymentRefRaw] = useState<string | null>(initial.paymentRef);
  const [grossAnnualIncome, setGrossAnnualIncomeRaw] = useState<number | null>(
    initial.grossAnnualIncome,
  );
  const [qualifyingAmiTier, setQualifyingAmiTierRaw] = useState<AmiTier | null>(
    initial.qualifyingAmiTier,
  );
  const [qualifyingAmiCalculatedAt, setQualifyingAmiCalculatedAtRaw] = useState<string | null>(
    initial.qualifyingAmiCalculatedAt,
  );
  const [qualifyingHouseholdSize, setQualifyingHouseholdSizeRaw] = useState<number | null>(
    initial.qualifyingHouseholdSize,
  );
  const [intentBedrooms, setIntentBedroomsRaw] = useState<number | null>(initial.intentBedrooms);
  const [intentHouseholdSize, setIntentHouseholdSizeRaw] = useState<number>(
    initial.intentHouseholdSize,
  );
  const [outcome, setOutcomeRaw] = useState<'claimed' | 'waitlisted' | null>(initial.outcome);
  const [propertySlug, setPropertySlugRaw] = useState<string | null>(initial.propertySlug);

  useEffect(() => {
    writePersisted({
      adults,
      paymentRef,
      grossAnnualIncome,
      qualifyingAmiTier,
      qualifyingAmiCalculatedAt,
      qualifyingHouseholdSize,
      intentBedrooms,
      intentHouseholdSize,
      outcome,
      propertySlug,
    });
  }, [
    adults,
    paymentRef,
    grossAnnualIncome,
    qualifyingAmiTier,
    qualifyingAmiCalculatedAt,
    qualifyingHouseholdSize,
    intentBedrooms,
    intentHouseholdSize,
    outcome,
    propertySlug,
  ]);

  return {
    adults,
    setAdults: setAdultsRaw,
    paymentTotal: formatPaymentTotal(adults),
    paymentRef,
    setPaymentRef: setPaymentRefRaw,
    grossAnnualIncome,
    setGrossAnnualIncome: setGrossAnnualIncomeRaw,
    qualifyingAmiTier,
    setQualifyingAmiTier: setQualifyingAmiTierRaw,
    qualifyingAmiCalculatedAt,
    setQualifyingAmiCalculatedAt: setQualifyingAmiCalculatedAtRaw,
    qualifyingHouseholdSize,
    setQualifyingHouseholdSize: setQualifyingHouseholdSizeRaw,
    intentBedrooms,
    setIntentBedrooms: setIntentBedroomsRaw,
    intentHouseholdSize,
    setIntentHouseholdSize: setIntentHouseholdSizeRaw,
    outcome,
    setOutcome: setOutcomeRaw,
    propertySlug,
    setPropertySlug: setPropertySlugRaw,
  };
}
