import { useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { saveIntent } from '@/api/units';
import { useApply } from '../ApplyContext';
import { useTranslation } from 'react-i18next';
import { CTA } from '@/components/primitives';

const BR_KEYS = ['br.studio', 'br.1', 'br.2', 'br.3', 'br.4plus'] as const;
const BR_VALUES = [0, 1, 2, 3, 4] as const;

// Welcome → Apply handoff: unitType query param → bedroom integer.
const UNIT_TYPE_TO_BEDROOMS: Record<string, number> = {
  STUDIO: 0,
  '1BR': 1,
  '2BR': 2,
  '3BR': 3,
};

export function StepIntent() {
  const s = useApply();
  const { t } = useTranslation('apply');
  const [search] = useSearchParams();
  const prefilled = useRef(false);

  // Prefill silently from ?unitType= & ?propertyId= (Lane B handoff).
  useEffect(() => {
    if (prefilled.current) return;
    const unitType = search.get('unitType');
    const propertyId = search.get('propertyId');
    if (unitType && UNIT_TYPE_TO_BEDROOMS[unitType] !== undefined && s.intentBedrooms === null) {
      s.setIntentBedrooms(UNIT_TYPE_TO_BEDROOMS[unitType]);
    }
    if (propertyId && !s.propertyId) {
      s.setPropertyId(propertyId);
    }
    prefilled.current = true;
  }, [search, s]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (s.intentBedrooms === null || !s.intentMoveInDate) return;
    s.setError(null);
    s.setLoading(true);
    try {
      await saveIntent({
        bedrooms: s.intentBedrooms,
        budget_max: s.intentBudgetMax,
        move_in_date: s.intentMoveInDate,
        household_size: s.intentHouseholdSize,
      });
      s.setHouseholdSize(String(s.intentHouseholdSize));
      s.setMoveInDate(s.intentMoveInDate);
      s.setStep('checklist');
    } catch (err) {
      s.setError(err instanceof Error ? err.message : t('intent.saveError'));
    } finally {
      s.setLoading(false);
    }
  }

  return (
    <>
      <h1 className="mb-1 text-xl font-bold text-gray-900">{t('intent.title')}</h1>
      <p className="mb-4 text-sm text-gray-500">{t('intent.subtitle')}</p>
      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label className="label">{t('intent.bedrooms')}</label>
          <div className="grid grid-cols-5 gap-2">
            {BR_VALUES.map((val, i) => (
              <button
                type="button"
                key={val}
                onClick={() => s.setIntentBedrooms(val)}
                className={`rounded-lg border px-2 py-3 text-sm font-medium transition ${
                  s.intentBedrooms === val
                    ? 'border-emerald-600 bg-emerald-50 text-emerald-700'
                    : 'border-gray-300 bg-white text-gray-700 hover:border-emerald-400'
                }`}
              >
                {t(`intent.${BR_KEYS[i]}`)}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="label" htmlFor="budget">
            {t('intent.budget')}{' '}
            <span className="font-semibold text-gray-900">
              ${s.intentBudgetMax.toLocaleString()}
            </span>
          </label>
          <input
            id="budget"
            type="range"
            min={500}
            max={5000}
            step={50}
            value={s.intentBudgetMax}
            onChange={(e) => s.setIntentBudgetMax(Number(e.target.value))}
            className="w-full accent-emerald-600"
          />
          <div className="mt-1 flex justify-between text-xs text-gray-400">
            <span>$500</span>
            <span>$5,000</span>
          </div>
        </div>
        <div>
          <label className="label" htmlFor="intentMoveIn">{t('intent.moveIn')}</label>
          <input
            id="intentMoveIn"
            type="date"
            className="input"
            required
            value={s.intentMoveInDate}
            onChange={(e) => s.setIntentMoveInDate(e.target.value)}
          />
        </div>
        <div>
          <label className="label" htmlFor="intentHousehold">{t('intent.household')}</label>
          <select
            id="intentHousehold"
            className="input"
            value={s.intentHouseholdSize}
            onChange={(e) => s.setIntentHouseholdSize(Number(e.target.value))}
          >
            {Array.from({ length: 8 }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </div>
        <CTA type="submit" disabled={s.loading || s.intentBedrooms === null || !s.intentMoveInDate}>
          {s.loading ? t('common.saving') : t('intent.submit')}
        </CTA>
      </form>
    </>
  );
}
