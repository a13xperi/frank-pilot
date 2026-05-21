/**
 * ApplyContext — Lane W2 LOCAL STUB.
 *
 * NOTE: This file is a temporary stub matching Contract 2 exactly. Lane W1
 * owns the canonical ApplyContext and will replace this. Imports in
 * StepReview / StepHousehold use the canonical path `./ApplyContext` so the
 * swap is a delete-and-replace once W1 lands.
 *
 * Contract 2 fields:
 *   adults: number          — default 1
 *   paymentTotal: string    — computed `$35.95 × (adults+1)`
 *   paymentRef: string|null — default null
 * Persisted to sessionStorage key `frank_apply_state`.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export const APPLY_STATE_KEY = 'frank_apply_state';
export const APPLICATION_FEE = 35.95;

export interface ApplyState {
  adults: number;
  paymentRef: string | null;
  // Optional shape so review screen can render a seed property/unit from
  // upstream lanes. W1 may widen this.
  property?: { id?: string; name?: string; photoUrl?: string; address?: string } | null;
  unit?: { type?: string; bedrooms?: number; sqft?: number; waitlistPosition?: number | null } | null;
  criteria?: { incomeBand?: string; householdSize?: number; moveInDate?: string } | null;
}

export interface ApplyStateWithComputed extends ApplyState {
  /** Computed: $35.95 × (adults + 1). */
  paymentTotal: string;
}

export interface ApplyContextValue {
  state: ApplyStateWithComputed;
  setAdults: (n: number) => void;
  setPaymentRef: (ref: string | null) => void;
  patch: (next: Partial<ApplyState>) => void;
}

const DEFAULT_STATE: ApplyState = { adults: 1, paymentRef: null };

function formatTotal(adults: number): string {
  return `$${(APPLICATION_FEE * (adults + 1)).toFixed(2)}`;
}

function loadState(): ApplyState {
  try {
    const raw = sessionStorage.getItem(APPLY_STATE_KEY);
    if (!raw) return DEFAULT_STATE;
    const parsed = JSON.parse(raw) as Partial<ApplyState>;
    return { ...DEFAULT_STATE, ...parsed };
  } catch {
    return DEFAULT_STATE;
  }
}

function saveState(s: ApplyState): void {
  try {
    sessionStorage.setItem(APPLY_STATE_KEY, JSON.stringify(s));
  } catch {
    /* ignore quota / disabled storage */
  }
}

const ApplyCtx = createContext<ApplyContextValue | null>(null);

export interface ApplyProviderProps {
  children: ReactNode;
  /** Test seed — used to bootstrap state without touching sessionStorage. */
  initialState?: Partial<ApplyState>;
}

export function ApplyProvider({ children, initialState }: ApplyProviderProps) {
  const [state, setState] = useState<ApplyState>(() => ({
    ...loadState(),
    ...(initialState ?? {}),
  }));

  useEffect(() => { saveState(state); }, [state]);

  const setAdults = useCallback((n: number) => {
    setState(prev => ({ ...prev, adults: Math.max(1, Math.min(12, Math.floor(n))) }));
  }, []);

  const setPaymentRef = useCallback((ref: string | null) => {
    setState(prev => ({ ...prev, paymentRef: ref }));
  }, []);

  const patch = useCallback((next: Partial<ApplyState>) => {
    setState(prev => ({ ...prev, ...next }));
  }, []);

  const value = useMemo<ApplyContextValue>(() => ({
    state: { ...state, paymentTotal: formatTotal(state.adults) },
    setAdults,
    setPaymentRef,
    patch,
  }), [state, setAdults, setPaymentRef, patch]);

  return <ApplyCtx.Provider value={value}>{children}</ApplyCtx.Provider>;
}

export function useApply(): ApplyContextValue {
  const ctx = useContext(ApplyCtx);
  if (!ctx) throw new Error('useApply must be used within <ApplyProvider>');
  return ctx;
}
