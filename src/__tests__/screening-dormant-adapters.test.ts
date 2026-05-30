/**
 * Fail-loud contract for the three dormant screening adapters that are
 * built-but-not-yet-wired into runFullScreening:
 *
 *   - WorkNumberService          (Equifax employment/income)
 *   - PlaidIncomeService         (bank-linked income)
 *   - NsopwDirectService         (direct sex-offender registry)
 *
 * The compliance invariant (stub-policy.ts): a KEYLESS production deploy must
 * NEVER silently pass an applicant. Stub data is only allowed behind an
 * explicit gate — MOCK_MODE=1, ALLOW_STUB_SCREENING=1, or NODE_ENV=test.
 * Otherwise the missing key must surface as a hard error rather than a
 * false-positive verdict.
 *
 * These tests lock that contract so the Phase-4 vendor wire-up (which swaps
 * each adapter's "not yet configured" throw for a real API call) cannot
 * regress it. They are also the regression guard for the work-number.ts
 * silent-pass: before the stub gate it returned result:"verified"
 * unconditionally when keyless.
 *
 * Two failure shapes, both fail-loud:
 *   - WorkNumber has no internal try/catch → the gate error PROPAGATES (the
 *     Phase-4 integrator decides aggregation when it wires WorkNumber in).
 *   - Plaid / NSOPW catch internally → the gate error becomes a HOLD verdict
 *     (review_required), matching credit-check.ts's catch → could_not_screen.
 *
 * NOTE: jest sets NODE_ENV=test, which itself opens the stub gate. So the
 * fail-loud cases explicitly flip NODE_ENV=production and clear the escape
 * hatches; env is saved/restored per test.
 */

import { WorkNumberService } from "../modules/screening/work-number";
import { PlaidIncomeService } from "../modules/screening/income-verification-plaid";
import { NsopwDirectService } from "../modules/screening/nsopw-direct";
import { STUB_GATE_ERROR } from "../modules/screening/stub-policy";

jest.mock("../utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

// Every env var these adapters or the stub policy read.
const ENV_KEYS = [
  "NODE_ENV",
  "MOCK_MODE",
  "ALLOW_STUB_SCREENING",
  "WORK_NUMBER_API_KEY",
  "WORK_NUMBER_API_URL",
  "PLAID_CLIENT_ID",
  "PLAID_SECRET",
  "NSOPW_API_KEY",
  "NSOPW_API_URL",
];

const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  // Guarantee a keyless baseline so every adapter takes the no-key branch.
  for (const k of ENV_KEYS) if (k !== "NODE_ENV") delete process.env[k];
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  jest.restoreAllMocks();
});

/** Close the stub gate: simulate a real production deploy with no vendor key. */
function disableStub() {
  process.env.NODE_ENV = "production";
  delete process.env.MOCK_MODE;
  delete process.env.ALLOW_STUB_SCREENING;
}

/** Open the gate the dev/demo way (explicit escape hatch, still no key). */
function allowStubViaFlag() {
  process.env.NODE_ENV = "production";
  delete process.env.MOCK_MODE;
  process.env.ALLOW_STUB_SCREENING = "1";
}

function person() {
  return { firstName: "Jane", lastName: "Doe", dateOfBirth: "1990-06-15" };
}
function wnInput() {
  return { ...person(), ssn: "123-45-6789" };
}

// ── WorkNumberService — propagating fail-loud ───────────────────────────────

describe("WorkNumberService.verifyEmployment() — fail-loud", () => {
  it("returns verified via stub when the gate is open (NODE_ENV=test)", async () => {
    // jest default NODE_ENV=test opens the gate
    const r = await new WorkNumberService().verifyEmployment(wnInput());
    expect(r.result).toBe("verified");
  });

  it("THROWS instead of silently passing when keyless in production (regression guard)", async () => {
    disableStub();
    await expect(
      new WorkNumberService().verifyEmployment(wnInput())
    ).rejects.toThrow(STUB_GATE_ERROR);
  });

  it("returns the stub when ALLOW_STUB_SCREENING=1 explicitly opts in", async () => {
    allowStubViaFlag();
    const r = await new WorkNumberService().verifyEmployment(wnInput());
    expect(r.result).toBe("verified");
  });
});

// ── PlaidIncomeService — catch → HOLD ───────────────────────────────────────

describe("PlaidIncomeService.verifyIncome() — fail-loud", () => {
  it("returns verified via stub when the gate is open (NODE_ENV=test)", async () => {
    const r = await new PlaidIncomeService().verifyIncome(person());
    expect(r.result).toBe("verified");
  });

  it("HOLDS (review_required, not verified) when keyless in production", async () => {
    disableStub();
    const r = await new PlaidIncomeService().verifyIncome(person());
    expect(r.result).toBe("review_required");
    expect(r.verified).toBe(false);
  });

  it("returns the stub when ALLOW_STUB_SCREENING=1 explicitly opts in", async () => {
    allowStubViaFlag();
    const r = await new PlaidIncomeService().verifyIncome(person());
    expect(r.result).toBe("verified");
  });
});

// ── NsopwDirectService — catch → HOLD ───────────────────────────────────────

describe("NsopwDirectService.check() — fail-loud", () => {
  it("returns no_match via stub when the gate is open (NODE_ENV=test)", async () => {
    const r = await new NsopwDirectService().check(person());
    expect(r.result).toBe("no_match");
  });

  it("HOLDS (review_required, no auto-clear) when keyless in production", async () => {
    disableStub();
    const r = await new NsopwDirectService().check(person());
    expect(r.result).toBe("review_required");
    expect(r.match).toBe(false);
  });

  it("returns the stub when ALLOW_STUB_SCREENING=1 explicitly opts in", async () => {
    allowStubViaFlag();
    const r = await new NsopwDirectService().check(person());
    expect(r.result).toBe("no_match");
  });
});
