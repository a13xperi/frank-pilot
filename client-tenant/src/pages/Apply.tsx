import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { api } from '@/api/client';
import { requestMagicLink } from '@/api/auth';
import { saveIntent, fetchUnits, claimUnit, type Unit } from '@/api/units';
import { UnitCard } from '@/components/UnitCard';
import { ClaimedUnitHeader } from '@/components/ClaimedUnitHeader';
import { CheckCircle, Mail, Loader2 } from 'lucide-react';

interface Property {
  id: string;
  name: string;
  address_line1?: string;
  city?: string;
  state?: string;
}

// Step 1: register → 'verify': check email → 'intent': quiz → 'pick': units grid
// → 'claim': confirmation modal → 2: details form. Each step is a stable URL
// param so deep links and back-button work.
type Step = 1 | 'verify' | 'intent' | 'pick' | 'claim' | 2;

function parseStep(raw: string | null): Step {
  if (raw === '2') return 2;
  if (raw === 'verify' || raw === 'intent' || raw === 'pick' || raw === 'claim') return raw;
  return 1;
}

const BEDROOM_OPTIONS: Array<{ value: number; label: string }> = [
  { value: 0, label: 'Studio' },
  { value: 1, label: '1 BR' },
  { value: 2, label: '2 BR' },
  { value: 3, label: '3 BR' },
  { value: 4, label: '4+ BR' },
];

