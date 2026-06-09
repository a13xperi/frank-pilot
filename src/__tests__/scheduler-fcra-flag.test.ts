/**
 * FCRA pre-adverse finalizer-cron flag gate.
 *
 * The finalizer (daily 6:00 AM, cron "0 6 * * *") closes out pre-adverse holds
 * whose dispute window has elapsed. Until FCRA_PRE_ADVERSE_ENABLED is on there
 * are no pending_adverse_action rows to finalize, so the cron must stay
 * unregistered — default OFF ⇒ byte-identical scheduler.
 *
 * Asserts all three flag-state branches:
 *   - undefined        → skip (default OFF)
 *   - "false" (string) → skip
 *   - "true"           → register the "0 6 * * *" finalizer cron
 *
 * The finalizer expression "0 6 * * *" is distinct from the monthly rent job
 * "0 6 1 * *", so its presence in cron.schedule's call list is an unambiguous
 * signal. We pin COMPLIANCE_TAPE_V2_ENABLED OFF in every run so the BP-02
 * verify-cron never perturbs the count.
 */

// Make this file a module so its top-level consts are module-scoped and do not
// collide with the script-scoped scheduler-bp02-flag.test.ts (same BASELINE_*).
export {};

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
jest.mock("../modules/adverse-action/service", () => ({
  AdverseActionService: jest.fn().mockImplementation(() => ({
    finalizeDuePreAdverseActions: jest.fn(),
  })),
}));

// Always-on jobs (BP-02 + FCRA finalizer both off): recert reminders, TRACS,
// monthly rent, late fees, renewals. Keep in sync with src/scheduler.ts.
const BASELINE_CRON_JOBS = 5;
const FINALIZER_CRON = "0 6 * * *";

const ORIGINAL_FCRA = process.env.FCRA_PRE_ADVERSE_ENABLED;
const ORIGINAL_TAPE = process.env.COMPLIANCE_TAPE_V2_ENABLED;

/**
 * Set the FCRA flag (BP-02 forced off), re-import the scheduler fresh, run it,
 * and return the mocked cron. The module must be required AFTER env is set
 * because flags are read at registration time inside startScheduler().
 */
function runSchedulerWithFcraFlag(flag: string | undefined) {
  jest.resetModules();
  delete process.env.COMPLIANCE_TAPE_V2_ENABLED; // keep BP-02 cron out of the count
  if (flag === undefined) {
    delete process.env.FCRA_PRE_ADVERSE_ENABLED;
  } else {
    process.env.FCRA_PRE_ADVERSE_ENABLED = flag;
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
  if (ORIGINAL_FCRA === undefined) delete process.env.FCRA_PRE_ADVERSE_ENABLED;
  else process.env.FCRA_PRE_ADVERSE_ENABLED = ORIGINAL_FCRA;
  if (ORIGINAL_TAPE === undefined) delete process.env.COMPLIANCE_TAPE_V2_ENABLED;
  else process.env.COMPLIANCE_TAPE_V2_ENABLED = ORIGINAL_TAPE;
  jest.clearAllMocks();
});

describe("FCRA pre-adverse finalizer-cron flag gate", () => {
  it("does NOT register the finalizer cron when the flag is unset (default OFF)", () => {
    const cron = runSchedulerWithFcraFlag(undefined);
    expect(cron.schedule).toHaveBeenCalledTimes(BASELINE_CRON_JOBS);
    const expressions = cron.schedule.mock.calls.map((c) => c[0]);
    expect(expressions).not.toContain(FINALIZER_CRON);
  });

  it("does NOT register the finalizer cron when the flag is the string \"false\"", () => {
    const cron = runSchedulerWithFcraFlag("false");
    expect(cron.schedule).toHaveBeenCalledTimes(BASELINE_CRON_JOBS);
    const expressions = cron.schedule.mock.calls.map((c) => c[0]);
    expect(expressions).not.toContain(FINALIZER_CRON);
  });

  it("DOES register the \"0 6 * * *\" finalizer cron when the flag is \"true\"", () => {
    const cron = runSchedulerWithFcraFlag("true");
    expect(cron.schedule).toHaveBeenCalledTimes(BASELINE_CRON_JOBS + 1);
    const expressions = cron.schedule.mock.calls.map((c) => c[0]);
    expect(expressions).toContain(FINALIZER_CRON);
  });

  it("the finalizer expression is distinct from the monthly rent job (no collision)", () => {
    const cron = runSchedulerWithFcraFlag("true");
    const expressions = cron.schedule.mock.calls.map((c) => c[0]);
    expect(expressions).toContain("0 6 1 * *"); // monthly rent — always on
    expect(expressions).toContain(FINALIZER_CRON); // finalizer — flag on
    // exactly one registration of each
    expect(expressions.filter((e) => e === FINALIZER_CRON)).toHaveLength(1);
    expect(expressions.filter((e) => e === "0 6 1 * *")).toHaveLength(1);
  });
});
