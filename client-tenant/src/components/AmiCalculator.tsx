import { useId, useMemo, useState, type FormEvent } from 'react';
import {
  formatAmiTier,
  qualifyAmiTier,
  type AmiTier,
  type MsaKey,
} from '@/lib/ami';
import { CTA } from '@/components/primitives';
import { HF } from '@/styles/tokens';

export interface AmiCalculatorResult {
  tier: AmiTier | null;
  householdSize: number;
  grossAnnualIncome: number;
}

interface AmiCalculatorProps {
  /** MSA to qualify against. Defaults to Las Vegas-Henderson (v1 coverage). */
  msa?: MsaKey;
  /**
   * If provided, the calculator runs in "embedded" mode — household size
   * is supplied by the parent (e.g., StepIntent) and the corresponding input
   * is hidden.
   */
  embeddedHouseholdSize?: number;
  /** Initial gross income for sticky form behavior. */
  initialGrossAnnualIncome?: number | null;
  /** Fires whenever the user calculates a (possibly null) tier. */
  onResult?: (result: AmiCalculatorResult) => void;
  /** Hides the submit CTA for embedded use (parent owns the CTA). */
  hideCta?: boolean;
}

const labelSpanStyle = {
  fontWeight: 500,
  color: HF.ink,
  fontFamily: HF.body,
} as const;

const inputStyle = {
  borderRadius: HF.r.sm,
  border: `1px solid ${HF.border}`,
  padding: '8px 12px',
  fontSize: 14,
  background: HF.paper,
  color: HF.ink,
  fontFamily: HF.body,
  outline: 'none',
} as const;

export function AmiCalculator({
  msa = 'LAS_VEGAS_HENDERSON',
  embeddedHouseholdSize,
  initialGrossAnnualIncome = null,
  onResult,
  hideCta = false,
}: AmiCalculatorProps) {
  const formId = useId();
  const embedded = typeof embeddedHouseholdSize === 'number';

  const [householdStr, setHouseholdStr] = useState<string>(
    embedded ? String(embeddedHouseholdSize) : '2',
  );
  const [incomeStr, setIncomeStr] = useState<string>(
    initialGrossAnnualIncome != null ? String(initialGrossAnnualIncome) : '',
  );
  const [result, setResult] = useState<AmiCalculatorResult | null>(null);

  const householdNum = useMemo(() => {
    const n = Number.parseInt(householdStr, 10);
    return Number.isFinite(n) && n >= 1 ? n : 0;
  }, [householdStr]);

  const effectiveHousehold = embedded
    ? (embeddedHouseholdSize as number)
    : householdNum;

  const incomeNum = useMemo(() => {
    const trimmed = incomeStr.replace(/[$,\s]/g, '');
    const n = Number.parseFloat(trimmed);
    return Number.isFinite(n) ? n : Number.NaN;
  }, [incomeStr]);

  const inputValid =
    Number.isFinite(incomeNum) &&
    incomeNum >= 0 &&
    (embedded || householdNum >= 1);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!inputValid) return;
    const tier = qualifyAmiTier(msa, effectiveHousehold, incomeNum);
    const r: AmiCalculatorResult = {
      tier,
      householdSize: effectiveHousehold,
      grossAnnualIncome: incomeNum,
    };
    setResult(r);
    onResult?.(r);
  }

  return (
    <form
      id={`ami-calc-${formId}`}
      onSubmit={handleSubmit}
      aria-label="AMI eligibility calculator"
      className="p-4 sm:p-6"
      style={{
        background: HF.paper,
        border: `1px solid ${HF.border}`,
        borderRadius: HF.r.md,
        fontFamily: HF.body,
      }}
    >
      <h3
        className="text-base font-semibold"
        style={{ color: HF.ink, fontFamily: HF.display }}
      >
        Am I income-eligible?
      </h3>
      <p className="mt-1 text-sm" style={{ color: HF.ink2 }}>
        Affordable units have an income cap. Answer two questions to see
        which tier you qualify for. We don&apos;t store this unless you apply.
      </p>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {!embedded && (
          <label className="flex flex-col gap-1 text-sm">
            <span style={labelSpanStyle}>Household size</span>
            <input
              type="number"
              min={1}
              max={8}
              step={1}
              required
              value={householdStr}
              onChange={(e) => setHouseholdStr(e.target.value)}
              style={inputStyle}
              aria-label="Household size"
            />
          </label>
        )}

        <label className="flex flex-col gap-1 text-sm">
          <span style={labelSpanStyle}>Gross annual income (USD)</span>
          <input
            type="text"
            inputMode="numeric"
            required
            value={incomeStr}
            onChange={(e) => setIncomeStr(e.target.value)}
            placeholder="e.g. 42000"
            style={inputStyle}
            aria-label="Gross annual income in US dollars"
            aria-invalid={incomeStr.length > 0 && !inputValid}
          />
        </label>
      </div>

      {!hideCta && (
        <div className="mt-4">
          <CTA type="submit" tone="primary" size="sm" disabled={!inputValid}>
            Calculate eligibility
          </CTA>
        </div>
      )}

      {result && (
        <div
          role="status"
          aria-live="polite"
          className="mt-4 p-3 text-sm"
          style={{
            background: HF.cream,
            border: `1px solid ${HF.border}`,
            borderRadius: HF.r.sm,
            color: HF.ink2,
          }}
        >
          {result.tier ? (
            <>
              <div
                className="font-semibold"
                style={{ color: HF.ink, fontFamily: HF.display }}
              >
                You qualify for {formatAmiTier(result.tier)} units
              </div>
              <p className="mt-1" style={{ color: HF.ink2 }}>
                Household of {result.householdSize}, gross income $
                {result.grossAnnualIncome.toLocaleString('en-US')} —
                eligible for any unit at or above the {result.tier}% AMI cap.
              </p>
            </>
          ) : (
            <>
              <div
                className="font-semibold"
                style={{ color: HF.ink, fontFamily: HF.display }}
              >
                Over income for affordable tiers
              </div>
              <p className="mt-1" style={{ color: HF.ink2 }}>
                Your income is above the 80% AMI cap for a household of{' '}
                {result.householdSize}. Market-rate units may still be a fit.
              </p>
            </>
          )}
        </div>
      )}
    </form>
  );
}
