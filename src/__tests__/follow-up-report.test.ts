/**
 * Tests for the follow-ups operator report (agenda / board / detail) — the
 * cockpit "where things sit" surface, with a mocked DB + missing-items.
 */

const mockQuery = jest.fn();
jest.mock("../config/database", () => ({
  query: (...args: unknown[]) => mockQuery(...args),
}));
const mockMissing = jest.fn();
jest.mock("../modules/requirements/service", () => ({
  computeMissingByPhone: (...a: unknown[]) => mockMissing(...a),
}));

import {
  getAgenda,
  getBoard,
  getDetail,
  renderAgenda,
  renderBoard,
  maskPhone,
} from "../modules/follow-ups/report";

beforeEach(() => jest.clearAllMocks());

describe("getAgenda + renderAgenda", () => {
  it("attaches each open follow-up's missing items and groups by day", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { id: "fu-aaaaaaaa-1", phone_e164: "+17025551234", reason: "needs_info", scheduled_for: "2026-06-25T17:00:00.000Z", status: "pending", attempts: 0, max_attempts: 3, checkpoint: null },
        { id: "fu-bbbbbbbb-2", phone_e164: "+17025559999", reason: "bad_time", scheduled_for: "2026-06-25T19:30:00.000Z", status: "pending", attempts: 1, max_attempts: 3, checkpoint: "resume at employer" },
      ],
    });
    mockMissing
      .mockResolvedValueOnce({ applicationId: "app1", missing: [{ key: "income_paystubs", label: "your two most recent pay stubs" }] })
      .mockResolvedValueOnce({ applicationId: "app2", missing: [] });

    const rows = await getAgenda(50);
    expect(rows).toHaveLength(2);
    expect(rows[0].missing).toEqual(["your two most recent pay stubs"]);
    expect(rows[0].phoneMasked).toBe("***1234");
    expect(rows[1].missing).toEqual([]);

    const text = renderAgenda(rows);
    expect(text).toContain("2026-06-25");
    expect(text).toContain("needs: your two most recent pay stubs");
    expect(text).toContain("resume: resume at employer");
  });

  it("renders an empty agenda cleanly", () => {
    expect(renderAgenda([])).toContain("queue is clear");
  });
});

describe("getBoard + renderBoard", () => {
  it("summarizes counts by status", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { status: "pending", count: 4 },
        { status: "completed", count: 7 },
      ],
    });
    const board = await getBoard();
    const text = renderBoard(board);
    expect(text).toContain("11 total");
    expect(text).toContain("pending");
    expect(text).toContain("completed");
  });
});

describe("getDetail", () => {
  it("returns null for an unknown id", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    expect(await getDetail("nope")).toBeNull();
  });

  it("masks the phone everywhere", () => {
    expect(maskPhone("+17025551234")).toBe("***1234");
    expect(maskPhone(null)).toBe("****");
  });
});
