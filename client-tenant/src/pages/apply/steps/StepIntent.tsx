import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { saveIntent } from '@/api/units';
import { getToken } from '@/api/client';
import { useApply } from '../ApplyContext';
import { useTranslation } from 'react-i18next';
import { StepCTA } from '../StepCTA';
import { HF } from '@/styles/tokens';
import { formatAmiTier, qualifyAmiTier, type AmiTier } from '@/lib/ami';

const BR_KEYS = ['br.studio', 'br.1', 'br.2', 'br.3', 'br.4plus'] as const;
const BR_VALUES = [0, 1, 2, 3, 4] as const;

const AMI_MSA = 'LAS_VEGAS_HENDERSON' as const;
const VALID_TIERS = new Set<AmiTier>(['30', '50', '60', '80']);

// Welcome → Apply handoff: unitType query param → bedroom integer.
const UNIT_TYPE_TO_BEDROOMS: Record<string, number> = {
  STUDIO: 0,
  '1BR': 1,
  '2BR': 2,
  '3BR': 3,
};

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

export function StepIntent() {
  const s = useApply();
  const { t } = useTranslation('apply');
  const [search] = useSearchParams();
  const prefilled = useRef(false);

  // Prefilled-mode: when the welcome AMI calculator already produced a tier
  // (forwarded via ?amiTier= → ApplyContext on mount), we show a one-line
  // summary + "Recalculate" rather than re-asking for income. The summary
  // collapses to the full input when the applicant clicks Recalculate.
  const [showAmiRecalc, setShowAmiRecalc] = useState(false);
  const hasPrefilledTier = s.qualifyingAmiTier != null && !showAmiRecalc;

  // Welcome→Apply deep-link auth gate. POST /applicants/intent requires
  // authenticate + requireEmailVerified, so without a token submit will 401
  // and the API client will eject to /login — stranding handoff users who
  // never went through Register/Verify. Bounce to step 1 so the wizard flows
  // them through Register → Verify; URL params (the welcome handoff) survive
  // the step change and StepIntent's prefill picks them up post-verify.
  useEffect(() => {
    if (!getToken()) {
      // Clear any stale "Session expired" banner before showing Register. A
      // tester arriving with a dead token in localStorage 401s on the first
      // authed call (saveIntent), which the API client surfaces as "Session
      // expired"; once the token is cleared we bounce here, and the carried-
      // over error would otherwise paint a scary banner on a brand-new
      // applicant's "Create your account" screen.
      s.setError(null);
      s.setStep(1);
    }
  }, [s]);

  const [incomeStr, setIncomeStr] = useState<string>(
    s.grossAnnualIncome != null ? String(s.grossAnnualIncome) : '',
  );

  const incomeNum = useMemo(() => {
    const trimmed = incomeStr.replace(/[$,\s]/g, '');
    const n = Number.parseFloat(trimmed);
    return Number.isFinite(n) && n >= 0 ? n : null;
  }, [incomeStr]);

  const previewTier = useMemo(() => {
    if (incomeNum == null) return null;
    return qualifyAmiTier(AMI_MSA, s.intentHouseholdSize, incomeNum);
  }, [incomeNum, s.intentHouseholdSize]);

  // Prefill silently from ?unitType= & ?propertyId= (Lane B handoff), plus
  // W0 ?amiTier=&hh=&income= when the welcome AMI calculator forwarded them.
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
    // W0 prefill — only run when income is present (tier alone is not enough
    // to seed local state). When ?amiTier is supplied we trust it; otherwise
    // we recompute from (hh, income) so the displayed tier always matches the
    // current AMI table.
    const hhRaw = search.get('hh');
    const incomeRaw = search.get('income');
    const amiTierRaw = search.get('amiTier');
    const incomeFromQs = incomeRaw ? Number.parseFloat(incomeRaw) : NaN;
    if (Number.isFinite(incomeFromQs) && incomeFromQs >= 0 && s.grossAnnualIncome == null) {
      const hh = hhRaw ? Number.parseInt(hhRaw, 10) : s.intentHouseholdSize;
      if (Number.isFinite(hh) && hh >= 1) {
        s.setIntentHouseholdSize(hh);
        setIncomeStr(String(incomeFromQs));
        const tier: AmiTier | null =
          amiTierRaw && VALID_TIERS.has(amiTierRaw as AmiTier)
            ? (amiTierRaw as AmiTier)
            : qualifyAmiTier(AMI_MSA, hh, incomeFromQs);
        s.setGrossAnnualIncome(incomeFromQs);
        s.setQualifyingAmiTier(tier);
        s.setQualifyingAmiCalculatedAt(new Date().toISOString());
        s.setQualifyingHouseholdSize(hh);
      }
    }
    prefilled.current = true;
  }, [search, s]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (s.intentBedrooms === null || !s.intentMoveInDate) return;
    s.setError(null);
    s.setLoading(true);
    try {
      // Compute the tier upfront so the same value goes to the backend and to
      // local state — keeps the draft row and the wizard's cached tier
      // strictly in sync.
      const computedTier = incomeNum != null
        ? qualifyAmiTier(AMI_MSA, s.intentHouseholdSize, incomeNum)
        : null;
      await saveIntent({
        bedrooms: s.intentBedrooms,
        budget_max: s.intentBudgetMax,
        move_in_date: s.intentMoveInDate,
        household_size: s.intentHouseholdSize,
        gross_annual_income: incomeNum,
        qualifying_ami_tier: computedTier,
      });
      s.setHouseholdSize(String(s.intentHouseholdSize));
      s.setMoveInDate(s.intentMoveInDate);
      if (incomeNum != null) {
        s.setGrossAnnualIncome(incomeNum);
        s.setQualifyingAmiTier(computedTier);
        s.setQualifyingAmiCalculatedAt(new Date().toISOString());
        s.setQualifyingHouseholdSize(s.intentHouseholdSize);
      } else {
        s.setGrossAnnualIncome(null);
        s.setQualifyingAmiTier(null);
        s.setQualifyingAmiCalculatedAt(null);
        s.setQualifyingHouseholdSize(null);
      }
      s.setStep('checklist');
    } catch (err) {
      s.setError(err instanceof Error ? err.message : t('intent.saveError'));
    } finally {
      s.setLoading(false);
    }
  }

  return (
    <>
      <h1
        className="mb-1 text-xl font-bold"
        style={{ fontFamily: HF.display, color: HF.ink }}
      >
        {t('intent.title')}
      </h1>
      <p className="mb-4 text-sm" style={{ color: HF.ink3 }}>{t('intent.subtitle')}</p>
      <form id="apply-intent-form" onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label style={labelStyle}>{t('intent.bedrooms')}</label>
          <div className="grid grid-cols-5 gap-2">
            {BR_VALUES.map((val, i) => {
              const active = s.intentBedrooms === val;
              return (
                <button
                  type="button"
                  key={val}
                  onClick={() => s.setIntentBedrooms(val)}
                  className="px-2 py-3 text-sm transition"
                  style={{
                    borderRadius: HF.r.sm,
                    border: `1px solid ${active ? HF.accent : HF.border}`,
                    background: active ? HF.accentLo : HF.paper,
                    color: active ? HF.accentInk : HF.ink,
                    fontWeight: active ? 600 : 500,
                    fontFamily: HF.body,
                    cursor: 'pointer',
                  }}
                >
                  {t(`intent.${BR_KEYS[i]}`)}
                </button>
              );
            })}
          </div>
        </div>
        <div>
          <label style={labelStyle} htmlFor="budget">
            {t('intent.budget')}{' '}
            <span style={{ fontWeight: 700, color: HF.ink }}>
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
            className="w-full"
            style={{ accentColor: HF.accent }}
          />
          <div className="mt-1 flex justify-between text-xs" style={{ color: HF.ink3 }}>
            <span>$500</span>
            <span>$5,000</span>
          </div>
        </div>
        <div>
          <label style={labelStyle} htmlFor="intentMoveIn">{t('intent.moveIn')}</label>
          <input
            id="intentMoveIn"
            type="date"
            style={inputStyle}
            required
            value={s.intentMoveInDate}
            onChange={(e) => s.setIntentMoveInDate(e.target.value)}
          />
        </div>
        <div>
          <label style={labelStyle} htmlFor="intentHousehold">{t('intent.household')}</label>
          <select
            id="intentHousehold"
            style={inputStyle}
            value={s.intentHouseholdSize}
            onChange={(e) => s.setIntentHouseholdSize(Number(e.target.value))}
          >
            {Array.from({ length: 8 }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </div>
        <div
          style={{
            marginTop: 8,
            paddingTop: 12,
            borderTop: `1px dashed ${HF.border}`,
          }}
        >
          <div
            style={{
              fontFamily: HF.display,
              fontSize: 13,
              fontWeight: 700,
              color: HF.ink,
              letterSpacing: 0.2,
            }}
          >
            {t('intent.ami.sectionTitle')}
          </div>
          {hasPrefilledTier ? (
            <>
              <div style={{ fontSize: 12, color: HF.ink3, marginTop: 2, marginBottom: 8 }}>
                {t('intent.ami.prefilledHint')}
              </div>
              <div
                data-testid="intent-ami-prefilled"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '10px 12px',
                  borderRadius: HF.r.sm,
                  background: HF.accentLo,
                  border: `1px solid ${HF.accent}`,
                }}
              >
                <span
                  style={{
                    fontWeight: 600,
                    color: HF.accentInk,
                    fontFamily: HF.body,
                    fontSize: 14,
                  }}
                >
                  {t('intent.ami.prefilledSummary', {
                    tier: formatAmiTier(s.qualifyingAmiTier),
                  })}
                </span>
                <button
                  type="button"
                  data-testid="intent-ami-recalc"
                  onClick={() => setShowAmiRecalc(true)}
                  style={{
                    marginLeft: 'auto',
                    background: 'transparent',
                    border: 'none',
                    color: HF.accent,
                    fontSize: 12,
                    textDecoration: 'underline',
                    cursor: 'pointer',
                    fontFamily: HF.body,
                  }}
                >
                  {t('intent.ami.recalculate')}
                </button>
              </div>
            </>
          ) : (
            <>
              <div style={{ fontSize: 12, color: HF.ink3, marginTop: 2, marginBottom: 8 }}>
                {t('intent.ami.sectionHint')}
              </div>
              <label style={labelStyle} htmlFor="intentIncome">
                {t('intent.ami.incomeLabel')}
              </label>
              <input
                id="intentIncome"
                type="text"
                inputMode="numeric"
                autoComplete="off"
                style={inputStyle}
                placeholder={t('intent.ami.incomePlaceholder')}
                value={incomeStr}
                onChange={(e) => setIncomeStr(e.target.value)}
                aria-describedby="intentIncomeStatus"
              />
              <div
                id="intentIncomeStatus"
                role="status"
                aria-live="polite"
                className="mt-2 min-h-[1.25rem] text-xs"
              >
                {incomeNum == null ? null : previewTier ? (
                  <span style={{ fontWeight: 500, color: HF.sage }}>
                    {t('intent.ami.qualifies', { tier: formatAmiTier(previewTier) })}
                  </span>
                ) : (
                  <span style={{ fontWeight: 500, color: HF.warn }}>
                    {t('intent.ami.overIncome')}
                  </span>
                )}
              </div>
            </>
          )}
        </div>
        <StepCTA
          type="submit"
          form="apply-intent-form"
          disabled={s.loading || s.intentBedrooms === null || !s.intentMoveInDate}
        >
          {s.loading ? t('common.saving') : t('intent.submit')}
        </StepCTA>
      </form>
    </>
  );
}
