import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { fetchUnits, claimUnit, type Unit } from '@/api/units';
import { joinWaitlist } from '@/api/properties';
import { UnitCard, type UnitMismatch } from '@/components/UnitCard';
import { useApply } from '../ApplyContext';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { HF } from '@/styles/tokens';

const BEDROOMS_INCLUSIVE_MIN = 4;

interface IntentSnapshot {
  bedrooms: number;
  bedroomsInclusive: boolean;
  maxRent: number;
  moveInBy: string;
}

function bedroomsFilter(bedrooms: number) {
  return bedrooms >= BEDROOMS_INCLUSIVE_MIN
    ? { bedroomsMin: bedrooms }
    : { bedrooms };
}

function rentNumber(rent: string | number): number {
  return typeof rent === 'string' ? Number(rent) : rent;
}

function formatDate(iso: string, lang: string): string {
  // Render the unit's available_from date in the user's locale. Falls back to
  // the raw ISO if Date construction fails (defensive against API quirks).
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString(lang.startsWith('es') ? 'es' : 'en', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
}

function computeMismatch(
  unit: Unit,
  intent: IntentSnapshot,
  t: TFunction<'apply'>,
  lang: string,
): UnitMismatch {
  const notes: string[] = [];

  // Bedrooms. `bedroomsInclusive` means the user asked for "4+ BR", so we only
  // flag below-spec units, not above.
  if (intent.bedroomsInclusive) {
    if (unit.bedrooms < intent.bedrooms) {
      if (unit.bedrooms === 0) {
        notes.push(t('pick.mismatch.studioInstead', { wanted: intent.bedrooms }) as string);
      } else {
        notes.push(
          t('pick.mismatch.bedroomsFewer', { actual: unit.bedrooms, wanted: intent.bedrooms }) as string,
        );
      }
    }
  } else if (unit.bedrooms !== intent.bedrooms) {
    if (unit.bedrooms === 0) {
      notes.push(t('pick.mismatch.studioInstead', { wanted: intent.bedrooms }) as string);
    } else {
      notes.push(
        t('pick.mismatch.bedroomsMore', { actual: unit.bedrooms, wanted: intent.bedrooms }) as string,
      );
    }
  }

  // Budget.
  const rent = rentNumber(unit.monthly_rent);
  if (Number.isFinite(rent) && rent > intent.maxRent) {
    notes.push(
      t('pick.mismatch.overBudget', { amount: Math.ceil(rent - intent.maxRent).toLocaleString() }) as string,
    );
  }

  // Move-in availability.
  if (unit.available_from && intent.moveInBy && unit.available_from > intent.moveInBy) {
    notes.push(
      t('pick.mismatch.availableLater', { date: formatDate(unit.available_from, lang) }) as string,
    );
  }

  return { notes };
}

export function StepPick() {
  const s = useApply();
  const { t, i18n } = useTranslation('apply');
  const [isFallback, setIsFallback] = useState(false);
  const [intentSnapshot, setIntentSnapshot] = useState<IntentSnapshot | null>(null);
  const [waitlistJoining, setWaitlistJoining] = useState(false);
  const [waitlistError, setWaitlistError] = useState<string | null>(null);

  useEffect(() => {
    if (s.intentBedrooms === null || !s.intentMoveInDate) {
      s.setStep('intent');
      return;
    }
    let cancelled = false;
    const snapshot: IntentSnapshot = {
      bedrooms: s.intentBedrooms,
      bedroomsInclusive: s.intentBedrooms >= BEDROOMS_INCLUSIVE_MIN,
      maxRent: s.intentBudgetMax,
      moveInBy: s.intentMoveInDate,
    };

    (async () => {
      s.setUnitsLoading(true);
      s.setError(null);
      setIntentSnapshot(snapshot);

      // When the applicant arrived via a building deep link (frank-go /dl2 →
      // ?propertyId=donna-louise-2, which seeds propertySlug), scope every
      // relaxation stage to THAT property so the building they came for isn't
      // buried under the portfolio-wide `ORDER BY rent LIMIT 12`. The backend
      // `propertyId` param accepts the UUID (known after a claim) or the slug
      // (known from the URL first), so prefer whichever we have. Portfolio
      // walk-ins (no slug, no id) get `null` → no scope → today's behavior.
      const propertyScope: Parameters<typeof fetchUnits>[0] =
        s.propertyId
          ? { propertyId: s.propertyId }
          : s.propertySlug
            ? { propertyId: s.propertySlug }
            : {};
      const scoped = Object.keys(propertyScope).length > 0;

      // Progressive relaxation. Try strict first, then loosen one constraint at
      // a time so we always have *something* to show — the claimed-unit-as-
      // carrot pattern dies if the user hits a dead-end here. Each stage stays
      // scoped to the arrived-for property; only the final fallback drops the
      // scope so a deep-link to an (as-yet) empty building still shows options.
      const stages: Array<Parameters<typeof fetchUnits>[0]> = [
        // Strict.
        {
          ...propertyScope,
          ...bedroomsFilter(snapshot.bedrooms),
          maxRent: snapshot.maxRent,
          moveInBy: snapshot.moveInBy,
          ...(s.qualifyingAmiTier ? { amiTier: s.qualifyingAmiTier } : {}),
        },
        // Drop AMI tier — show units they may not income-qualify for; PM can
        // still review.
        {
          ...propertyScope,
          ...bedroomsFilter(snapshot.bedrooms),
          maxRent: snapshot.maxRent,
          moveInBy: snapshot.moveInBy,
        },
        // Also drop budget cap.
        {
          ...propertyScope,
          ...bedroomsFilter(snapshot.bedrooms),
          moveInBy: snapshot.moveInBy,
        },
        // Also drop move-in date.
        {
          ...propertyScope,
          ...bedroomsFilter(snapshot.bedrooms),
        },
        // Drop bedrooms — anything in the arrived-for property.
        { ...propertyScope },
        // Absolute last resort: drop the property scope too and show anything
        // portfolio-wide. Skipped when no scope was applied (it would be an
        // exact duplicate of the prior stage → a wasted fetch).
        ...(scoped ? [{} as Parameters<typeof fetchUnits>[0]] : []),
      ];

      try {
        let units: Unit[] = [];
        let stageIndex = 0;
        for (; stageIndex < stages.length; stageIndex += 1) {
          const res = await fetchUnits(stages[stageIndex]);
          if (cancelled) return;
          if (res.units.length > 0) {
            units = res.units;
            break;
          }
        }
        if (cancelled) return;
        setIsFallback(stageIndex > 0);
        s.setUnits(units);
      } catch (err) {
        if (!cancelled) s.setError(err instanceof Error ? err.message : (t('pick.loadError') as string));
      } finally {
        if (!cancelled) s.setUnitsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.intentBedrooms, s.intentBudgetMax, s.intentMoveInDate, s.qualifyingAmiTier, s.propertyId, s.propertySlug]);

  async function handleJoinWaitlist() {
    const slug = s.propertySlug ?? 'donna-louise-2';
    const bedrooms = s.intentBedrooms ?? 1;
    setWaitlistJoining(true);
    setWaitlistError(null);
    try {
      await joinWaitlist(slug, bedrooms);
      s.setPropertySlug(slug);
      s.setOutcome('waitlisted');
      s.setStep('confirm');
    } catch (err) {
      setWaitlistError(err instanceof Error ? err.message : (t('pick.waitlistError') as string));
    } finally {
      setWaitlistJoining(false);
    }
  }

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
      s.setError(err instanceof Error ? err.message : (t('pick.claimError') as string));
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
          {t('pick.noUnitsAvailable')}{' '}
          <button
            onClick={() => s.setStep('intent')}
            className="font-medium underline"
            style={{ color: HF.warn }}
          >
            {t('pick.adjust')}
          </button>
          <div className="mt-3 flex flex-col gap-2">
            <button
              onClick={handleJoinWaitlist}
              disabled={waitlistJoining}
              className="font-medium underline"
              style={{ color: HF.accent, textAlign: 'left' }}
              data-testid="join-waitlist-cta"
            >
              {waitlistJoining
                ? (t('pick.waitlistLoading') as string)
                : (t('pick.waitlistCta') as string)}
            </button>
            {waitlistError && (
              <span style={{ color: HF.err, fontSize: 12 }}>{waitlistError}</span>
            )}
          </div>
        </div>
      ) : (
        <>
          {isFallback && (
            <div
              role="status"
              className="mb-4 p-3 text-sm"
              style={{
                background: `${HF.warn}14`,
                color: HF.warn,
                border: `1px solid ${HF.warn}33`,
                borderRadius: HF.r.sm,
              }}
            >
              {t('pick.fallbackBanner')}{' '}
              <button
                onClick={() => s.setStep('intent')}
                className="font-medium underline"
                style={{ color: HF.warn }}
              >
                {t('pick.adjust')}
              </button>
            </div>
          )}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {s.units.map((u) => (
              <UnitCard
                key={u.id}
                unit={u}
                onClaim={handleClaim}
                claiming={s.claimingUnitId === u.id}
                mismatch={
                  isFallback && intentSnapshot
                    ? computeMismatch(u, intentSnapshot, t, i18n.language)
                    : undefined
                }
              />
            ))}
          </div>
        </>
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
