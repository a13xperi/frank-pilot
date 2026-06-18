/**
 * Work-order escalation tests (D1, compliance-ledger-finish).
 *
 * Two layers, mirroring the acquisitions-recert-compliance test pattern:
 *   1. Pure logic (classifyWorkOrder / assembleManagerAlert / daysBetween) —
 *      deterministic, clock injected, no IO.
 *   2. Service (WorkOrderEscalationService) — `query` is mocked so nothing
 *      touches Postgres, and a MOCK notifier proves the pluggable interface +
 *      alert-payload assembly without wiring a live email/SMS sender.
 */

import type { QueryResult, QueryResultRow } from "pg";
import { query } from "../config/database";
import {
  classifyWorkOrder,
  assembleManagerAlert,
  daysBetween,
  DEFAULT_STALE_THRESHOLDS,
  WorkOrderEscalationService,
  LoggingWorkOrderNotifier,
  type WorkOrderRow,
  type WorkOrderNotifier,
  type ManagerAlertPayload,
} from "../modules/maintenance/escalation";

jest.mock("../config/database", () => ({ query: jest.fn() }));
jest.mock("../utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const mockQuery = query as jest.MockedFunction<typeof query>;

function qr(rows: unknown[]): QueryResult<QueryResultRow> {
  return { rows, rowCount: rows.length } as unknown as QueryResult<QueryResultRow>;
}

const NOW = new Date("2026-06-18T12:00:00.000Z");

/** Build a work-order row (fresh by default), with overridable fields. */
function makeRow(overrides: Partial<WorkOrderRow> = {}): WorkOrderRow {
  return {
    id: "wo-1",
    property_id: "prop-1",
    title: "Leaky faucet",
    status: "submitted",
    priority: "routine",
    is_emergency: false,
    created_at: NOW.toISOString(),
    started_at: null,
    assigned_to: null,
    estimated_completion_date: null,
    is_outstanding: false,
    escalation_level: 0,
    manager_alerted_at: null,
    ...overrides,
  };
}

/** ISO string for `days` before NOW. */
function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

beforeEach(() => {
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// 1. Pure logic
// ---------------------------------------------------------------------------
describe("daysBetween", () => {
  it("floors to whole days and never goes negative", () => {
    const day = 24 * 60 * 60 * 1000;
    expect(daysBetween(0, 3 * day + 1000)).toBe(3);
    expect(daysBetween(5 * day, 0)).toBe(0); // negative clamped
    expect(daysBetween(0, 0)).toBe(0);
  });
});

describe("classifyWorkOrder", () => {
  it("a fresh submitted order is NOT outstanding", () => {
    const v = classifyWorkOrder(makeRow({ created_at: daysAgo(1) }), NOW);
    expect(v.outstanding).toBe(false);
    expect(v.shouldEscalate).toBe(false);
    expect(v.reason).toBeNull();
  });

  it("submitted and never started past the unstarted threshold is outstanding", () => {
    const v = classifyWorkOrder(
      makeRow({ status: "submitted", created_at: daysAgo(4) }),
      NOW
    );
    expect(v.ageDays).toBe(4);
    expect(v.outstanding).toBe(true);
    expect(v.reason).toBe("unstarted_stale");
    expect(v.shouldEscalate).toBe(true);
    expect(v.nextLevel).toBe(1);
  });

  it("assigned-but-not-started also counts as unstarted_stale", () => {
    const v = classifyWorkOrder(
      makeRow({ status: "assigned", assigned_to: "tech-1", created_at: daysAgo(5) }),
      NOW
    );
    expect(v.reason).toBe("unstarted_stale");
    expect(v.outstanding).toBe(true);
  });

  it("in_progress (started) does NOT trip the unstarted rule, only the longer in_progress one", () => {
    // 5 days in progress: under inProgressDays (7) → not stale.
    const young = classifyWorkOrder(
      makeRow({
        status: "in_progress",
        started_at: daysAgo(5),
        created_at: daysAgo(5),
      }),
      NOW
    );
    expect(young.outstanding).toBe(false);

    // 8 days in progress → stale.
    const old = classifyWorkOrder(
      makeRow({
        status: "in_progress",
        started_at: daysAgo(8),
        created_at: daysAgo(8),
      }),
      NOW
    );
    expect(old.outstanding).toBe(true);
    expect(old.reason).toBe("in_progress_stale");
  });

  it("an emergency goes stale after one day and is the most-severe reason", () => {
    const v = classifyWorkOrder(
      makeRow({
        priority: "emergency",
        is_emergency: true,
        status: "assigned",
        created_at: daysAgo(2),
      }),
      NOW
    );
    expect(v.reason).toBe("emergency_stale");
    expect(v.outstanding).toBe(true);
    expect(v.shouldEscalate).toBe(true);
  });

  it("a breached promised ETA makes an otherwise-fresh order outstanding", () => {
    const v = classifyWorkOrder(
      makeRow({
        status: "in_progress",
        started_at: daysAgo(1),
        created_at: daysAgo(1),
        estimated_completion_date: daysAgo(1), // promised yesterday, still open
      }),
      NOW
    );
    expect(v.promiseBreached).toBe(true);
    expect(v.outstanding).toBe(true);
    expect(v.reason).toBe("promise_breached");
    expect(v.shouldEscalate).toBe(true);
    expect(v.nextLevel).toBe(1); // 0 -> breach pushes to 1
  });

  it("a future ETA is not a breach", () => {
    const future = new Date(NOW.getTime() + 3 * 24 * 60 * 60 * 1000).toISOString();
    const v = classifyWorkOrder(
      makeRow({
        status: "in_progress",
        started_at: daysAgo(1),
        created_at: daysAgo(1),
        estimated_completion_date: future,
      }),
      NOW
    );
    expect(v.promiseBreached).toBe(false);
    expect(v.outstanding).toBe(false);
  });

  it("escalation is idempotent: an already-escalated stale order does NOT re-escalate", () => {
    const v = classifyWorkOrder(
      makeRow({
        status: "submitted",
        created_at: daysAgo(10),
        is_outstanding: true,
        escalation_level: 1, // already alerted at level 1
      }),
      NOW
    );
    expect(v.outstanding).toBe(true);
    expect(v.shouldEscalate).toBe(false); // no re-page at the same level
    expect(v.nextLevel).toBe(1);
  });

  it("a promise breach re-escalates one level beyond the current", () => {
    const v = classifyWorkOrder(
      makeRow({
        status: "in_progress",
        started_at: daysAgo(2),
        created_at: daysAgo(2),
        estimated_completion_date: daysAgo(1),
        is_outstanding: true,
        escalation_level: 1,
      }),
      NOW
    );
    expect(v.shouldEscalate).toBe(true);
    expect(v.nextLevel).toBe(2);
  });

  it("a completed order is never outstanding even if old", () => {
    const v = classifyWorkOrder(
      makeRow({ status: "completed", created_at: daysAgo(30) }),
      NOW
    );
    expect(v.outstanding).toBe(false);
    expect(v.shouldEscalate).toBe(false);
    expect(v.reason).toBeNull();
  });

  it("respects custom thresholds", () => {
    const v = classifyWorkOrder(
      makeRow({ status: "submitted", created_at: daysAgo(2) }),
      NOW,
      { ...DEFAULT_STALE_THRESHOLDS, unstartedDays: 1 }
    );
    expect(v.outstanding).toBe(true);
  });
});

describe("assembleManagerAlert", () => {
  it("builds a payload carrying the order, reason, age and a human summary", () => {
    const row = makeRow({
      id: "wo-77",
      title: "No heat in 4B",
      priority: "emergency",
      is_emergency: true,
      status: "assigned",
      assigned_to: "tech-9",
      created_at: daysAgo(2),
      estimated_completion_date: daysAgo(1),
    });
    const verdict = classifyWorkOrder(row, NOW);
    const payload = assembleManagerAlert(row, verdict, NOW);

    expect(payload.workOrderId).toBe("wo-77");
    expect(payload.propertyId).toBe("prop-1");
    expect(payload.isEmergency).toBe(true);
    expect(payload.reason).toBe("emergency_stale");
    expect(payload.ageDays).toBe(2);
    expect(payload.assignedTo).toBe("tech-9");
    expect(payload.estimatedCompletionDate).toBe(daysAgo(1).slice(0, 10));
    expect(payload.summary).toContain("No heat in 4B");
    expect(payload.summary).toContain("EMERGENCY");
    expect(payload.generatedAt).toBe(NOW.toISOString());
  });
});

// ---------------------------------------------------------------------------
// 2. Service (mocked query + mock notifier)
// ---------------------------------------------------------------------------
describe("WorkOrderEscalationService.sweepStaleWorkOrders", () => {
  it("flags stale orders, persists state, and alerts the manager via the notifier", async () => {
    const stale = makeRow({
      id: "wo-stale",
      status: "submitted",
      created_at: daysAgo(5),
    });
    const fresh = makeRow({
      id: "wo-fresh",
      status: "submitted",
      created_at: daysAgo(1),
    });

    // 1st query = SELECT open orders; subsequent = UPDATE persistVerdict (one per row).
    mockQuery.mockResolvedValueOnce(qr([stale, fresh])); // SELECT
    mockQuery.mockResolvedValue(qr([])); // UPDATEs

    const sent: ManagerAlertPayload[] = [];
    const notifier: WorkOrderNotifier = {
      notifyManager: jest.fn(async (p: ManagerAlertPayload) => {
        sent.push(p);
      }),
    };

    const svc = new WorkOrderEscalationService(notifier);
    const result = await svc.sweepStaleWorkOrders(NOW);

    expect(result.scanned).toBe(2);
    expect(result.outstanding).toBe(1);
    expect(result.escalated).toBe(1);
    expect(notifier.notifyManager).toHaveBeenCalledTimes(1);
    expect(sent[0]!.workOrderId).toBe("wo-stale");
    expect(sent[0]!.reason).toBe("unstarted_stale");

    // SELECT + one UPDATE per scanned row.
    expect(mockQuery).toHaveBeenCalledTimes(1 + 2);
    const selectSql = mockQuery.mock.calls[0]![0] as string;
    expect(selectSql).toContain("FROM work_orders");
    expect(selectSql).toContain("status IN");
  });

  it("does NOT alert when nothing is stale", async () => {
    mockQuery.mockResolvedValueOnce(qr([makeRow({ created_at: daysAgo(1) })]));
    mockQuery.mockResolvedValue(qr([]));
    const notifier: WorkOrderNotifier = { notifyManager: jest.fn() };

    const result = await new WorkOrderEscalationService(notifier).sweepStaleWorkOrders(NOW);

    expect(result.outstanding).toBe(0);
    expect(result.escalated).toBe(0);
    expect(notifier.notifyManager).not.toHaveBeenCalled();
  });

  it("counts promise breaches and re-escalates", async () => {
    const breached = makeRow({
      id: "wo-breach",
      status: "in_progress",
      started_at: daysAgo(2),
      created_at: daysAgo(2),
      estimated_completion_date: daysAgo(1),
      is_outstanding: true,
      escalation_level: 1,
    });
    mockQuery.mockResolvedValueOnce(qr([breached]));
    mockQuery.mockResolvedValue(qr([]));
    const notifier: WorkOrderNotifier = { notifyManager: jest.fn() };

    const result = await new WorkOrderEscalationService(notifier).sweepStaleWorkOrders(NOW);

    expect(result.promiseBreaches).toBe(1);
    expect(result.escalated).toBe(1);
    const payload = (notifier.notifyManager as jest.Mock).mock.calls[0][0] as ManagerAlertPayload;
    expect(payload.escalationLevel).toBe(2);
    expect(payload.promiseBreached).toBe(true);
  });

  it("a notifier failure does not abort the sweep", async () => {
    mockQuery.mockResolvedValueOnce(qr([makeRow({ created_at: daysAgo(5) })]));
    mockQuery.mockResolvedValue(qr([]));
    const notifier: WorkOrderNotifier = {
      notifyManager: jest.fn().mockRejectedValue(new Error("smtp down")),
    };

    const result = await new WorkOrderEscalationService(notifier).sweepStaleWorkOrders(NOW);

    // Detection + persistence still happened; escalated count not incremented on failure.
    expect(result.outstanding).toBe(1);
    expect(result.escalated).toBe(0);
  });
});

describe("WorkOrderEscalationService.setEstimatedCompletionDate", () => {
  it("persists the ETA and returns the stored date", async () => {
    mockQuery.mockResolvedValueOnce(
      qr([{ id: "wo-1", estimated_completion_date: "2026-07-01" }])
    );
    const svc = new WorkOrderEscalationService();
    const out = await svc.setEstimatedCompletionDate("wo-1", "2026-07-01");
    expect(out.estimatedCompletionDate).toBe("2026-07-01");
    const sql = mockQuery.mock.calls[0]![0] as string;
    expect(sql).toContain("estimated_completion_date = $2");
  });

  it("throws when the order does not exist", async () => {
    mockQuery.mockResolvedValueOnce(qr([]));
    const svc = new WorkOrderEscalationService();
    await expect(svc.setEstimatedCompletionDate("nope", "2026-07-01")).rejects.toThrow(
      "Work order not found"
    );
  });
});

describe("LoggingWorkOrderNotifier", () => {
  it("is the default and does not throw (log-only, no live send)", async () => {
    const n = new LoggingWorkOrderNotifier();
    await expect(
      n.notifyManager({
        workOrderId: "wo-1",
        propertyId: "prop-1",
        title: "t",
        priority: "routine",
        isEmergency: false,
        status: "submitted",
        ageDays: 5,
        escalationLevel: 1,
        reason: "unstarted_stale",
        promiseBreached: false,
        estimatedCompletionDate: null,
        assignedTo: null,
        summary: "s",
        generatedAt: NOW.toISOString(),
      })
    ).resolves.toBeUndefined();
  });
});
