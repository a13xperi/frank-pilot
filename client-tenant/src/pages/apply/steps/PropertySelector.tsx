import { useEffect } from 'react';
import { api } from '@/api/client';
import { useApply } from '../ApplyContext';
import { useTranslation } from 'react-i18next';

interface Property { id: string; name: string; city?: string; state?: string; }

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.claimedUnit, s.properties.length, s.propertiesLoading]);

  return (
    <>
      <div>
        <label className="label" htmlFor="propertyId">{t('details.property')}</label>
        {s.propertiesLoading ? (
          <p className="text-sm text-gray-400">{t('details.loadingProperties')}</p>
        ) : s.propertiesFailed || s.properties.length === 0 ? (
          <input id="propertyId" className="input" required placeholder={t('details.propertyPlaceholder')} value={s.propertyId} onChange={(e) => s.setPropertyId(e.target.value)} />
        ) : (
          <select id="propertyId" className="input" required value={s.propertyId} onChange={(e) => s.setPropertyId(e.target.value)}>
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
        <label className="label" htmlFor="unitNumber">{t('details.unitNumber')}</label>
        <input id="unitNumber" className="input" value={s.unitNumber} onChange={(e) => s.setUnitNumber(e.target.value)} placeholder={t('details.unitOptional')} />
      </div>
    </>
  );
}
