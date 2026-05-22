// @vitest-environment jsdom
//
// Regression net for PR #40 — the welcome→apply handoff persists
// intentBedrooms + intentHouseholdSize in sessionStorage so they survive
// the Apply unmount that happens during /auth/callback. Without this,
// Step 3 lost its prefill after magic-link verify.
//
// FROZEN CONTRACT 2 — sessionStorage key `frank_apply_state`, shape defined
// by WizPersisted in ApplyContext.tsx.

import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useWizState } from '../ApplyContext';

const SESSION_KEY = 'frank_apply_state';

describe('useWizState — intentBedrooms', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it('defaults to null when sessionStorage is empty', () => {
    const { result } = renderHook(() => useWizState());
    expect(result.current.intentBedrooms).toBeNull();
  });

  it('hydrates from sessionStorage on mount', () => {
    window.sessionStorage.setItem(
      SESSION_KEY,
      JSON.stringify({ intentBedrooms: 2 }),
    );
    const { result } = renderHook(() => useWizState());
    expect(result.current.intentBedrooms).toBe(2);
  });

  it('ignores non-number values stored under intentBedrooms', () => {
    window.sessionStorage.setItem(
      SESSION_KEY,
      JSON.stringify({ intentBedrooms: 'two' }),
    );
    const { result } = renderHook(() => useWizState());
    expect(result.current.intentBedrooms).toBeNull();
  });

  it('persists setter changes back to sessionStorage', () => {
    const { result } = renderHook(() => useWizState());
    act(() => {
      result.current.setIntentBedrooms(3);
    });
    const stored = JSON.parse(
      window.sessionStorage.getItem(SESSION_KEY) ?? '{}',
    );
    expect(stored.intentBedrooms).toBe(3);
  });
});

describe('useWizState — intentHouseholdSize', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it('defaults to 1 when sessionStorage is empty', () => {
    const { result } = renderHook(() => useWizState());
    expect(result.current.intentHouseholdSize).toBe(1);
  });

  it('hydrates from sessionStorage on mount', () => {
    window.sessionStorage.setItem(
      SESSION_KEY,
      JSON.stringify({ intentHouseholdSize: 4 }),
    );
    const { result } = renderHook(() => useWizState());
    expect(result.current.intentHouseholdSize).toBe(4);
  });

  it('coerces values < 1 to the default (guards against 0/negative leaks)', () => {
    window.sessionStorage.setItem(
      SESSION_KEY,
      JSON.stringify({ intentHouseholdSize: 0 }),
    );
    const { result } = renderHook(() => useWizState());
    expect(result.current.intentHouseholdSize).toBe(1);
  });

  it('persists setter changes back to sessionStorage', () => {
    const { result } = renderHook(() => useWizState());
    act(() => {
      result.current.setIntentHouseholdSize(5);
    });
    const stored = JSON.parse(
      window.sessionStorage.getItem(SESSION_KEY) ?? '{}',
    );
    expect(stored.intentHouseholdSize).toBe(5);
  });
});

describe('useWizState — round-trip across unmount/remount (the /auth/callback hop)', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it('values set on mount A are visible on mount B (the actual PR #40 fix)', () => {
    const a = renderHook(() => useWizState());
    act(() => {
      a.result.current.setIntentBedrooms(2);
      a.result.current.setIntentHouseholdSize(3);
    });
    a.unmount();

    const b = renderHook(() => useWizState());
    expect(b.result.current.intentBedrooms).toBe(2);
    expect(b.result.current.intentHouseholdSize).toBe(3);
  });

  it('does not clobber other persisted fields when updating intent fields', () => {
    // Simulate a prior session that already wrote payment-wizard fields.
    window.sessionStorage.setItem(
      SESSION_KEY,
      JSON.stringify({
        adults: 2,
        paymentRef: 'pay_pre_existing',
        intentBedrooms: 1,
        intentHouseholdSize: 1,
      }),
    );

    const { result } = renderHook(() => useWizState());
    act(() => {
      result.current.setIntentBedrooms(3);
    });

    const stored = JSON.parse(
      window.sessionStorage.getItem(SESSION_KEY) ?? '{}',
    );
    expect(stored.intentBedrooms).toBe(3);
    expect(stored.adults).toBe(2);
    expect(stored.paymentRef).toBe('pay_pre_existing');
  });
});
