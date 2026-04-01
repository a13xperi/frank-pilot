import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useApiQuery } from '@/hooks/useApiQuery';
import { api } from '@/api/client';
import type { PropertyListResponse } from '@/types';

const INITIAL = {
  propertyId: '',
  unitNumber: '',
  firstName: '',
  lastName: '',
  ssn: '',
  dateOfBirth: '',
  email: '',
  phone: '',
  currentAddressLine1: '',
  currentAddressLine2: '',
  currentCity: '',
  currentState: '',
  currentZip: '',
  employerName: '',
  employerPhone: '',
  employmentStartDate: '',
  annualIncome: '',
  householdSize: '1',
  previousLandlordName: '',
  previousLandlordPhone: '',
  previousRentalAddress: '',
  previousRentalDurationMonths: '',
  emergencyContactName: '',
  emergencyContactPhone: '',
  emergencyContactRelationship: '',
  requestedLeaseTermMonths: '12',
  requestedRentAmount: '',
  requestedMoveInDate: '',
};

export function ApplicationForm() {
  const navigate = useNavigate();
  const props = useApiQuery<PropertyListResponse>('/api/properties');
  const [values, setValues] = useState(INITIAL);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  function onChange(e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) {
    setValues((v) => ({ ...v, [e.target.name]: e.target.value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const payload = {
        ...values,
        annualIncome: values.annualIncome ? Number(values.annualIncome) : undefined,
        householdSize: Number(values.householdSize),
        requestedLeaseTermMonths: Number(values.requestedLeaseTermMonths),
        requestedRentAmount: values.requestedRentAmount ? Number(values.requestedRentAmount) : undefined,
        previousRentalDurationMonths: values.previousRentalDurationMonths ? Number(values.previousRentalDurationMonths) : undefined,
        // strip empty strings
        unitNumber: values.unitNumber || undefined,
        email: values.email || undefined,
        phone: values.phone || undefined,
        currentAddressLine2: values.currentAddressLine2 || undefined,
        employerPhone: values.employerPhone || undefined,
        employmentStartDate: values.employmentStartDate || undefined,
        previousLandlordName: values.previousLandlordName || undefined,
        previousLandlordPhone: values.previousLandlordPhone || undefined,
        previousRentalAddress: values.previousRentalAddress || undefined,
        emergencyContactName: values.emergencyContactName || undefined,
        emergencyContactPhone: values.emergencyContactPhone || undefined,
        emergencyContactRelationship: values.emergencyContactRelationship || undefined,
        requestedMoveInDate: values.requestedMoveInDate || undefined,
      };
      const res = await api.post<{ id: string }>('/api/applications', payload);
      navigate(`/applications/${res.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create application');
    } finally {
      setSubmitting(false);
    }
  }

  const hhSize = Number(values.householdSize);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <button onClick={() => navigate('/applications')} className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
        <ArrowLeft className="h-4 w-4" /> Back to Applications
      </button>

      <h1 className="text-2xl font-semibold text-gray-900">New Application</h1>

      <form onSubmit={handleSubmit} className="space-y-8">
        {/* Section 1: Property */}
        <Section title="Property">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Property *</label>
              <select name="propertyId" value={values.propertyId} onChange={onChange} required className="input">
                <option value="">Select property...</option>
                {(props.data?.properties || []).map((p) => (
                  <option key={p.id} value={p.id}>{p.name} — {p.city}, {p.state}</option>
                ))}
              </select>
            </div>
            <Field label="Unit Number" name="unitNumber" value={values.unitNumber} onChange={onChange} />
          </div>
        </Section>

        {/* Section 2: Applicant */}
        <Section title="Applicant Information">
          <div className="grid grid-cols-2 gap-3">
            <Field label="First Name *" name="firstName" value={values.firstName} onChange={onChange} required />
            <Field label="Last Name *" name="lastName" value={values.lastName} onChange={onChange} required />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Field label="SSN *" name="ssn" value={values.ssn} onChange={onChange} required placeholder="123-45-6789" />
            <Field label="Date of Birth *" name="dateOfBirth" value={values.dateOfBirth} onChange={onChange} required type="date" />
            <Field label="Email" name="email" value={values.email} onChange={onChange} type="email" />
          </div>
          <Field label="Phone" name="phone" value={values.phone} onChange={onChange} />
        </Section>

        {/* Section 3: Address */}
        <Section title="Current Address">
          <Field label="Address Line 1" name="currentAddressLine1" value={values.currentAddressLine1} onChange={onChange} />
          <Field label="Address Line 2" name="currentAddressLine2" value={values.currentAddressLine2} onChange={onChange} />
          <div className="grid grid-cols-3 gap-3">
            <Field label="City" name="currentCity" value={values.currentCity} onChange={onChange} />
            <Field label="State" name="currentState" value={values.currentState} onChange={onChange} maxLength={2} />
            <Field label="ZIP" name="currentZip" value={values.currentZip} onChange={onChange} />
          </div>
        </Section>

        {/* Section 4: Employment & Income */}
        <Section title="Employment & Income">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Employer" name="employerName" value={values.employerName} onChange={onChange} />
            <Field label="Employer Phone" name="employerPhone" value={values.employerPhone} onChange={onChange} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Employment Start" name="employmentStartDate" value={values.employmentStartDate} onChange={onChange} type="date" />
            <Field label="Annual Income ($)" name="annualIncome" value={values.annualIncome} onChange={onChange} type="number" />
          </div>
        </Section>

        {/* Section 5: Household */}
        <Section title="Household">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Household Size (1-8) *</label>
              <select name="householdSize" value={values.householdSize} onChange={onChange} required className="input">
                {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
                  <option key={n} value={n}>{n} {n === 1 ? 'person' : 'persons'}</option>
                ))}
              </select>
            </div>
          </div>
          {hhSize > 1 && (
            <p className="rounded-lg bg-blue-50 px-4 py-2 text-sm text-blue-700">
              Household members (ages, student status, relationships) will be captured during screening.
              {hhSize >= 3 && ' Children ages 18-19 are subject to student status verification.'}
            </p>
          )}
        </Section>

        {/* Section 6: Rental History */}
        <Section title="Rental History">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Previous Landlord" name="previousLandlordName" value={values.previousLandlordName} onChange={onChange} />
            <Field label="Landlord Phone" name="previousLandlordPhone" value={values.previousLandlordPhone} onChange={onChange} />
          </div>
          <Field label="Previous Address" name="previousRentalAddress" value={values.previousRentalAddress} onChange={onChange} />
          <Field label="Duration (months)" name="previousRentalDurationMonths" value={values.previousRentalDurationMonths} onChange={onChange} type="number" />
        </Section>

        {/* Section 7: Emergency Contact */}
        <Section title="Emergency Contact">
          <div className="grid grid-cols-3 gap-3">
            <Field label="Name" name="emergencyContactName" value={values.emergencyContactName} onChange={onChange} />
            <Field label="Phone" name="emergencyContactPhone" value={values.emergencyContactPhone} onChange={onChange} />
            <Field label="Relationship" name="emergencyContactRelationship" value={values.emergencyContactRelationship} onChange={onChange} />
          </div>
        </Section>

        {/* Section 8: Lease Preferences */}
        <Section title="Lease Preferences">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="label">Lease Term (months)</label>
              <select name="requestedLeaseTermMonths" value={values.requestedLeaseTermMonths} onChange={onChange} className="input">
                {[6, 12, 18, 24, 36].map((n) => (
                  <option key={n} value={n}>{n} months</option>
                ))}
              </select>
            </div>
            <Field label="Rent Amount ($)" name="requestedRentAmount" value={values.requestedRentAmount} onChange={onChange} type="number" />
            <Field label="Move-in Date" name="requestedMoveInDate" value={values.requestedMoveInDate} onChange={onChange} type="date" />
          </div>
        </Section>

        {error && <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">{error}</p>}

        <div className="flex justify-end gap-3 border-t border-gray-200 pt-6">
          <button type="button" onClick={() => navigate('/applications')} className="rounded-lg px-4 py-2 text-sm text-gray-600 hover:bg-gray-100">
            Cancel
          </button>
          <button type="submit" disabled={submitting} className="rounded-lg bg-emerald-600 px-6 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
            {submitting ? 'Creating...' : 'Create Application (Draft)'}
          </button>
        </div>
      </form>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 space-y-3">
      <h2 className="text-sm font-medium text-gray-900 uppercase tracking-wider">{title}</h2>
      {children}
    </div>
  );
}

function Field({
  label, name, value, onChange, type = 'text', required, placeholder, maxLength,
}: {
  label: string; name: string; value: string; onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  type?: string; required?: boolean; placeholder?: string; maxLength?: number;
}) {
  return (
    <div>
      <label className="label">{label}</label>
      <input name={name} type={type} value={value} onChange={onChange} required={required} placeholder={placeholder} maxLength={maxLength} className="input" />
    </div>
  );
}
