import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Unit } from '@/api/units';

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

export function formatPaymentTotal(adults: number): string {
  return (35.95 * (adults + 1)).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
  });
}

interface WizPersisted {
  adults: number;
  paymentRef: string | null;
}

function readPersisted(): WizPersisted {
  if (typeof window === 'undefined') return { adults: 1, paymentRef: null };
  try {
    const raw = window.sessionStorage.getItem(SESSION_KEY);
    if (!raw) return { adults: 1, paymentRef: null };
    const parsed = JSON.parse(raw) as Partial<WizPersisted>;
    return {
      adults: typeof parsed.adults === 'number' ? parsed.adults : 1,
      paymentRef: typeof parsed.paymentRef === 'string' ? parsed.paymentRef : null,
    };
  } catch {
    return { adults: 1, paymentRef: null };
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
// Returned object: { adults, setAdults, paymentTotal, paymentRef, setPaymentRef }.
export function useWizState() {
  const initial = readPersisted();
  const [adults, setAdultsRaw] = useState<number>(initial.adults);
  const [paymentRef, setPaymentRefRaw] = useState<string | null>(initial.paymentRef);

  useEffect(() => {
    writePersisted({ adults, paymentRef });
  }, [adults, paymentRef]);

  return {
    adults,
    setAdults: setAdultsRaw,
    paymentTotal: formatPaymentTotal(adults),
    paymentRef,
    setPaymentRef: setPaymentRefRaw,
  };
}
