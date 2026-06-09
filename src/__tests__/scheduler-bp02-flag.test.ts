/**
 * BP-02 verify-cron flag gate.
 *
 * The verify-cron (every 5 min) sweeps the compliance_tape chain by calling
 * the BP-02 TapeService. Until Phase 2 Step 2 wires the canonical service,
 * that service is stubbed to throw "service not wired", so running the cron
 * on a schedule just floods logs with errors. The cron must therefore only
 * register when COMPLIANCE_TAPE_V2_ENABLED === "true".
 *
 * These tests assert all three flag-state branches:
 *   - undefined        → skip (default OFF)
 *   - "false" (string) → skip
 *   - "true"           → register
 *
 * The other five scheduled jobs (rent, late fees, renewals, recerts, TRACS)
 * are always registered and are unaffected by the flag — we assert the
 * verify-cron registration by counting cron.schedule calls against that
 * fixed baseline.
 */

// node-cron is mocked so startScheduler() registers nothing real.
jest.mock("node-cron", () => ({
  __esModule: true,
  default: { schedule: jest.fn() },
}));

jest.mock("../utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

// The scheduler instantiates services at module load; stub their constructors
// so requiring the module never touches a real DB/connection pool.
jest.mock("../modules/recertification/service", () => ({
  RecertificationService: jest.fn().mockImplementation(() => ({})),
}));
jest.mock("../modules/ledger/service", () => ({
  LedgerService: jest.fn().mockImplementation(() => ({})),
}));
jest.mock("../modules/renewal/service", () => ({
  LeaseRenewalService: jest.fn().mockImplementation(() => ({})),
}));
jest.mock("../modules/tape/service", () => ({
  createTapeService: jest.fn(() => ({ verify: jest.fn() })),
}));
jest.mock("../modules/tape/repository", () => ({
  PgTapeRepository: jest.fn().mockImplementation(() => ({})),
}));
// scheduler.ts now instantiates AdverseActionService at module load for the
// FCRA pre-adverse finalizer cron. Stub it so requiring the module never pulls
// config/database (which opens a real pool) into the graph. This test never
// sets FCRA_PRE_ADVERSE_ENABLED, so the finalizer cron stays unregistered and
// BASELINE_CRON_JOBS is unchanged.
jest.mock("../modules/adverse-action/service", () => ({
  AdverseActionService: jest.fn().mockImplementation(() => ({})),
}));

// Number of cron.schedule calls made by the always-on jobs (everything except
// the BP-02 verify-cron): recert reminders, TRACS, monthly rent, late fees,
// renewals. Keep in sync with src/scheduler.ts.
const BASELINE_CRON_JOBS = 5;

const ORIGINAL_FLAG = process.env.COMPLIANCE_TAPE_V2_ENABLED;

/**
 * Set the flag, re-import the scheduler fresh, run it, and return the mocked
 * cron.schedule. The module must be required AFTER the env var is set because
 * the flag is read at registration time inside startScheduler().
 */
function runSchedulerWithFlag(flag: string | undefined) {
  jest.resetModules();
  if (flag === undefined) {
    delete process.env.COMPLIANCE_TAPE_V2_ENABLED;
  } else {
    process.env.COMPLIANCE_TAPE_V2_ENABLED = flag;
  }

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const cron = require("node-cron").default as { schedule: jest.Mock };
  cron.schedule.mockClear();

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { startScheduler } = require("../scheduler");
  startScheduler();

  return cron;
}

afterEach(() => {
  if (ORIGINAL_FLAG === undefined) {
    delete process.env.COMPLIANCE_TAPE_V2_ENABLED;
  } else {
    process.env.COMPLIANCE_TAPE_V2_ENABLED = ORIGINAL_FLAG;
  }
  jest.clearAllMocks();
});

describe("BP-02 verify-cron flag gate", () => {
  it("does NOT register the verify-cron when the flag is unset (default OFF)", () => {
    const cron = runSchedulerWithFlag(undefined);
    expect(cron.schedule).toHaveBeenCalledTimes(BASELINE_CRON_JOBS);
    // No call uses the every-5-minutes verify-cron expression.
    const expressions = cron.schedule.mock.calls.map((c) => c[0]);
    expect(expressions).not.toContain("*/5 * * * *");
  });

  it("does NOT register the verify-cron when the flag is the string \"false\"", () => {
    const cron = runSchedulerWithFlag("false");
    expect(cron.schedule).toHaveBeenCalledTimes(BASELINE_CRON_JOBS);
    const expressions = cron.schedule.mock.calls.map((c) => c[0]);
    expect(expressions).not.toContain("*/5 * * * *");
  });

  it("DOES register the verify-cron when the flag is the string \"true\"", () => {
    const cron = runSchedulerWithFlag("true");
    expect(cron.schedule).toHaveBeenCalledTimes(BASELINE_CRON_JOBS + 1);
    const expressions = cron.schedule.mock.calls.map((c) => c[0]);
    expect(expressions).toContain("*/5 * * * *");
  });
});
