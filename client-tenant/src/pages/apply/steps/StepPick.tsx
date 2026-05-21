import { useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import { fetchUnits, claimUnit } from '@/api/units';
import { UnitCard } from '@/components/UnitCard';
import { useApply } from '../ApplyContext';
import { useTranslation } from '@/i18n';

const BEDROOMS_INCLUSIVE_MIN = 4;

export function StepPick() {
  const s = useApply();
  const { t } = useTranslation('apply');

  // Bounce back to intent if quiz incomplete (deep-link guard).
  useEffect(() => {
    if (s.intentBedrooms === null || !s.intentMoveInDate) {
      s.setStep('intent');
      return;
    }
    let cancelled = false;
    (async () => {
      s.setUnitsLoading(true);
      s.setError(null);
      try {
        const res = await fetchUnits({
          ...(s.intentBedrooms! >= BEDROOMS_INCLUSIVE_MIN
            ? { bedroomsMin: s.intentBedrooms! }
            : { bedrooms: s.intentBedrooms! }),
          maxRent: s.intentBudgetMax,
          moveInBy: s.intentMoveInDate,
        });
        if (!cancelled) s.setUnits(res.units);
      } catch (err) {
        if (!cancelled) s.setError(err instanceof Error ? err.message : t('pick.loadError'));
      } finally {
        if (!cancelled) s.setUnitsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.intentBedrooms, s.intentBudgetMax, s.intentMoveInDate]);

  async function handleClaim(unitId: string) {
    s.setClaimingUnitId(unitId);
    s.setError(null);
    try {
      const res = await claimUnit(unitId);
      s.setClaimedUnit(res.unit);
      s.setClaimExpiresAt(res.expires_at);
      s.setPropertyId(res.unit.property_id);
      s.setUnitNumber(res.unit.unit_number);
      s.setStep('claim');
    } catch (err) {
      s.setError(err instanceof Error ? err.message : t('pick.claimError'));
    } finally {
      s.setClaimingUnitId(null);
    }
  }

  return (
    <>
      <h1 className="mb-1 text-xl font-bold text-gray-900">{t('pick.title')}</h1>
      <p className="mb-4 text-sm text-gray-500">{t('pick.subtitle')}</p>
      {s.unitsLoading ? (
        <div className="flex items-center justify-center py-12 text-gray-400">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          {t('pick.loading')}
        </div>
      ) : s.units.length === 0 ? (
        <div className="rounded-lg bg-amber-50 p-4 text-sm text-amber-800">
          {t('pick.noMatch')}{' '}
          <button onClick={() => s.setStep('intent')} className="font-medium underline">
            {t('pick.adjust')}
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {s.units.map((u) => (
            <UnitCard
              key={u.id}
              unit={u}
              onClaim={handleClaim}
              claiming={s.claimingUnitId === u.id}
            />
          ))}
        </div>
      )}
      <button
        onClick={() => s.setStep('intent')}
        className="mt-6 text-sm text-gray-500 hover:text-gray-700 hover:underline"
      >
        {t('pick.editPrefs')}
      </button>
    </>
  );
}
