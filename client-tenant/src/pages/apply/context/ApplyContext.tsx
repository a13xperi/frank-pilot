/**
 * ApplyContext — STUB per Contract 2 (W1/W2 will replace with canonical).
 *
 * Shape:
 *  - adults: number (default 1, counted as total adults living here)
 *  - paymentTotal: string — computed as $35.95 × adults
 *  - paymentRef: string | null (default null)
 *
 * Persistence: sessionStorage key `frank_apply_state`.
 *
 * When Lane W1 lands, replace this file with the canonical context — the
 * shape is frozen by Contract 2 so consumers should not change.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

const STORAGE_KEY = 'frank_apply_state';
const FEE = 35.95;

export interface ApplyState {
  adults: number;
  paymentTotal: string;
  paymentRef: string | null;
}

interface ApplyContextValue {
  state: ApplyState;
  setPaymentRef: (ref: string) => void;
  setAdults: (adults: number) => void;
}

function computeTotal(adults: number): string {
  const total = FEE * adults;
  return total.toFixed(2);
}

function load(): ApplyState {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<ApplyState>;
      const adults = typeof parsed.adults === 'number' ? parsed.adults : 1;
      return {
        adults,
        paymentTotal: parsed.paymentTotal ?? computeTotal(adults),
        paymentRef: parsed.paymentRef ?? null,
      };
    }
  } catch {
    // ignore — fall through to default
  }
  return { adults: 1, paymentTotal: computeTotal(1), paymentRef: null };
}

const ApplyCtx = createContext<ApplyContextValue | null>(null);

export function ApplyProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ApplyState>(() => load());

  useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // session storage may be unavailable in some test envs
    }
  }, [state]);

  const setPaymentRef = useCallback((ref: string) => {
    setState((s) => ({ ...s, paymentRef: ref }));
  }, []);

  const setAdults = useCallback((adults: number) => {
    setState((s) => ({ ...s, adults, paymentTotal: computeTotal(adults) }));
  }, []);

  const value = useMemo(
    () => ({ state, setPaymentRef, setAdults }),
    [state, setPaymentRef, setAdults],
  );

  return <ApplyCtx.Provider value={value}>{children}</ApplyCtx.Provider>;
}

export function useApply(): ApplyContextValue {
  const v = useContext(ApplyCtx);
  if (!v) {
    // Allow standalone usage in tests — synthesize a minimal default.
    const adults = 1;
    return {
      state: { adults, paymentTotal: computeTotal(adults), paymentRef: null },
      setPaymentRef: () => {},
      setAdults: () => {},
    };
  }
  return v;
}
