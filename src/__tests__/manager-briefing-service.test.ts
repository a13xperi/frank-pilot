/**
 * Unit tests for src/modules/manager/service.ts.
 *
 * DB fully mocked (house pattern). These pin two things that matter:
 *   1. The aggregation shape — KPIs, pipeline, attention, properties all
 *      surface correctly from the underlying query rows.
 *   2. Property scoping — a scoped role (leasing-style with property_ids) gets
 *      a `= ANY($n)` filter on every query and never a global count; a scoped
 *      role with NO properties gets all-zero (deny-all), never the whole
 *      portfolio.
 */

const mockQuery = jest.fn();
jest.mock("../config/database", () => ({
  query: (...args: unknown[]) => mockQuery(...args),
}));

import { ManagerBriefingService } from "../modules/manager/service";
import type { AuthRequest } from "../middleware/auth";

const svc = new ManagerBriefingService();
const AT = "2026-06-12T17:00:00.000Z";

function reqWith(role: string, propertyIds: string[] = []): AuthRequest {
  return { user: { id: "u1", role, propertyIds } } as unknown as AuthRequest;
}

const sql = (): string[] => mockQuery.mock.calls.map((c) => String(c[0]));
const paramsOf = (): unknown[][] => mockQuery.mock.calls.map((c) => (c[1] as unknown[]) ?? []);

beforeEach(() => {
  jest.clearAllMocks();
});

/** Default every query to a benign empty-ish result. */
function stubAllEmpty() {
  mockQuery.mockResolvedValue({ rows: [{ n: 0, households: 0, past_due: 0 }] });
}

describe("getBriefing — global scope (asset_manager, no property_ids)", () => {
  it("assembles KPIs, pipeline, attention and properties from query rows", async () => {
    // Order of queries follows the Promise.all in getBriefing + attention().
    // We don't rely on exact ordering for assertions below; instead we route
    // by SQL content via a mock implementation.
    // Route by unique select-aliases / select lists, most-specific first.
    // (The snapshot SQL embeds a correlated COUNT(*) FROM work_orders subquery,
    // so it must be matched before the work-order count routes.)
    mockQuery.mockImplementation(async (text: string) => {
      const t = String(text);
      if (t.includes("open_work_orders")) {
        return { rows: [{ id: "p1", name: "Donna Louise", open_work_orders: 3, delinquent_households: 2, past_due_rent: 1500 }] };
      }
      if (t.includes("AS households")) return { rows: [{ households: 11, past_due: 4321 }] };
      if (t.includes("w.id, w.title")) {
        return { rows: [{ id: "wo1", title: "No heat", unit_number: "4B", property_name: "Donna Louise" }] };
      }
      if (t.includes("r.id, r.tenant_name")) {
        return { rows: [{ id: "rc1", tenant_name: "Jane Doe", cutoff_date: "2026-06-01", property_name: "Owens" }] };
      }
      if (t.includes("is_emergency = TRUE") && t.includes("COUNT(*)")) return { rows: [{ n: 2 }] };
      if (t.includes("FROM work_orders w") && t.includes("COUNT(*)")) return { rows: [{ n: 9 }] };
      if (t.includes("anniversary_date BETWEEN")) return { rows: [{ n: 8 }] };
      if (t.includes("FROM recertifications r") && t.includes("COUNT(*)")) return { rows: [{ n: 3 }] };
      if (t.includes("FROM move_outs m")) return { rows: [{ n: 4 }] };
      if (t.includes("screening_review")) return { rows: [{ n: 5 }] };
      if (t.includes("tier1_review")) return { rows: [{ n: 6 }] };
      if (t.includes("FROM voice_intake_calls")) return { rows: [{ n: 7 }] };
      return { rows: [{ n: 0, households: 0, past_due: 0 }] };
    });

    const b = await svc.getBriefing(reqWith("asset_manager"), AT);

    expect(b.kpis).toEqual({
      openWorkOrders: 9,
      emergencyWorkOrders: 2,
      overdueFollowUps: 3,
      activeTurns: 4,
      delinquentHouseholds: 11,
      pastDueRent: 4321,
    });
    expect(b.pipeline).toEqual({
      screeningReview: 5,
      pendingApprovals: 6,
      voiceCallbacks: 7,
      upcomingRecerts: 8,
    });
    expect(b.scope).toEqual({ global: true, propertyCount: null });
    expect(b.properties).toEqual([
      { propertyId: "p1", name: "Donna Louise", openWorkOrders: 3, delinquentHouseholds: 2, pastDueRent: 1500 },
    ]);

    // Attention: emergency + overdue recert are high and sorted first; the
    // three non-zero aggregates follow as medium/medium/low.
    const kinds = b.attention.map((a) => a.kind);
    expect(kinds.slice(0, 2)).toEqual(
      expect.arrayContaining(["emergency_work_order", "overdue_recertification"])
    );
    expect(kinds).toEqual(
      expect.arrayContaining(["screening_review", "pending_approvals", "voice_callbacks"])
    );
    // severities are non-decreasing (high → medium → low)
    const rank = { high: 0, medium: 1, low: 2 } as const;
    const seq = b.attention.map((a) => rank[a.severity]);
    expect([...seq]).toEqual([...seq].sort((x, y) => x - y));
  });
});

describe("property scoping", () => {
  it("scoped role with property_ids filters every scoped query with = ANY($n)", async () => {
    stubAllEmpty();
    await svc.getBriefing(reqWith("senior_manager", ["pA", "pB"]), AT);

    // Every COUNT/list query that has a property column should carry the ANY filter.
    const scopedQueries = sql().filter(
      (s) => s.includes("property_id") || s.includes("p.id =") || s.includes("ON a.property_id")
    );
    expect(scopedQueries.length).toBeGreaterThan(0);
    expect(scopedQueries.every((s) => s.includes("= ANY("))).toBe(true);

    // The scope param (the property id array) is bound on those queries.
    const anyArrayBound = paramsOf().some((p) => Array.isArray(p[p.length - 1]) && (p[p.length - 1] as string[]).includes("pA"));
    expect(anyArrayBound).toBe(true);

    // voice_intake_calls has no property column — a scoped role must NOT get a
    // global count there. The voiceCallbacks query should be skipped entirely.
    expect(sql().some((s) => s.includes("FROM voice_intake_calls"))).toBe(false);
  });

  it("scoped role with NO properties denies all — zeros, no portfolio leak", async () => {
    stubAllEmpty();
    const b = await svc.getBriefing(reqWith("senior_manager", []), AT);

    expect(b.kpis.openWorkOrders).toBe(0);
    expect(b.kpis.delinquentHouseholds).toBe(0);
    expect(b.pipeline.screeningReview).toBe(0);
    expect(b.properties).toEqual([]);
    expect(b.attention).toEqual([]);
    expect(b.scope).toEqual({ global: false, propertyCount: 0 });
  });
});
