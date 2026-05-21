import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { render } from '@testing-library/react';
import { vi } from 'vitest';
import { ApplyProvider, type ApplyState, type Step } from '../ApplyContext';

// Build a stubbed ApplyState for unit smoke tests. Each step receives only
// what it needs; setters are spies so transitions are observable.
export function makeState(overrides: Partial<ApplyState> = {}): ApplyState {
  let step: Step = overrides.step ?? 1;
  const setStep = vi.fn((s: Step) => {
    step = s;
  });

  const noop = vi.fn();
  const base: ApplyState = {
    step,
    setStep: (s) => {
      setStep(s);
      // also reflect in returned object for assertions on .step
      (base as ApplyState).step = s;
    },
    error: null, setError: noop, loading: false, setLoading: noop,
    email: '', setEmail: noop, firstName: '', setFirstName: noop,
    lastName: '', setLastName: noop, phone: '', setPhone: noop,
    resending: false, setResending: noop, resent: false, setResent: noop,
    devLink: null, setDevLink: noop,
    intentBedrooms: null, setIntentBedrooms: noop,
    intentBudgetMax: 2000, setIntentBudgetMax: noop,
    intentMoveInDate: '', setIntentMoveInDate: noop,
    intentHouseholdSize: 1, setIntentHouseholdSize: noop,
    units: [], setUnits: noop, unitsLoading: false, setUnitsLoading: noop,
    claimingUnitId: null, setClaimingUnitId: noop,
    claimedUnit: null, setClaimedUnit: noop,
    claimExpiresAt: null, setClaimExpiresAt: noop,
    properties: [], setProperties: noop,
    propertiesLoading: false, setPropertiesLoading: noop,
    propertiesFailed: false, setPropertiesFailed: noop,
    propertyId: '', setPropertyId: noop, unitNumber: '', setUnitNumber: noop,
    ssn: '', setSsn: noop, ssnError: null, setSsnError: noop,
    dateOfBirth: '', setDateOfBirth: noop, addressLine1: '', setAddressLine1: noop,
    city: '', setCity: noop, state: '', setState: noop, zip: '', setZip: noop,
    employerName: '', setEmployerName: noop, annualIncome: '', setAnnualIncome: noop,
    householdSize: '1', setHouseholdSize: noop, moveInDate: '', setMoveInDate: noop,
    done: false, setDone: noop,
    ...overrides,
  };
  return base;
}

export function renderWithApply(
  ui: ReactNode,
  opts: { state?: ApplyState; route?: string } = {}
) {
  const state = opts.state ?? makeState();
  return {
    state,
    ...render(
      <MemoryRouter initialEntries={[opts.route ?? '/apply']}>
        <ApplyProvider value={state}>{ui}</ApplyProvider>
      </MemoryRouter>
    ),
  };
}

// Mock fetch with a simple route → response map. Returns the mock for spying.
export function mockFetch(routes: Record<string, unknown>) {
  const fn = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    for (const [pattern, body] of Object.entries(routes)) {
      if (url.includes(pattern)) {
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }
    return new Response(JSON.stringify({ error: `unmocked ${url}` }), { status: 404 });
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}
