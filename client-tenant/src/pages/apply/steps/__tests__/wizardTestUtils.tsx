import { useState, type ReactNode } from 'react';
import { ApplyProvider, formatPaymentTotal, type ApplyState, type Step } from '../../ApplyContext';
import type { Unit } from '@/api/units';

export interface WizardSeed {
  step?: Step;
  claimedUnit?: Partial<Unit> | null;
  intentBedrooms?: number | null;
  intentMoveInDate?: string;
  intentHouseholdSize?: number;
  adults?: number;
  paymentRef?: string | null;
}

function buildUnit(overrides?: Partial<Unit> | null): Unit | null {
  if (overrides === null) return null;
  return {
    id: overrides?.id ?? 'u1',
    property_id: overrides?.property_id ?? 'p1',
    unit_number: overrides?.unit_number ?? '101',
    bedrooms: overrides?.bedrooms ?? 2,
    bathrooms: overrides?.bathrooms ?? 1,
    sqft: overrides?.sqft ?? 820,
    monthly_rent: overrides?.monthly_rent ?? 1800,
    photo_url: overrides?.photo_url ?? null,
    available_from: overrides?.available_from ?? null,
    property_name: overrides?.property_name ?? 'Donna Louise 2',
    property_city: overrides?.property_city ?? null,
    property_state: overrides?.property_state ?? null,
  };
}

export function WizardTestProvider({ seed = {}, children }: { seed?: WizardSeed; children: ReactNode }) {
  const [step, setStep] = useState<Step>(seed.step ?? 'review');
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
  const [intentBedrooms, setIntentBedrooms] = useState<number | null>(seed.intentBedrooms ?? 2);
  const [intentBudgetMax, setIntentBudgetMax] = useState(2000);
  const [intentMoveInDate, setIntentMoveInDate] = useState(seed.intentMoveInDate ?? '2026-08-01');
  const [intentHouseholdSize, setIntentHouseholdSize] = useState(seed.intentHouseholdSize ?? 2);
  const [units, setUnits] = useState<Unit[]>([]);
  const [unitsLoading, setUnitsLoading] = useState(false);
  const [claimingUnitId, setClaimingUnitId] = useState<string | null>(null);
  const [claimedUnit, setClaimedUnit] = useState<Unit | null>(buildUnit(seed.claimedUnit));
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
  const [stateField, setStateField] = useState('');
  const [zip, setZip] = useState('');
  const [employerName, setEmployerName] = useState('');
  const [annualIncome, setAnnualIncome] = useState('');
  const [householdSize, setHouseholdSize] = useState('1');
  const [moveInDate, setMoveInDate] = useState('');
  const [adults, setAdults] = useState<number>(seed.adults ?? 1);
  const [paymentRef, setPaymentRef] = useState<string | null>(seed.paymentRef ?? null);

  const value: ApplyState = {
    step, setStep, error, setError, loading, setLoading,
    email, setEmail, firstName, setFirstName, lastName, setLastName, phone, setPhone,
    resending, setResending, resent, setResent, devLink, setDevLink,
    intentBedrooms, setIntentBedrooms, intentBudgetMax, setIntentBudgetMax,
    intentMoveInDate, setIntentMoveInDate, intentHouseholdSize, setIntentHouseholdSize,
    units, setUnits, unitsLoading, setUnitsLoading, claimingUnitId, setClaimingUnitId,
    claimedUnit, setClaimedUnit, claimExpiresAt, setClaimExpiresAt,
    properties, setProperties, propertiesLoading, setPropertiesLoading, propertiesFailed, setPropertiesFailed,
    propertyId, setPropertyId, unitNumber, setUnitNumber, ssn, setSsn, ssnError, setSsnError,
    dateOfBirth, setDateOfBirth, addressLine1, setAddressLine1, city, setCity,
    state: stateField, setState: setStateField, zip, setZip,
    employerName, setEmployerName, annualIncome, setAnnualIncome, householdSize, setHouseholdSize, moveInDate, setMoveInDate,
    done, setDone,
    adults, setAdults,
    paymentTotal: formatPaymentTotal(adults),
    paymentRef, setPaymentRef,
  };

  return <ApplyProvider value={value}>{children}</ApplyProvider>;
}