export function Apply() {
  const navigate = useNavigate();
  const [search, setSearch] = useSearchParams();
  const [step, setStepState] = useState<Step>(parseStep(search.get('step')));
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  // Keep ?step= in sync with state so reloads land on the same step.
  function setStep(next: Step) {
    setStepState(next);
    const value = next === 1 ? null : String(next);
    setSearch(value ? { step: value } : {}, { replace: true });
  }

  // Step 1 fields
  const [email, setEmail] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');

  // Verify
  const [resending, setResending] = useState(false);
  const [resent, setResent] = useState(false);
  const [devLink, setDevLink] = useState<string | null>(null);

  // Intent quiz
  const [intentBedrooms, setIntentBedrooms] = useState<number | null>(null);
  const [intentBudgetMax, setIntentBudgetMax] = useState<number>(2000);
  const [intentMoveInDate, setIntentMoveInDate] = useState('');
  const [intentHouseholdSize, setIntentHouseholdSize] = useState<number>(1);

  // Pick
  const [units, setUnits] = useState<Unit[]>([]);
  const [unitsLoading, setUnitsLoading] = useState(false);
  const [claimingUnitId, setClaimingUnitId] = useState<string | null>(null);

  // Claim
  const [claimedUnit, setClaimedUnit] = useState<Unit | null>(null);
  const [claimExpiresAt, setClaimExpiresAt] = useState<string | null>(null);

  // Properties for dropdown (step 2 fallback)
  const [properties, setProperties] = useState<Property[]>([]);
  const [propertiesLoading, setPropertiesLoading] = useState(false);
  const [propertiesFailed, setPropertiesFailed] = useState(false);

  // Step 2 fields
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

  // Verify-stage poll: advance when /auth/me reports emailVerified=true.
  useEffect(() => {
    if (step !== 'verify') return;
    let cancelled = false;
    async function check() {
      try {
        const res = await api.get<{ user?: { email: string; emailVerified: boolean } }>('/auth/me');
        if (cancelled) return;
        if (res.user?.emailVerified) setStep('intent');
      } catch {
        /* ignored — 401 redirect handled by client.ts */
      }
    }
    check();
    const interval = setInterval(check, 5000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [step]);

  // Hydrate identity + intent prefill on entering 'intent'/'pick'/2 (deep links).
  useEffect(() => {
    if (step !== 'intent' && step !== 'pick' && step !== 2) return;
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
          id: string;
          property_id?: string;
          unit_number?: string;
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
    return () => {
      cancelled = true;
    };
  }, [step, email, firstName, lastName, propertyId, unitNumber, intentBedrooms]);

  // On entering 'pick': fetch units matching the intent. Bounce back to
  // 'intent' if the quiz hasn't been answered.
  useEffect(() => {
    if (step !== 'pick') return;
    if (intentBedrooms === null || !intentMoveInDate) {
      setStep('intent');
      return;
    }
    let cancelled = false;
    (async () => {
      setUnitsLoading(true);
      setError(null);
      try {
        const res = await fetchUnits({
          bedrooms: intentBedrooms,
          maxRent: intentBudgetMax,
          moveInBy: intentMoveInDate,
        });
        if (!cancelled) setUnits(res.units);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load units');
      } finally {
        if (!cancelled) setUnitsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [step, intentBedrooms, intentBudgetMax, intentMoveInDate]);

  // Step 2 fallback: load properties if there's no claimed unit (rare path).
  useEffect(() => {
    if (step !== 2 || claimedUnit || properties.length > 0 || propertiesLoading) return;
    let cancelled = false;
    (async () => {
      setPropertiesLoading(true);
      try {
        const data = await api.get<{ properties: Property[] } | Property[]>('/applicants/properties');
        if (cancelled) return;
        const list = Array.isArray(data) ? data : (data as { properties: Property[] }).properties ?? [];
        setProperties(list);
      } catch {
        if (!cancelled) setPropertiesFailed(true);
      } finally {
        if (!cancelled) setPropertiesLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [step, claimedUnit, properties.length, propertiesLoading]);

  async function handleStep1(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await api.post<{ ok: boolean; devLink?: string }>('/applicants/register', {
        email,
        firstName,
        lastName,
        phone: phone || undefined,
      });
      if (res.devLink) setDevLink(res.devLink);
      setStep('verify');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed');
    } finally {
      setLoading(false);
    }
  }

  async function handleIntent(e: React.FormEvent) {
    e.preventDefault();
    if (intentBedrooms === null || !intentMoveInDate) return;
    setError(null);
    setLoading(true);
    try {
      await saveIntent({
        bedrooms: intentBedrooms,
        budget_max: intentBudgetMax,
        move_in_date: intentMoveInDate,
        household_size: intentHouseholdSize,
      });
      setHouseholdSize(String(intentHouseholdSize));
      setMoveInDate(intentMoveInDate);
      setStep('pick');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save your preferences');
    } finally {
      setLoading(false);
    }
  }

  async function handleClaim(unitId: string) {
    setClaimingUnitId(unitId);
    setError(null);
    try {
      const res = await claimUnit(unitId);
      setClaimedUnit(res.unit);
      setClaimExpiresAt(res.expires_at);
      // Snap details-form fields to the chosen unit so the user can't desync them.
      setPropertyId(res.unit.property_id);
      setUnitNumber(res.unit.unit_number);
      setStep('claim');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not claim this unit');
    } finally {
      setClaimingUnitId(null);
    }
  }

  function validateSsn(value: string) {
    const clean = value.replace(/-/g, '');
    if (clean.length === 0) { setSsnError(null); return; }
    const valid = /^\d{3}-?\d{2}-?\d{4}$/.test(value) || /^\d{9}$/.test(clean);
    setSsnError(valid ? null : 'SSN must be XXX-XX-XXXX or 9 digits');
  }

  async function handleStep2(e: React.FormEvent) {
    e.preventDefault();
    if (ssnError) return;
    setError(null);
    setLoading(true);
    try {
      await api.post('/applicants/apply', {
        propertyId: propertyId || undefined,
        unitNumber: unitNumber || undefined,
        firstName,
        lastName,
        ssn,
        dateOfBirth,
        email,
        phone: phone || undefined,
        currentAddressLine1: addressLine1 || undefined,
        currentCity: city || undefined,
        currentState: state || undefined,
        currentZip: zip || undefined,
        employerName: employerName || undefined,
        annualIncome: annualIncome ? Number(annualIncome) : undefined,
        householdSize: Number(householdSize),
        requestedMoveInDate: moveInDate || undefined,
        requestedLeaseTermMonths: 12,
      });
      setDone(true);
      setTimeout(() => navigate('/status'), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Application failed');
    } finally {
      setLoading(false);
    }
  }

  async function handleResend() {
    if (!email) return;
    setResending(true);
    setError(null);
    try {
      await requestMagicLink(email);
      setResent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not resend link');
    } finally {
      setResending(false);
    }
  }

  if (done) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 p-4">
        <div className="flex flex-col items-center gap-4 text-center">
          <CheckCircle className="h-12 w-12 text-emerald-600" />
          <h2 className="text-xl font-bold text-gray-900">Application submitted!</h2>
          <p className="text-sm text-gray-500">Redirecting to your application status…</p>
        </div>
      </div>
    );
  }

  // 3-phase progress: Account → Pick → Apply.
  const phase: 1 | 2 | 3 =
    step === 1 || step === 'verify' ? 1 :
    step === 'intent' || step === 'pick' || step === 'claim' ? 2 : 3;
  const phaseLabels: Array<{ n: 1 | 2 | 3; label: string }> = [
    { n: 1, label: 'Account' },
    { n: 2, label: 'Pick a unit' },
    { n: 3, label: 'Apply' },
  ];

  // Wider container on the unit picker so the grid can breathe.
  const containerWidth = step === 'pick' ? 'max-w-3xl' : 'max-w-md';

  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <div className={`mx-auto ${containerWidth} space-y-6 py-8`}>
        {step === 2 && claimedUnit && claimExpiresAt && (
          <ClaimedUnitHeader unit={claimedUnit} expiresAt={claimExpiresAt} />
        )}

        {/* Progress */}
        <div className="flex items-center gap-2">
          {phaseLabels.map(({ n, label }) => (
            <div key={n} className="flex items-center gap-2">
              <div className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold
                ${phase === n ? 'bg-emerald-600 text-white' : phase > n ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-200 text-gray-500'}`}>
                {n}
              </div>
              <span className={`text-xs ${phase === n ? 'font-medium text-gray-900' : 'text-gray-400'}`}>
                {label}
              </span>
              {n < 3 && <div className="mx-1 h-px w-8 bg-gray-300" />}
            </div>
          ))}
        </div>

        <div className="rounded-xl bg-white p-6 shadow-sm">
          {error && (
            <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>
          )}

          {step === 1 && (
            <>
              <h1 className="mb-4 text-xl font-bold text-gray-900">Create your account</h1>
              <form onSubmit={handleStep1} className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="label" htmlFor="firstName">First name *</label>
                    <input id="firstName" className="input" required value={firstName} onChange={e => setFirstName(e.target.value)} />
                  </div>
                  <div>
                    <label className="label" htmlFor="lastName">Last name *</label>
                    <input id="lastName" className="input" required value={lastName} onChange={e => setLastName(e.target.value)} />
                  </div>
                </div>
                <div>
                  <label className="label" htmlFor="regEmail">Email *</label>
                  <input id="regEmail" type="email" className="input" required value={email} onChange={e => setEmail(e.target.value)} />
                </div>
                <div>
                  <label className="label" htmlFor="phone">Phone</label>
                  <input id="phone" type="tel" className="input" value={phone} onChange={e => setPhone(e.target.value)} placeholder="Optional" />
                </div>
                <button type="submit" disabled={loading || !email || !firstName || !lastName} className="btn-primary w-full">
                  {loading ? 'Creating account…' : 'Continue'}
                </button>
              </form>
            </>
          )}

          {step === 'verify' && (
            <div className="space-y-4 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-100">
                <Mail className="h-6 w-6 text-emerald-700" />
              </div>
              <h1 className="text-xl font-bold text-gray-900">Check your email</h1>
              <p className="text-sm text-gray-500">
                We sent a verification link to{' '}
                <span className="font-medium text-gray-900">{email}</span>. Click
                it to continue your application. This page will advance
                automatically.
              </p>
              {resent && (
                <div className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">
                  Link resent
                </div>
              )}
              <button
                onClick={handleResend}
                disabled={resending || !email}
                className="btn-primary w-full"
              >
                {resending ? 'Resending…' : 'Resend link'}
              </button>
              {devLink && (
                <a
                  href={devLink}
                  className="block rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-center text-sm font-medium text-amber-800 hover:bg-amber-100"
                >
                  [Dev] Open magic link
                </a>
              )}
              <button
                onClick={() => setStep(1)}
                className="text-sm text-gray-500 hover:text-gray-700 hover:underline"
              >
                Use a different email
              </button>
            </div>
          )}

          {step === 'intent' && (
            <>
              <h1 className="mb-1 text-xl font-bold text-gray-900">What are you looking for?</h1>
              <p className="mb-4 text-sm text-gray-500">A few quick questions so we can show you the right units.</p>
              <form onSubmit={handleIntent} className="space-y-5">
                <div>
                  <label className="label">Bedrooms *</label>
                  <div className="grid grid-cols-5 gap-2">
                    {BEDROOM_OPTIONS.map(opt => (
                      <button
                        type="button"
                        key={opt.value}
                        onClick={() => setIntentBedrooms(opt.value)}
                        className={`rounded-lg border px-2 py-3 text-sm font-medium transition
                          ${intentBedrooms === opt.value
                            ? 'border-emerald-600 bg-emerald-50 text-emerald-700'
                            : 'border-gray-300 bg-white text-gray-700 hover:border-emerald-400'}`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="label" htmlFor="budget">
                    Monthly budget: <span className="font-semibold text-gray-900">${intentBudgetMax.toLocaleString()}</span>
                  </label>
                  <input
                    id="budget"
                    type="range"
                    min={500}
                    max={5000}
                    step={50}
                    value={intentBudgetMax}
                    onChange={e => setIntentBudgetMax(Number(e.target.value))}
                    className="w-full accent-emerald-600"
                  />
                  <div className="mt-1 flex justify-between text-xs text-gray-400">
                    <span>$500</span>
                    <span>$5,000</span>
                  </div>
                </div>

                <div>
                  <label className="label" htmlFor="intentMoveIn">Target move-in *</label>
                  <input
                    id="intentMoveIn"
                    type="date"
                    className="input"
                    required
                    value={intentMoveInDate}
                    onChange={e => setIntentMoveInDate(e.target.value)}
                  />
                </div>

                <div>
                  <label className="label" htmlFor="intentHousehold">Household size</label>
                  <select
                    id="intentHousehold"
                    className="input"
                    value={intentHouseholdSize}
                    onChange={e => setIntentHouseholdSize(Number(e.target.value))}
                  >
                    {Array.from({ length: 8 }, (_, i) => i + 1).map(n => (
                      <option key={n} value={n}>{n}</option>
                    ))}
                  </select>
                </div>

                <button
                  type="submit"
                  disabled={loading || intentBedrooms === null || !intentMoveInDate}
                  className="btn-primary w-full"
                >
                  {loading ? 'Saving…' : 'Show me units'}
                </button>
              </form>
            </>
          )}

          {step === 'pick' && (
            <>
              <h1 className="mb-1 text-xl font-bold text-gray-900">Pick your unit</h1>
              <p className="mb-4 text-sm text-gray-500">
                Claiming a unit holds it for you for 48 hours while you finish your application.
              </p>
              {unitsLoading ? (
                <div className="flex items-center justify-center py-12 text-gray-400">
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                  Loading units…
                </div>
              ) : units.length === 0 ? (
                <div className="rounded-lg bg-amber-50 p-4 text-sm text-amber-800">
                  No units match your preferences right now.{' '}
                  <button onClick={() => setStep('intent')} className="font-medium underline">
                    Adjust your search
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {units.map(u => (
                    <UnitCard
                      key={u.id}
                      unit={u}
                      onClaim={handleClaim}
                      claiming={claimingUnitId === u.id}
                    />
                  ))}
                </div>
              )}
              <button
                onClick={() => setStep('intent')}
                className="mt-6 text-sm text-gray-500 hover:text-gray-700 hover:underline"
              >
                ← Edit preferences
              </button>
            </>
          )}

          {step === 'claim' && claimedUnit && claimExpiresAt && (
            <div className="space-y-4 text-center">
              <div className="overflow-hidden rounded-xl">
                <img
                  src={claimedUnit.photo_url || `https://picsum.photos/seed/${claimedUnit.id.slice(0, 8)}/800/600`}
                  alt=""
                  className="aspect-[16/9] w-full object-cover"
                />
              </div>
              <div>
                <h1 className="text-xl font-bold text-gray-900">
                  Unit {claimedUnit.unit_number} is yours
                </h1>
                <p className="mt-1 text-sm text-gray-500">
                  {claimedUnit.property_name}
                  {claimedUnit.property_city && `, ${claimedUnit.property_city}`}
                </p>
              </div>
              <ClaimCountdown expiresAt={claimExpiresAt} />
              <button onClick={() => setStep(2)} className="btn-primary w-full">
                Continue your application
              </button>
              <button
                onClick={() => setStep('pick')}
                className="text-sm text-gray-500 hover:text-gray-700 hover:underline"
              >
                Pick a different unit
              </button>
            </div>
          )}

          {step === 'claim' && (!claimedUnit || !claimExpiresAt) && (
            <div className="space-y-4 text-center">
              <p className="text-sm text-gray-500">No active claim — let's pick a unit.</p>
              <button onClick={() => setStep('intent')} className="btn-primary w-full">
                Start over
              </button>
            </div>
          )}

          {step === 2 && (
            <>
              <h1 className="mb-4 text-xl font-bold text-gray-900">Application details</h1>
              <form onSubmit={handleStep2} className="space-y-4">
                {!claimedUnit && (
                  <>
                    <div>
                      <label className="label" htmlFor="propertyId">Property *</label>
                      {propertiesLoading ? (
                        <p className="text-sm text-gray-400">Loading properties…</p>
                      ) : propertiesFailed || properties.length === 0 ? (
                        <input
                          id="propertyId"
                          className="input"
                          required
                          placeholder="Property ID (UUID)"
                          value={propertyId}
                          onChange={e => setPropertyId(e.target.value)}
                        />
                      ) : (
                        <select
                          id="propertyId"
                          className="input"
                          required
                          value={propertyId}
                          onChange={e => setPropertyId(e.target.value)}
                        >
                          <option value="">Select a property…</option>
                          {properties.map(p => (
                            <option key={p.id} value={p.id}>
                              {p.name}{p.city && p.state ? ` — ${p.city}, ${p.state}` : ''}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                    <div>
                      <label className="label" htmlFor="unitNumber">Unit number</label>
                      <input id="unitNumber" className="input" value={unitNumber} onChange={e => setUnitNumber(e.target.value)} placeholder="Optional" />
                    </div>
                  </>
                )}
                <div>
                  <label className="label" htmlFor="ssn">Social Security Number *</label>
                  <input
                    id="ssn"
                    className="input"
                    required
                    placeholder="XXX-XX-XXXX"
                    value={ssn}
                    onChange={e => setSsn(e.target.value)}
                    onBlur={() => validateSsn(ssn)}
                  />
                  {ssnError && <p className="mt-1 text-xs text-red-600">{ssnError}</p>}
                </div>
                <div>
                  <label className="label" htmlFor="dob">Date of birth *</label>
                  <input id="dob" type="date" className="input" required value={dateOfBirth} onChange={e => setDateOfBirth(e.target.value)} />
                </div>
                <div>
                  <label className="label" htmlFor="address">Street address</label>
                  <input id="address" className="input" value={addressLine1} onChange={e => setAddressLine1(e.target.value)} />
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div className="col-span-1">
                    <label className="label" htmlFor="city">City</label>
                    <input id="city" className="input" value={city} onChange={e => setCity(e.target.value)} />
                  </div>
                  <div>
                    <label className="label" htmlFor="state">State</label>
                    <input id="state" className="input" maxLength={2} placeholder="NV" value={state} onChange={e => setState(e.target.value.toUpperCase())} />
                  </div>
                  <div>
                    <label className="label" htmlFor="zip">ZIP</label>
                    <input id="zip" className="input" maxLength={10} value={zip} onChange={e => setZip(e.target.value)} />
                  </div>
                </div>
                <div>
                  <label className="label" htmlFor="employer">Employer name</label>
                  <input id="employer" className="input" value={employerName} onChange={e => setEmployerName(e.target.value)} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="label" htmlFor="income">Annual income ($)</label>
                    <input id="income" type="number" min={0} className="input" value={annualIncome} onChange={e => setAnnualIncome(e.target.value)} />
                  </div>
                  <div>
                    <label className="label" htmlFor="household">Household size *</label>
                    <select id="household" className="input" required value={householdSize} onChange={e => setHouseholdSize(e.target.value)}>
                      {Array.from({ length: 8 }, (_, i) => i + 1).map(n => (
                        <option key={n} value={n}>{n}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="label" htmlFor="moveIn">Requested move-in date</label>
                  <input id="moveIn" type="date" className="input" value={moveInDate} onChange={e => setMoveInDate(e.target.value)} />
                </div>
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => setStep(claimedUnit ? 'claim' : 1)}
                    className="flex-1 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                  >
                    Back
                  </button>
                  <button
                    type="submit"
                    disabled={loading || !ssn || !!ssnError || !dateOfBirth || (!claimedUnit && !propertyId && !propertiesFailed)}
                    className="btn-primary flex-1"
                  >
                    {loading ? 'Submitting…' : 'Submit application'}
                  </button>
                </div>
              </form>
            </>
          )}
        </div>

        <p className="text-center text-sm text-gray-500">
          Already have an account?{' '}
          <Link to="/login" className="font-medium text-emerald-600 hover:underline">Sign in</Link>
        </p>
      </div>
    </div>
  );
}

// Inline countdown for the claim-confirmation card. ClaimedUnitHeader has its
// own copy for the sticky header context — this one is centered and large.
function ClaimCountdown({ expiresAt }: { expiresAt: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);
  const remaining = new Date(expiresAt).getTime() - now;
  const total = Math.max(0, Math.floor(remaining / 1000));
  const h = String(Math.floor(total / 3600)).padStart(2, '0');
  const m = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
  const s = String(total % 60).padStart(2, '0');
  return (
    <div className="rounded-lg bg-emerald-50 p-4">
      <div className="text-xs uppercase tracking-wide text-emerald-700">Held until</div>
      <div className="mt-1 font-mono text-2xl font-bold text-emerald-800">{h}:{m}:{s}</div>
      <div className="mt-1 text-xs text-emerald-700">
        Finish your application before the timer runs out to lock it in.
      </div>
    </div>
  );
}
