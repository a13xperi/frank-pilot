import { useEffect } from 'react';
import { api } from '@/api/client';
import { useApply } from '../ApplyContext';
import { useTranslation } from 'react-i18next';
import { HF } from '@/styles/tokens';

interface Property { id: string; name: string; city?: string; state?: string; }

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
  padding: '8px 12px',
  fontSize: 14,
  background: HF.paper,
  color: HF.ink,
  fontFamily: HF.body,
  outline: 'none',
} as const;

// Property + unit-number sub-form used by Step2Details when there is no claim.
export function PropertySelector() {
  const s = useApply();
  const { t } = useTranslation('apply');

  useEffect(() => {
    if (s.claimedUnit || s.properties.length > 0 || s.propertiesLoading) return;
    let cancelled = false;
    (async () => {
      s.setPropertiesLoading(true);
      try {
        const data = await api.get<{ properties: Property[] } | Property[]>('/applicants/properties');
        if (cancelled) return;
        const list = Array.isArray(data) ? data : (data as { properties: Property[] }).properties ?? [];
        s.setProperties(list);
      } catch {
        if (!cancelled) s.setPropertiesFailed(true);
      } finally {
        if (!cancelled) s.setPropertiesLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // propertiesLoading intentionally excluded: the effect sets it, so including
    // it would cancel the in-flight fetch when its own state update fires.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.claimedUnit, s.properties.length]);

  return (
    <>
      <div>
        <label style={labelStyle} htmlFor="propertyId">{t('details.property')}</label>
        {s.propertiesLoading ? (
          <p className="text-sm" style={{ color: HF.ink3 }}>{t('details.loadingProperties')}</p>
        ) : s.propertiesFailed || s.properties.length === 0 ? (
          <input id="propertyId" style={inputStyle} required placeholder={t('details.propertyPlaceholder')} value={s.propertyId} onChange={(e) => s.setPropertyId(e.target.value)} />
        ) : (
          <select id="propertyId" style={inputStyle} required value={s.propertyId} onChange={(e) => s.setPropertyId(e.target.value)}>
            <option value="">{t('details.selectProperty')}</option>
            {s.properties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}{p.city && p.state ? ` — ${p.city}, ${p.state}` : ''}
              </option>
            ))}
          </select>
        )}
      </div>
      <div>
        <label style={labelStyle} htmlFor="unitNumber">{t('details.unitNumber')}</label>
        <input id="unitNumber" style={inputStyle} value={s.unitNumber} onChange={(e) => s.setUnitNumber(e.target.value)} placeholder={t('details.unitOptional')} />
      </div>
    </>
  );
}
