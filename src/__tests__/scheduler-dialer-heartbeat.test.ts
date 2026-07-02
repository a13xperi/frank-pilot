/**
 * Backlog #12 + #11 scheduler halves.
 *
 * #12 — the dialer cron callback must beat service_heartbeats on EVERY
 * successful tick, including the quiet ones (queue_empty/paced) that the log
 * line suppresses — the beat is exactly what distinguishes a quiet dialer from
 * a dead one. A failed tick must NOT beat (a beat would mask the death).
 *
 * #11 — stopScheduler() stops every registered cron task so a SIGTERM'd
 * instance can't start a new money job mid-drain.
 */
export {};

jest.mock("node-cron", () => {
  const schedule = jest.fn();
  const getTasks = jest.fn();
  return { __esModule: true, default: { schedule, getTasks }, schedule, getTasks };
});

jest.mock("../utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.mock("../utils/heartbeat", () => ({
  recordHeartbeat: jest.fn().mockResolvedValue(undefined),
  DIALER_HEARTBEAT: "outbound_dialer_tick",
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
  AdverseActionService: jest.fn().mockImplementation(() => ({})),
}));
jest.mock("../modules/maintenance/escalation", () => ({
  WorkOrderEscalationService: jest.fn().mockImplementation(() => ({})),
}));
jest.mock("../modules/outbound-validation/dialer", () => ({
  runDialerTick: jest.fn(),
  sweepStuckCalls: jest.fn(),
}));
jest.mock("../modules/follow-ups/dialer", () => ({
  runFollowupTick: jest.fn(),
}));
jest.mock("../modules/outbound-validation/report", () => ({
  pushReportToNotion: jest.fn(),
}));
jest.mock("../config/database", () => ({
  getClient: jest.fn(),
}));

import cron from "node-cron";
import { startScheduler, stopScheduler } from "../scheduler";
import { recordHeartbeat } from "../utils/heartbeat";
import { runDialerTick } from "../modules/outbound-validation/dialer";

const scheduleMock = cron.schedule as jest.Mock;
const getTasksMock = cron.getTasks as jest.Mock;
const beatMock = recordHeartbeat as jest.Mock;
const tickMock = runDialerTick as jest.Mock;

const DIALER_CRON = "*/5 9-19 * * *";
const ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ENV };
  jest.clearAllMocks();
});

function dialerCallback(): (() => Promise<void>) {
  process.env.FRANK_OUTBOUND_ENABLED = "true";
  startScheduler();
  const call = scheduleMock.mock.calls.find((c) => c[0] === DIALER_CRON);
  expect(call).toBeDefined();
  return call![1];
}

describe("dialer tick heartbeat (#12)", () => {
  it("beats on a successful tick — including quiet queue_empty ticks", async () => {
    tickMock.mockResolvedValue({ action: "queue_empty" });
    const tick = dialerCallback();

    await tick();

    expect(beatMock).toHaveBeenCalledWith("outbound_dialer_tick", {
      action: "queue_empty",
    });
  });

  it("does NOT beat when the tick throws (a beat would mask the death)", async () => {
    tickMock.mockRejectedValue(new Error("sage down"));
    const tick = dialerCallback();

    await tick();

    expect(beatMock).not.toHaveBeenCalled();
  });
});

describe("stopScheduler (#11)", () => {
  it("stops every registered task", () => {
    const t1 = { stop: jest.fn() };
    const t2 = { stop: jest.fn() };
    getTasksMock.mockReturnValue(
      new Map([
        ["a", t1],
        ["b", t2],
      ])
    );

    stopScheduler();

    expect(t1.stop).toHaveBeenCalled();
    expect(t2.stop).toHaveBeenCalled();
  });
});
