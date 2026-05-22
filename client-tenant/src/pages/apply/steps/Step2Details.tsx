import { useNavigate } from 'react-router-dom';
import { api } from '@/api/client';
import { useApply } from '../ApplyContext';
import { useTranslation } from 'react-i18next';
import { CTA, FormGrid } from '@/components/primitives';
import { HF } from '@/styles/tokens';
import { PropertySelector } from './PropertySelector';

const labelStyle = {
  display: 'block',
  marginBottom: 4,
  fontSize: 13,
  fontWeight: 500,
  color: HF.ink,
  fontFamily: HF.body,
} as const;

const inputStyle = {
  width: '100%',
  borderRadius: HF.r.sm,
  border: `1px solid ${HF.border}`,
  padding: '10px 12px',
  fontSize: 16,
  background: HF.paper,
  color: HF.ink,
  fontFamily: HF.body,
  outline: 'none',
} as const;

export function Step2Details() {
  const s = useApply();
  const navigate = useNavigate();
  const { t } = useTranslation('apply');

  function validateSsn(value: string) {
    const clean = value.replace(/-/g, '');
    if (clean.length === 0) { s.setSsnError(null); return; }
    const valid = /^\d{3}-?\d{2}-?\d{4}$/.test(value) || /^\d{9}$/.test(clean);
    s.setSsnError(valid ? null : t('details.ssnError'));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (s.ssnError) return;
    s.setError(null);
    s.setLoading(true);
    try {
      await api.post('/applicants/apply', {
        propertyId: s.propertyId || undefined,
        unitNumber: s.unitNumber || undefined,
        firstName: s.firstName, lastName: s.lastName,
        ssn: s.ssn, dateOfBirth: s.dateOfBirth, email: s.email,
        phone: s.phone || undefined,
        currentAddressLine1: s.addressLine1 || undefined,
        currentCity: s.city || undefined,
        currentState: s.state || undefined,
        currentZip: s.zip || undefined,
        employerName: s.employerName || undefined,
        annualIncome: s.annualIncome ? Number(s.annualIncome) : undefined,
        householdSize: Number(s.householdSize),
        requestedMoveInDate: s.moveInDate || undefined,
        requestedLeaseTermMonths: 12,
      });
      s.setDone(true);
      setTimeout(() => navigate('/status'), 2000);
    } catch (err) {
      s.setError(err instanceof Error ? err.message : t('details.submitError'));
    } finally {
      s.setLoading(false);
    }
  }

  const submitDisabled =
    s.loading || !s.ssn || !!s.ssnError || !s.dateOfBirth ||
    (!s.claimedUnit && !s.propertyId && !s.propertiesFailed);

  return (
    <>
      <h1
        className="mb-4 text-xl font-bold"
        style={{ fontFamily: HF.display, color: HF.ink }}
      >
        {t('details.title')}
      </h1>
      <form onSubmit={handleSubmit} className="space-y-4">
        {!s.claimedUnit && <PropertySelector />}
        <FormGrid columns={2}>
          <div>
            <label style={labelStyle} htmlFor="ssn">{t('details.ssn')}</label>
            <input id="ssn" style={inputStyle} required placeholder={t('details.ssnPlaceholder')} value={s.ssn} onChange={(e) => s.setSsn(e.target.value)} onBlur={() => validateSsn(s.ssn)} />
            {s.ssnError && <p className="mt-1 text-xs" style={{ color: HF.err }}>{s.ssnError}</p>}
          </div>
          <div>
            <label style={labelStyle} htmlFor="dob">{t('details.dob')}</label>
            <input id="dob" type="date" style={inputStyle} required value={s.dateOfBirth} onChange={(e) => s.setDateOfBirth(e.target.value)} />
          </div>
        </FormGrid>
        <div>
          <label style={labelStyle} htmlFor="address">{t('details.address')}</label>
          <input id="address" style={inputStyle} value={s.addressLine1} onChange={(e) => s.setAddressLine1(e.target.value)} />
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <div>
            <label style={labelStyle} htmlFor="city">{t('details.city')}</label>
            <input id="city" style={inputStyle} value={s.city} onChange={(e) => s.setCity(e.target.value)} />
          </div>
          <div>
            <label style={labelStyle} htmlFor="state">{t('details.state')}</label>
            <input id="state" style={inputStyle} maxLength={2} placeholder="NV" value={s.state} onChange={(e) => s.setState(e.target.value.toUpperCase())} />
          </div>
          <div>
            <label style={labelStyle} htmlFor="zip">{t('details.zip')}</label>
            <input id="zip" style={inputStyle} maxLength={10} value={s.zip} onChange={(e) => s.setZip(e.target.value)} />
          </div>
        </div>
        <div>
          <label style={labelStyle} htmlFor="employer">{t('details.employer')}</label>
          <input id="employer" style={inputStyle} value={s.employerName} onChange={(e) => s.setEmployerName(e.target.value)} />
        </div>
        <FormGrid columns={2}>
          <div>
            <label style={labelStyle} htmlFor="income">{t('details.income')}</label>
            <input id="income" type="number" min={0} style={inputStyle} value={s.annualIncome} onChange={(e) => s.setAnnualIncome(e.target.value)} />
          </div>
          <div>
            <label style={labelStyle} htmlFor="household">{t('details.household')}</label>
            <select id="household" style={inputStyle} required value={s.householdSize} onChange={(e) => s.setHouseholdSize(e.target.value)}>
              {Array.from({ length: 8 }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </div>
        </FormGrid>
        <div>
          <label style={labelStyle} htmlFor="moveIn">{t('details.moveIn')}</label>
          <input id="moveIn" type="date" style={inputStyle} value={s.moveInDate} onChange={(e) => s.setMoveInDate(e.target.value)} />
        </div>
        <div className="flex gap-3">
          <CTA type="button" tone="secondary" block={false} className="flex-1" onClick={() => s.setStep(s.claimedUnit ? 'claim' : 1)}>
            {t('common.back')}
          </CTA>
          <CTA type="submit" block={false} className="flex-1" disabled={submitDisabled}>
            {s.loading ? t('common.submitting') : t('details.submit')}
          </CTA>
        </div>
      </form>
    </>
  );
}
