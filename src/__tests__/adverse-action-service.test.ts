/**
 * Tests for src/modules/adverse-action/service.ts
 *
 * AdverseActionService is the FCRA § 1681m compliance mechanism:
 * it records adverse action notices and notifies applicants when denied.
 *
 * Key invariants under test:
 *   - DB notice record is ALWAYS written (it is the legal evidence)
 *   - Twilio SMS failure must NOT propagate — notice is still considered sent
 *   - `getNotice` returns the most recently sent notice, or null
 *   - Notice text includes CRA name, rights disclosure, and property name
 *   - Application not found → throws before any DB write
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

const APP_ID = "app-fcra-001";
const ACTOR_ID = "user-sm-001";
const ACTOR_ROLE = "senior_manager";
const NOTICE_ID = "notice-001";

function mockAppQuery(overrides: Partial<{
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  propertyName: string;
}> = {}) {
  const data = {
    first_name: overrides.firstName ?? "Jane",
    last_name: overrides.lastName ?? "Doe",
    email: overrides.email ?? "jane@example.com",
    phone: overrides.phone !== undefined ? overrides.phone : "+17025550100",
    property_name: overrides.propertyName ?? "Desert Oasis Apartments",
  };
  mockQuery.mockResolvedValueOnce({ rows: [data] } as any);
}

function mockInsertNotice() {
  mockQuery.mockResolvedValueOnce({
    rows: [{ id: NOTICE_ID, created_at: new Date("2026-03-27T12:00:00Z") }],
  } as any);
}

// ── sendNotice() ───────────────────────────────────────────────────────────

describe("AdverseActionService.sendNotice()", () => {
  let service: AdverseActionService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AdverseActionService();
  });

  it("throws when application is not found", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as any);

    await expect(
      service.sendNotice(APP_ID, ACTOR_ID, ACTOR_ROLE, "screening_failed")
    ).rejects.toThrow(`Application not found: ${APP_ID}`);

    // No INSERT should happen
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it("inserts a notice record into adverse_action_notices", async () => {
    mockAppQuery();
    mockInsertNotice();

    await service.sendNotice(APP_ID, ACTOR_ID, ACTOR_ROLE, "screening_failed");

    const insertCall = mockQuery.mock.calls[1]!;
    expect(insertCall[0]).toMatch(/INSERT INTO adverse_action_notices/i);
    expect(insertCall[1]).toEqual(
      expect.arrayContaining([APP_ID, ACTOR_ID, "screening_failed"])
    );
  });

  it("includes reasonDetail in the notice INSERT when provided", async () => {
    mockAppQuery();
    mockInsertNotice();

    const detail = "Automated screening denial: failed background check";
    await service.sendNotice(APP_ID, ACTOR_ID, ACTOR_ROLE, "screening_failed", detail);

    const insertCall = mockQuery.mock.calls[1]!;
    expect(insertCall[1]).toContain(detail);
  });

  it("passes null for reasonDetail when not provided", async () => {
    mockAppQuery();
    mockInsertNotice();

    await service.sendNotice(APP_ID, ACTOR_ID, ACTOR_ROLE, "tier1_denied");

    const insertCall = mockQuery.mock.calls[1]!;
    // params: [applicationId, actorId, reason, reasonDetail, noticeText]
    // index 3 is reasonDetail — should be null when not provided
    expect((insertCall[1] as any[])[3]).toBeNull();
  });

  it("writes an audit log entry with adverse_action_notice_sent action", async () => {
    mockAppQuery();
    mockInsertNotice();

    await service.sendNotice(APP_ID, ACTOR_ID, ACTOR_ROLE, "screening_failed");

    expect(mockWriteAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "adverse_action_notice_sent",
        actorId: ACTOR_ID,
        actorRole: ACTOR_ROLE,
        applicationId: APP_ID,
        resourceType: "adverse_action_notice",
        resourceId: NOTICE_ID,
      })
    );
  });

  it("returns noticeId, applicationId, sentAt, and reason", async () => {
    mockAppQuery();
    mockInsertNotice();

    const result = await service.sendNotice(APP_ID, ACTOR_ID, ACTOR_ROLE, "screening_failed");

    expect(result.noticeId).toBe(NOTICE_ID);
    expect(result.applicationId).toBe(APP_ID);
    expect(result.sentAt).toBeInstanceOf(Date);
    expect(result.reason).toBe("screening_failed");
  });

  it("sends SMS via TwilioService.notifyDenied when phone is present", async () => {
    mockAppQuery({ phone: "+17025550199" });
    mockInsertNotice();
    mockNotifyDenied.mockResolvedValueOnce(undefined);

    await service.sendNotice(APP_ID, ACTOR_ID, ACTOR_ROLE, "tier1_denied");

    // Give the non-blocking promise a tick to resolve
    await new Promise((r) => setImmediate(r));
    expect(mockNotifyDenied).toHaveBeenCalledWith("+17025550199", "Jane Doe");
  });

  it("does NOT send SMS when applicant has no phone number", async () => {
    mockAppQuery({ phone: null });
    mockInsertNotice();

    await service.sendNotice(APP_ID, ACTOR_ID, ACTOR_ROLE, "screening_failed");

    await new Promise((r) => setImmediate(r));
    expect(mockNotifyDenied).not.toHaveBeenCalled();
  });

  it("resolves successfully even when Twilio throws (non-blocking SMS)", async () => {
    mockAppQuery({ phone: "+17025550100" });
    mockInsertNotice();
    mockNotifyDenied.mockRejectedValueOnce(new Error("Twilio rate limit exceeded"));

    // Must not throw despite SMS failure
    await expect(
      service.sendNotice(APP_ID, ACTOR_ID, ACTOR_ROLE, "screening_failed")
    ).resolves.toMatchObject({ noticeId: NOTICE_ID });

    await new Promise((r) => setImmediate(r));
  });

  it("notice text includes FCRA rights disclosure and CRA reference", async () => {
    mockAppQuery({ propertyName: "Sunrise Gardens" });
    mockInsertNotice();

    await service.sendNotice(APP_ID, ACTOR_ID, ACTOR_ROLE, "screening_failed");

    const insertCall = mockQuery.mock.calls[1]!;
    const noticeText = (insertCall[1] as any[])[4] === null
      ? (insertCall[1] as any[])[3] // fallback: noticeText is at index 3 if reasonDetail is absent
      : (() => {
          // Find noticeText — it's the longest string param
          const params = insertCall[1] as any[];
          return params.find((p: any) => typeof p === "string" && p.length > 200);
        })();

    // Just verify the INSERT call happened — notice text is in the INSERT params
    const params = insertCall[1] as any[];
    const longText = params.find((p: any) => typeof p === "string" && p.includes("Fair Credit Reporting Act"));
    expect(longText).toBeDefined();
    expect(longText).toContain("Sunrise Gardens");
    // "consumer" and "reporting agency" may be split across a line break in the notice
    expect(longText).toMatch(/consumer[\s\S]*reporting agency/);
    expect(longText).toMatch(/free copy/i);
    expect(longText).toMatch(/dispute/i);
  });
});

// ── generateNoticeDraft() ────────────────────────────────────────────────────

describe("AdverseActionService.generateNoticeDraft()", () => {
  let service: AdverseActionService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AdverseActionService();
  });

  it("throws when application is not found", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as any);

    await expect(
      service.generateNoticeDraft(APP_ID)
    ).rejects.toThrow(`Application not found: ${APP_ID}`);
  });

  it("renders a non-empty FCRA notice text from the same lookup as sendNotice", async () => {
    mockAppQuery({ propertyName: "Sunrise Gardens" });

    const draft = await service.generateNoticeDraft(APP_ID, "Manual review denial: criminal history");

    expect(draft.applicationId).toBe(APP_ID);
    expect(draft.applicantName).toBe("Jane Doe");
    expect(draft.propertyName).toBe("Sunrise Gardens");
    expect(draft.noticeText).toBeTruthy();
    expect(draft.noticeText).toContain("Sunrise Gardens");
    expect(draft.noticeText).toMatch(/Fair Credit Reporting Act/);
    expect(draft.noticeText).toContain("Manual review denial: criminal history");
  });

  it("does a single SELECT lookup and NO INSERT (pure render — no commit)", async () => {
    mockAppQuery();
    // Deliberately do NOT queue an INSERT result. If the code attempted an
    // INSERT it would consume an undefined mock return and the row read would
    // throw — but more directly we assert exactly one query and that it is a SELECT.

    await service.generateNoticeDraft(APP_ID);

    expect(mockQuery).toHaveBeenCalledTimes(1);
    const onlyCall = mockQuery.mock.calls[0]!;
    expect(onlyCall[0]).toMatch(/SELECT/i);
    expect(onlyCall[0]).not.toMatch(/INSERT INTO adverse_action_notices/i);
  });

  it("sends NO SMS and writes NO audit log (it is a preview, not a sent notice)", async () => {
    mockAppQuery({ phone: "+17025550100" });

    await service.generateNoticeDraft(APP_ID);

    await new Promise((r) => setImmediate(r));
    expect(mockNotifyDenied).not.toHaveBeenCalled();
    expect(mockWriteAuditLog).not.toHaveBeenCalled();
  });
});

// ── getNotice() ────────────────────────────────────────────────────────────

describe("AdverseActionService.getNotice()", () => {
  let service: AdverseActionService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AdverseActionService();
  });

  it("returns null when no notice exists for the application", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as any);

    const result = await service.getNotice(APP_ID);
    expect(result).toBeNull();
  });

  it("returns the most recently sent notice with correct shape", async () => {
    const sentAt = new Date("2026-03-27T09:30:00Z");
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: NOTICE_ID,
          application_id: APP_ID,
          reason: "screening_failed",
          reason_detail: "Automated screening denial: failed background check",
          sent_via: "sms",
          created_at: sentAt,
        },
      ],
    } as any);

    const result = await service.getNotice(APP_ID);

    expect(result).not.toBeNull();
    expect(result!.noticeId).toBe(NOTICE_ID);
    expect(result!.applicationId).toBe(APP_ID);
    expect(result!.reason).toBe("screening_failed");
    expect(result!.reasonDetail).toBe("Automated screening denial: failed background check");
    expect(result!.sentAt).toEqual(sentAt);
    expect(result!.sentVia).toBe("sms");
  });

  it("returns null reasonDetail when reason_detail is null in DB", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: NOTICE_ID,
          application_id: APP_ID,
          reason: "tier2_denied",
          reason_detail: null,
          sent_via: "sms",
          created_at: new Date(),
        },
      ],
    } as any);

    const result = await service.getNotice(APP_ID);
    expect(result!.reasonDetail).toBeNull();
  });

  it("queries by applicationId with DESC order and LIMIT 1", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as any);

    await service.getNotice(APP_ID);

    const selectCall = mockQuery.mock.calls[0]!;
    expect(selectCall[0]).toMatch(/ORDER BY created_at DESC/i);
    expect(selectCall[0]).toMatch(/LIMIT 1/i);
    expect(selectCall[1]).toEqual([APP_ID]);
  });
});
