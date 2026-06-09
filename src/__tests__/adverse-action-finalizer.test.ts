/**
 * Tests for AdverseActionService.finalizeDuePreAdverseActions()
 * (src/modules/adverse-action/service.ts — pre-adverse-action window finalizer).
 *
 * The daily 6 AM scheduler calls this to close out every pre-adverse hold whose
 * dispute window has elapsed. Each due application is CAS-moved
 * pending_adverse_action -> screening_failed (system actor) and — ONLY if the
 * CAS wins — sent the final § 1681m notice carrying the stored pre_adverse
 * reason_detail (preview === sent).
 *
 * Load-bearing guarantees under test:
 *   - side effects are gated on the CAS result, not the SELECT (TOCTOU-safe:
 *     overlapping runs / multiple instances finalize each app exactly once)
 *   - the final notice reuses the pre_adverse reason_detail (preview === sent)
 *   - system actor -> actorId undefined (nullable UUID FK)
 *   - one bad application never stalls the sweep (per-row try/catch)
 *   - empty due set is a clean no-op
 */

jest.mock("../config/database", () => ({ query: jest.fn(), transaction: jest.fn() }));
jest.mock("../utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock("../middleware/audit", () => ({
  writeAuditLog: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../modules/integrations/twilio", () => ({
  TwilioService: jest.fn().mockImplementation(() => ({
    notifyDenied: jest.fn().mockResolvedValue(undefined),
  })),
}));
jest.mock("../modules/screening/state-machine", () => ({
  transitionApplicationStatus: jest.fn(),
}));

import { AdverseActionService } from "../modules/adverse-action/service";
import { query } from "../config/database";
import { transitionApplicationStatus } from "../modules/screening/state-machine";

const mockQuery = query as jest.MockedFunction<typeof query>;
const mockTransition = transitionApplicationStatus as jest.MockedFunction<
  typeof transitionApplicationStatus
>;

function mockDueRows(rows: Array<{ id: string; pre_adverse_reason_detail: string | null }>) {
  mockQuery.mockResolvedValueOnce({ rows } as any);
}

describe("AdverseActionService.finalizeDuePreAdverseActions()", () => {
  let service: AdverseActionService;
  let sendNoticeSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AdverseActionService();
    // Isolate the finalizer from sendNotice's own DB/SMS work — that path is
    // covered by adverse-action-service.test.ts.
    sendNoticeSpy = jest
      .spyOn(service, "sendNotice")
      .mockResolvedValue({
        noticeId: "final-notice",
        applicationId: "x",
        sentAt: new Date("2026-06-15T06:00:00Z"),
        reason: "screening_failed",
      });
  });

  it("is a clean no-op when nothing is due", async () => {
    mockDueRows([]);

    const stats = await service.finalizeDuePreAdverseActions();

    expect(stats).toEqual({ scanned: 0, finalized: 0, noticesSent: 0 });
    expect(mockTransition).not.toHaveBeenCalled();
    expect(sendNoticeSpy).not.toHaveBeenCalled();
  });

  it("SELECTs only due pending_adverse_action rows with the pre_adverse reason_detail", async () => {
    mockDueRows([]);

    await service.finalizeDuePreAdverseActions();

    const sql = mockQuery.mock.calls[0]![0] as string;
    expect(sql).toMatch(/status = 'pending_adverse_action'/);
    expect(sql).toMatch(/adverse_action_eligible_at IS NOT NULL/);
    expect(sql).toMatch(/adverse_action_eligible_at <= NOW\(\)/);
    // correlated subquery pulls the most recent pre_adverse notice's reason_detail
    expect(sql).toMatch(/stage = 'pre_adverse'/);
    expect(sql).toMatch(/reason_detail/);
  });

  it("CAS-finalizes a due row and sends the final notice with the stored reason_detail (preview === sent)", async () => {
    mockDueRows([{ id: "app-1", pre_adverse_reason_detail: "Automated screening denial: failed credit check" }]);
    mockTransition.mockResolvedValue({ changed: true, status: "screening_failed" } as any);

    const stats = await service.finalizeDuePreAdverseActions();

    expect(mockTransition).toHaveBeenCalledWith(
      expect.objectContaining({
        applicationId: "app-1",
        from: "pending_adverse_action",
        to: "screening_failed",
        trigger: "adverse_action_finalized",
        actorId: undefined, // system actor — nullable UUID FK
        actorRole: "system",
      })
    );
    expect(sendNoticeSpy).toHaveBeenCalledWith(
      "app-1",
      null,
      "system",
      "screening_failed",
      "Automated screening denial: failed credit check"
    );
    expect(stats).toEqual({ scanned: 1, finalized: 1, noticesSent: 1 });
  });

  it("does NOT send the final notice when the CAS is lost (changed:false) — exactly-once", async () => {
    mockDueRows([{ id: "app-1", pre_adverse_reason_detail: "x" }]);
    mockTransition.mockResolvedValue({ changed: false, status: "pending_adverse_action" } as any);

    const stats = await service.finalizeDuePreAdverseActions();

    expect(sendNoticeSpy).not.toHaveBeenCalled();
    expect(stats).toEqual({ scanned: 1, finalized: 0, noticesSent: 0 });
  });

  it("passes undefined reasonDetail when the row has no stored pre_adverse detail", async () => {
    mockDueRows([{ id: "app-1", pre_adverse_reason_detail: null }]);
    mockTransition.mockResolvedValue({ changed: true, status: "screening_failed" } as any);

    await service.finalizeDuePreAdverseActions();

    expect(sendNoticeSpy).toHaveBeenCalledWith("app-1", null, "system", "screening_failed", undefined);
  });

  it("isolates per-row failures: a throwing notice does not stall the rest of the sweep", async () => {
    mockDueRows([
      { id: "app-1", pre_adverse_reason_detail: "r1" },
      { id: "app-2", pre_adverse_reason_detail: "r2" },
    ]);
    mockTransition.mockResolvedValue({ changed: true, status: "screening_failed" } as any);
    sendNoticeSpy
      .mockRejectedValueOnce(new Error("notice send blew up"))
      .mockResolvedValueOnce({
        noticeId: "n2",
        applicationId: "app-2",
        sentAt: new Date(),
        reason: "screening_failed",
      });

    const stats = await service.finalizeDuePreAdverseActions();

    // Both rows were CAS-finalized (finalized++ precedes the notice send) ...
    expect(mockTransition).toHaveBeenCalledTimes(2);
    expect(sendNoticeSpy).toHaveBeenCalledTimes(2);
    // ... but only the second notice actually went out.
    expect(stats).toEqual({ scanned: 2, finalized: 2, noticesSent: 1 });
  });

  it("processes due rows oldest-window-first", async () => {
    mockDueRows([]);
    await service.finalizeDuePreAdverseActions();
    const sql = mockQuery.mock.calls[0]![0] as string;
    expect(sql).toMatch(/ORDER BY a\.adverse_action_eligible_at ASC/);
  });
});
