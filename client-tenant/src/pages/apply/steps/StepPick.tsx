import { useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import { fetchUnits, claimUnit } from '@/api/units';
import { UnitCard } from '@/components/UnitCard';
import { useApply } from '../ApplyContext';
import { useTranslation } from 'react-i18next';
import { HF } from '@/styles/tokens';

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
          // Permissive default: null tier (no income / over-income) omits the
          // filter, so applicants always see something to apply to.
          ...(s.qualifyingAmiTier ? { amiTier: s.qualifyingAmiTier } : {}),
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
  }, [s.intentBedrooms, s.intentBudgetMax, s.intentMoveInDate, s.qualifyingAmiTier]);

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
      <h1
        className="mb-1 text-xl font-bold"
        style={{ fontFamily: HF.display, color: HF.ink }}
      >
        {t('pick.title')}
      </h1>
      <p className="mb-4 text-sm" style={{ color: HF.ink3 }}>{t('pick.subtitle')}</p>
      {s.unitsLoading ? (
        <div
          className="flex items-center justify-center py-12"
          style={{ color: HF.ink3 }}
        >
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          {t('pick.loading')}
        </div>
      ) : s.units.length === 0 ? (
        <div
          className="p-4 text-sm"
          style={{
            background: `${HF.warn}14`,
            color: HF.warn,
            border: `1px solid ${HF.warn}33`,
            borderRadius: HF.r.sm,
          }}
        >
          {t('pick.noMatch')}{' '}
          <button
            onClick={() => s.setStep('intent')}
            className="font-medium underline"
            style={{ color: HF.warn }}
          >
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
        className="mt-6 text-sm hover:underline"
        style={{ color: HF.ink3 }}
      >
        {t('pick.editPrefs')}
      </button>
    </>
  );
}
