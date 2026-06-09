/**
 * Tests for AdverseActionService.sendPreAdverseNotice()
 * (src/modules/adverse-action/service.ts — pre-adverse-action window).
 *
 * The pre-adverse notice is the flag-gated FCRA_PRE_ADVERSE_ENABLED courtesy:
 * an intent-to-deny letter + copy-of-report/dispute rights + an N-business-day
 * window, persisted as a stage='pre_adverse' row so the daily finalizer can
 * carry its reason_detail into the final § 1681m notice (preview === sent).
 *
 * Legal framing (do not overstate): § 1681b(b)(3) is EMPLOYMENT screening; a
 * landlord's federal duty is the § 1681m POST-action notice. The notice text
 * must say we *intend* to deny — never claim a federal rental mandate.
 *
 * Key invariants under test:
 *   - DB row written with stage='pre_adverse' (the legal evidence)
 *   - notice text frames the decision as NOT YET FINAL + states the deadline
 *   - audit action is pre_adverse_action_notice_sent with stage/windowDays
 *   - Twilio SMS failure must NOT propagate
 *   - system actor (actorId null) coerces to undefined for the audit FK
 */

import { AdverseActionService } from "../modules/adverse-action/service";

// ── Mocks ─────────────────────────────────────────────────────────────────

jest.mock("../config/database", () => ({ query: jest.fn(), transaction: jest.fn() }));
jest.mock("../utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock("../middleware/audit", () => ({
  writeAuditLog: jest.fn().mockResolvedValue(undefined),
}));
// sendPreAdverseNotice never calls the chokepoint, but the module imports it;
// mock it so requiring the service never pulls the tape/v2-stamp graph.
jest.mock("../modules/screening/state-machine", () => ({
  transitionApplicationStatus: jest.fn(),
}));

const mockNotifyDenied = jest.fn().mockResolvedValue(undefined);
jest.mock("../modules/integrations/twilio", () => ({
  TwilioService: jest.fn().mockImplementation(() => ({
    notifyDenied: mockNotifyDenied,
  })),
}));

import { query } from "../config/database";
import { writeAuditLog } from "../middleware/audit";

const mockQuery = query as jest.MockedFunction<typeof query>;
const mockWriteAuditLog = writeAuditLog as jest.MockedFunction<typeof writeAuditLog>;

// ── Helpers ────────────────────────────────────────────────────────────────

const APP_ID = "app-fcra-pre-001";
const ACTOR_ID = "user-sm-001";
const ACTOR_ROLE = "senior_manager";
const NOTICE_ID = "notice-pre-001";
const WINDOW_DAYS = 5;
const ELIGIBLE_DATE = new Date("2026-06-15T12:00:00Z");

function mockAppQuery(overrides: Partial<{ phone: string | null; propertyName: string }> = {}) {
  mockQuery.mockResolvedValueOnce({
    rows: [
      {
        first_name: "Jane",
        last_name: "Doe",
        email: "jane@example.com",
        phone: overrides.phone !== undefined ? overrides.phone : "+17025550100",
        property_name: overrides.propertyName ?? "Desert Oasis Apartments",
      },
    ],
  } as any);
}

function mockInsertNotice() {
  mockQuery.mockResolvedValueOnce({
    rows: [{ id: NOTICE_ID, created_at: new Date("2026-06-09T12:00:00Z") }],
  } as any);
}

