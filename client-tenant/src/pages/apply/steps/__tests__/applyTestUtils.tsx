/**
 * Test-only provider for the apply wizard steps.
 *
 * StepPayment / StepConfirm consume the CANONICAL context
 * (`@/pages/apply/ApplyContext`), whose `ApplyProvider` requires a full
 * `ApplyState` value. Tests only exercise the payment fields, so this helper
 * synthesizes a minimal-but-typed value (paymentTotal derived from `adults`)
 * and lets callers override the few fields they assert on.
 */
import type { ReactNode } from 'react';
import {
  ApplyProvider,
  formatPaymentTotal,
  type ApplyState,
} from '@/pages/apply/ApplyContext';

export interface TestApplyOverrides {
  adults?: number;
  paymentRef?: string | null;
}

export function TestApplyProvider({
  children,
  adults = 1,
  paymentRef = null,
}: { children: ReactNode } & TestApplyOverrides) {
  // Only the payment-wizard fields are read by the steps under test; the rest
  // of ApplyState is irrelevant here, so cast a partial value.
  const value = {
    adults,
    setAdults: () => {},
    paymentTotal: formatPaymentTotal(adults),
    paymentRef,
    setPaymentRef: () => {},
  } as unknown as ApplyState;

  return <ApplyProvider value={value}>{children}</ApplyProvider>;
}
