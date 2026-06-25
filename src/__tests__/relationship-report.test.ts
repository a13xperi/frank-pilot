/**
 * Tests for the relationship report — deterministic summary, refresh upsert,
 * read, and the get_person_summary voice tool.
 */
const mockQuery = jest.fn();
jest.mock("../config/database", () => ({ query: (...a: unknown[]) => mockQuery(...a) }));
jest.mock("../utils/logger", () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));
jest.mock("../modules/voice-intake/service", () => ({
  normalizePhone: (p: unknown) => (typeof p === "string" && p.trim() ? p.trim() : null),
}));

import { buildSummary, refreshPersonReport, getPersonReport } from "../modules/relationship/report";
import { getPersonSummaryHandler } from "../modules/relationship/tools";

const CTX = { agentId: "a", conversationId: "c", toolCallId: "t", toolName: "get_person_summary" as const };
const PH = "+17025551234";
beforeEach(() => jest.clearAllMocks());

describe("buildSummary", () => {
  it("renders the full journey", () => {
    const s = buildSummary(4, ["application_created", "fee_paid", "screening_passed", "callback_scheduled"], "screening_passed");
    expect(s).toContain("4 interactions");
    expect(s).toContain("applied, fee paid, screening passed, callback scheduled");
    expect(s).toContain("Current status: screening_passed");
  });
  it("handles a first contact with no events", () => {
    expect(buildSummary(1, [], null)).toBe("First contact.");
  });
  it("prefers failed over started", () => {
    expect(buildSummary(2, ["screening_started", "screening_failed"], null)).toContain("screening did not pass");
  });
});

describe("refreshPersonReport", () => {
  it("upserts a computed summary; never throws on error", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ n: 2, last_at: new Date("2026-06-25T00:00:00Z"), events: ["application_created", "fee_paid"], last_event: "fee_paid" }] })
      .mockResolvedValueOnce({ rows: [{ status: "submitted" }] })
      .mockResolvedValueOnce({ rows: [] }); // the upsert
    await refreshPersonReport(PH);
    const upsert = mockQuery.mock.calls.find((c) => String(c[0]).includes("INSERT INTO relationship_report"));
    expect(upsert).toBeTruthy();
    expect(String(upsert?.[1]?.[1])).toContain("applied, fee paid");
  });
  it("no-ops with zero ledger rows", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ n: 0, events: [], last_event: null }] });
    await refreshPersonReport(PH);
    expect(mockQuery).toHaveBeenCalledTimes(1); // only the ledger read, no upsert
  });
  it("never throws", async () => {
    mockQuery.mockRejectedValueOnce(new Error("boom"));
    await expect(refreshPersonReport(PH)).resolves.toBeUndefined();
  });
});

describe("get_person_summary tool", () => {
  it("recites the summary", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ phone_e164: PH, summary: "2 interactions: applied, fee paid.", interactions: 2, last_status: "submitted", last_event: "fee_paid" }] });
    const r = await getPersonSummaryHandler({ phone_e164: PH }, CTX);
    expect(r.ok).toBe(true);
    expect(r.message).toContain("Here's where you stand: 2 interactions");
  });
  it("handles no report on file", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const r = await getPersonSummaryHandler({ phone_e164: PH }, CTX);
    expect(r.ok).toBe(true);
    expect(r.message).toMatch(/don't have a summary/i);
  });
});
