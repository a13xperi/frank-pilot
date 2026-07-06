/**
 * Tests for src/modules/application/dup-report.ts — the read-only pre-flight
 * for the audit-#3 UNIQUE(conversation_id) migration. Asserts the SQL shape and
 * the keeper/duplicate/payment roll-up from a mocked result set.
 */

const mockQuery = jest.fn();
jest.mock("../config/database", () => ({
  query: (...args: unknown[]) => mockQuery(...args),
}));

import { reportConversationDuplicates } from "../modules/application/dup-report";

beforeEach(() => jest.clearAllMocks());

describe("reportConversationDuplicates", () => {
  it("rolls up keepers vs duplicates and flags paid duplicates", async () => {
    // conv_a: 2 rows (keeper + 1 dup, the dup has a succeeded payment).
    // conv_b: 3 rows (keeper + 2 dups, none paid).
    mockQuery.mockResolvedValueOnce({
      rows: [
        { conversation_id: "conv_a", id: "a1", status: "screening", created_at: "2026-07-01T00:00:00Z", is_keeper: true, has_succeeded_payment: true },
        { conversation_id: "conv_a", id: "a2", status: "draft", created_at: "2026-07-01T00:05:00Z", is_keeper: false, has_succeeded_payment: true },
        { conversation_id: "conv_b", id: "b1", status: "draft", created_at: "2026-07-02T00:00:00Z", is_keeper: true, has_succeeded_payment: false },
        { conversation_id: "conv_b", id: "b2", status: "draft", created_at: "2026-07-02T00:01:00Z", is_keeper: false, has_succeeded_payment: false },
        { conversation_id: "conv_b", id: "b3", status: "draft", created_at: "2026-07-02T00:02:00Z", is_keeper: false, has_succeeded_payment: false },
      ],
    });

    const report = await reportConversationDuplicates();

    expect(report.conversationsWithDuplicates).toBe(2);
    expect(report.duplicateApplications).toBe(3); // a2, b2, b3
    expect(report.duplicatesWithPayment).toBe(1); // a2
    expect(report.conversations).toHaveLength(2);
    const convA = report.conversations.find((c) => c.conversationId === "conv_a")!;
    expect(convA.count).toBe(2);
    expect(convA.applications[0].isKeeper).toBe(true);

    // The query only considers conversations with >1 application.
    const sql = String(mockQuery.mock.calls[0][0]);
    expect(sql).toMatch(/HAVING COUNT\(\*\) > 1/i);
    expect(sql).toMatch(/conversation_id IS NOT NULL/i);
    expect(sql).toMatch(/payment_idempotency/i);
  });

  it("returns a clean report when there are no duplicates", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const report = await reportConversationDuplicates();

    expect(report).toEqual({
      conversationsWithDuplicates: 0,
      duplicateApplications: 0,
      duplicatesWithPayment: 0,
      conversations: [],
    });
  });
});
