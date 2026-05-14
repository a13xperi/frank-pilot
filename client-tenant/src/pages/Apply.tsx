import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { api, setToken } from '@/api/client';
import { CheckCircle } from 'lucide-react';

interface Property {
  id: string;
  name: string;
  address?: string;
}

type Step = 1 | 2;

export function Apply() {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>(1);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  // Step 1 fields
  const [email, setEmail] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');

  // Properties for dropdown
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

  async function handleStep1(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await api.post<any>('/applicants/register', {
        email,
        firstName,
        lastName,
        phone: phone || undefined,
      });
      if (res.token) setToken(res.token);

      // Fetch properties now that we have a token
      setPropertiesLoading(true);
      try {
        const data = await api.get<{ properties: Property[] } | Property[]>('/properties');
        const list = Array.isArray(data) ? data : (data as any).properties ?? [];
        setProperties(list);
      } catch {
        setPropertiesFailed(true);
      } finally {
        setPropertiesLoading(false);
      }

      setStep(2);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed');
    } finally {
      setLoading(false);
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
      await api.post<any>('/applicants/apply', {
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

  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <div className="mx-auto max-w-md space-y-6 py-8">
        {/* Progress */}
        <div className="flex items-center gap-2">
          {([1, 2] as Step[]).map(s => (
            <div key={s} className="flex items-center gap-2">
              <div className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold
                ${step === s ? 'bg-emerald-600 text-white' : step > s ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-200 text-gray-500'}`}>
                {s}
              </div>
              <span className={`text-xs ${step === s ? 'font-medium text-gray-900' : 'text-gray-400'}`}>
                {s === 1 ? 'Account' : 'Application'}
              </span>
              {s < 2 && <div className="mx-1 h-px w-8 bg-gray-300" />}
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

          {step === 2 && (
            <>
              <h1 className="mb-4 text-xl font-bold text-gray-900">Application details</h1>
              <form onSubmit={handleStep2} className="space-y-4">
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
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                  )}
                </div>
                <div>
                  <label className="label" htmlFor="unitNumber">Unit number</label>
                  <input id="unitNumber" className="input" value={unitNumber} onChange={e => setUnitNumber(e.target.value)} placeholder="Optional" />
                </div>
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
                  <button type="button" onClick={() => setStep(1)} className="flex-1 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
                    Back
                  </button>
                  <button
                    type="submit"
                    disabled={loading || !ssn || !!ssnError || !dateOfBirth || (!propertyId && !propertiesFailed)}
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