describe("AdverseActionService.sendPreAdverseNotice()", () => {
  let service: AdverseActionService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AdverseActionService();
  });

  it("throws when the application is not found (no INSERT)", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as any);

    await expect(
      service.sendPreAdverseNotice(APP_ID, ACTOR_ID, ACTOR_ROLE, "screening_failed", WINDOW_DAYS, ELIGIBLE_DATE)
    ).rejects.toThrow(`Application not found: ${APP_ID}`);

    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it("inserts a stage='pre_adverse' notice row", async () => {
    mockAppQuery();
    mockInsertNotice();

    await service.sendPreAdverseNotice(
      APP_ID, ACTOR_ID, ACTOR_ROLE, "screening_failed", WINDOW_DAYS, ELIGIBLE_DATE, "failed background check"
    );

    const insertCall = mockQuery.mock.calls[1]!;
    expect(insertCall[0]).toMatch(/INSERT INTO adverse_action_notices/i);
    // stage is a SQL literal in the VALUES list, not a bound param.
    expect(insertCall[0]).toMatch(/'pre_adverse'/);
    // params: [applicationId, actorId, reason, reasonDetail, noticeText]
    expect(insertCall[1]).toEqual(
      expect.arrayContaining([APP_ID, ACTOR_ID, "screening_failed", "failed background check"])
    );
  });

  it("passes null for reasonDetail when not provided", async () => {
    mockAppQuery();
    mockInsertNotice();

    await service.sendPreAdverseNotice(APP_ID, ACTOR_ID, ACTOR_ROLE, "screening_failed", WINDOW_DAYS, ELIGIBLE_DATE);

    const insertCall = mockQuery.mock.calls[1]!;
    expect((insertCall[1] as any[])[3]).toBeNull();
  });

  it("frames the notice as intent-to-deny (NOT YET FINAL) with the dispute window + deadline", async () => {
    mockAppQuery({ propertyName: "Sunrise Gardens" });
    mockInsertNotice();

    await service.sendPreAdverseNotice(
      APP_ID, ACTOR_ID, ACTOR_ROLE, "screening_failed", WINDOW_DAYS, ELIGIBLE_DATE, "failed credit check"
    );

    const noticeText = (mockQuery.mock.calls[1]![1] as any[])[4] as string;
    expect(noticeText).toContain("Sunrise Gardens");
    expect(noticeText).toMatch(/INTEND to deny/);
    expect(noticeText).toMatch(/not yet final/i);
    expect(noticeText).toContain(`${WINDOW_DAYS} business days`);
    // deadline rendered from eligibleDate (en-US long date)
    expect(noticeText).toMatch(/June 15, 2026/);
    expect(noticeText).toMatch(/Reason under consideration: failed credit check/);
    // FCRA rights + CRA block carried over from the final-notice structure
    expect(noticeText).toMatch(/FREE copy/);
    expect(noticeText).toMatch(/[Dd]ispute/);
    expect(noticeText).toMatch(/consumer[\s\S]*reporting agency/);
  });

  it("does NOT contain the final-denial language (it is not a § 1681m final notice)", async () => {
    mockAppQuery();
    mockInsertNotice();

    await service.sendPreAdverseNotice(APP_ID, ACTOR_ID, ACTOR_ROLE, "screening_failed", WINDOW_DAYS, ELIGIBLE_DATE);

    const noticeText = (mockQuery.mock.calls[1]![1] as any[])[4] as string;
    expect(noticeText).not.toMatch(/has been denied/);
  });

  it("writes a pre_adverse_action_notice_sent audit log with stage + windowDays + eligibleAt", async () => {
    mockAppQuery();
    mockInsertNotice();

    await service.sendPreAdverseNotice(APP_ID, ACTOR_ID, ACTOR_ROLE, "screening_failed", WINDOW_DAYS, ELIGIBLE_DATE, "x");

    expect(mockWriteAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "pre_adverse_action_notice_sent",
        actorId: ACTOR_ID,
        actorRole: ACTOR_ROLE,
        applicationId: APP_ID,
        resourceType: "adverse_action_notice",
        resourceId: NOTICE_ID,
        details: expect.objectContaining({
          stage: "pre_adverse",
          windowDays: WINDOW_DAYS,
          eligibleAt: ELIGIBLE_DATE.toISOString(),
        }),
      })
    );
  });

  it("coerces a null (system) actorId to undefined for the audit FK", async () => {
    mockAppQuery();
    mockInsertNotice();

    await service.sendPreAdverseNotice(APP_ID, null, "system", "screening_failed", WINDOW_DAYS, ELIGIBLE_DATE);

    // INSERT still binds null for sent_by (nullable UUID FK)
    expect((mockQuery.mock.calls[1]![1] as any[])[1]).toBeNull();
    // audit actorId coerced null -> undefined (AuditEntry.actorId?: string)
    const auditArg = mockWriteAuditLog.mock.calls[0]![0] as any;
    expect(auditArg.actorId).toBeUndefined();
  });

  it("sends a non-blocking SMS when the applicant has a phone", async () => {
    mockAppQuery({ phone: "+17025550199" });
    mockInsertNotice();

    await service.sendPreAdverseNotice(APP_ID, ACTOR_ID, ACTOR_ROLE, "screening_failed", WINDOW_DAYS, ELIGIBLE_DATE);

    await new Promise((r) => setImmediate(r));
    expect(mockNotifyDenied).toHaveBeenCalledWith("+17025550199", "Jane Doe");
  });

  it("resolves even when Twilio throws (SMS failure must not propagate)", async () => {
    mockAppQuery({ phone: "+17025550100" });
    mockInsertNotice();
    mockNotifyDenied.mockRejectedValueOnce(new Error("Twilio down"));

    await expect(
      service.sendPreAdverseNotice(APP_ID, ACTOR_ID, ACTOR_ROLE, "screening_failed", WINDOW_DAYS, ELIGIBLE_DATE)
    ).resolves.toMatchObject({ noticeId: NOTICE_ID });

    await new Promise((r) => setImmediate(r));
  });

  it("returns { noticeId, applicationId, sentAt, reason }", async () => {
    mockAppQuery();
    mockInsertNotice();

    const result = await service.sendPreAdverseNotice(
      APP_ID, ACTOR_ID, ACTOR_ROLE, "screening_failed", WINDOW_DAYS, ELIGIBLE_DATE
    );

    expect(result.noticeId).toBe(NOTICE_ID);
    expect(result.applicationId).toBe(APP_ID);
    expect(result.sentAt).toBeInstanceOf(Date);
    expect(result.reason).toBe("screening_failed");
  });
});
