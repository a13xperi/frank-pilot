/**
 * Stub-fallback policy for the screening vendor services.
 *
 * Compliance defaults are fail-loud: a misconfigured production deploy
 * (missing API key) must NOT silently pass every applicant. Stub data is
 * only allowed when one of three explicit conditions is met:
 *
 *   - MOCK_MODE=1            — backtest harness (sets this at script top)
 *   - ALLOW_STUB_SCREENING=1 — explicit dev/demo escape hatch
 *   - NODE_ENV=test          — jest auto-set; unit tests can use stubs
 *
 * Production sets none of these, so a missing key throws and the request
 * surfaces as a hard error instead of a false-positive screening pass.
 */
export function shouldUseScreeningStub(): boolean {
  if (process.env.MOCK_MODE === "1") return true;
  if (process.env.ALLOW_STUB_SCREENING === "1") return true;
  if (process.env.NODE_ENV === "test") return true;
  return false;
}

export const STUB_GATE_ERROR =
  "Screening API key not configured and stub fallback is not enabled. " +
  "Set the appropriate vendor key in production, or set " +
  "ALLOW_STUB_SCREENING=1 for dev/demo runs.";
