import { useId, useMemo, useState, type FormEvent } from 'react';
import {
  formatAmiTier,
  qualifyAmiTier,
  type AmiTier,
  type MsaKey,
} from '@/lib/ami';

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
      className="rounded-lg border border-gray-200 bg-white p-4 sm:p-6"
    >
      <h3 className="text-base font-semibold text-gray-900">
        Am I income-eligible?
      </h3>
      <p className="mt-1 text-sm text-gray-600">
        Affordable units have an income cap. Answer two questions to see
        which tier you qualify for. We don&apos;t store this unless you apply.
      </p>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {!embedded && (
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-gray-700">Household size</span>
            <input
              type="number"
              min={1}
              max={8}
              step={1}
              required
              value={householdStr}
              onChange={(e) => setHouseholdStr(e.target.value)}
              className="rounded border border-gray-300 px-3 py-2"
              aria-label="Household size"
            />
          </label>
        )}

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-gray-700">
            Gross annual income (USD)
          </span>
          <input
            type="text"
            inputMode="numeric"
            required
            value={incomeStr}
            onChange={(e) => setIncomeStr(e.target.value)}
            placeholder="e.g. 42000"
            className="rounded border border-gray-300 px-3 py-2"
            aria-label="Gross annual income in US dollars"
            aria-invalid={incomeStr.length > 0 && !inputValid}
          />
        </label>
      </div>

      {!hideCta && (
        <button
          type="submit"
          disabled={!inputValid}
          className="mt-4 rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:bg-gray-300"
        >
          Calculate eligibility
        </button>
      )}

      {result && (
        <div
          role="status"
          aria-live="polite"
          className="mt-4 rounded border border-gray-200 bg-gray-50 p-3 text-sm"
        >
          {result.tier ? (
            <>
              <div className="font-semibold text-gray-900">
                You qualify for {formatAmiTier(result.tier)} units
              </div>
              <p className="mt-1 text-gray-600">
                Household of {result.householdSize}, gross income $
                {result.grossAnnualIncome.toLocaleString('en-US')} —
                eligible for any unit at or above the {result.tier}% AMI cap.
              </p>
            </>
          ) : (
            <>
              <div className="font-semibold text-gray-900">
                Over income for affordable tiers
              </div>
              <p className="mt-1 text-gray-600">
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
