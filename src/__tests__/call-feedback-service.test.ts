/**
 * Capture + channel-resolution tests for src/modules/call-feedback/service.ts.
 *
 * The local Postgres goes through the mockQuery SQL-shape router; we assert the
 * resolve precedence (inbound vs outbound vs unknown vs not-markable) and the
 * UPSERT capture path with its error codes.
 */

const mockQuery = jest.fn();
jest.mock("../config/database", () => ({
  query: (...args: unknown[]) => mockQuery(...args),
}));

jest.mock("../utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import {
  captureCallFeedback,
  resolveCallChannel,
  getFeedbackForCall,
} from "../modules/call-feedback/service";

interface SourceState {
  /** voice_intake_calls row exists for this conversation. */
  inbound?: boolean;
  /** outbound_validation_calls row status, or undefined if no row. */
  outboundStatus?: string;
}

const captured: Array<{ sql: string; params: unknown[] }> = [];

function routeSources(state: SourceState): void {
  captured.length = 0;
  mockQuery.mockImplementation((sql: string, params: unknown[]) => {
    if (sql.includes("FROM voice_intake_calls") && sql.includes("LIMIT 1")) {
      return Promise.resolve({ rows: state.inbound ? [{ "?column?": 1 }] : [] });
    }
    if (sql.includes("FROM outbound_validation_calls") && sql.includes("LIMIT 1")) {
      return Promise.resolve({
        rows: state.outboundStatus ? [{ status: state.outboundStatus }] : [],
      });
    }
    if (sql.includes("INSERT INTO call_transcript_feedback")) {
      captured.push({ sql, params: params as unknown[] });
      return Promise.resolve({
        rows: [
          {
            id: "fb-1",
            conversation_id: params[0],
            channel: params[1],
            mark: params[2],
            note: params[3],
            tags: params[4],
            rated_by: params[5],
            rated_at: "2026-06-18T00:00:00Z",
            updated_at: "2026-06-18T00:00:00Z",
            dataset_included_at: null,
          },
        ],
      });
    }
    if (sql.includes("SELECT id, conversation_id, channel, mark")) {
      return Promise.resolve({ rows: [{ id: "fb-1", mark: "good" }] });
    }
    return Promise.resolve({ rows: [] });
  });
}

beforeEach(() => mockQuery.mockReset());

describe("resolveCallChannel", () => {
  it("resolves an inbound conversation as markable", async () => {
    routeSources({ inbound: true });
    const r = await resolveCallChannel("conv_in");
    expect(r).toEqual({ channel: "inbound", markable: true });
  });

  it("resolves a completed outbound call as markable", async () => {
    routeSources({ outboundStatus: "completed" });
    const r = await resolveCallChannel("conv_out");
    expect(r).toEqual({ channel: "outbound", markable: true });
  });

  it("flags an in-flight outbound dial as NOT markable", async () => {
    routeSources({ outboundStatus: "dialed" });
    const r = await resolveCallChannel("conv_dialing");
    expect(r?.channel).toBe("outbound");
    expect(r?.markable).toBe(false);
    expect(r?.reason).toContain("dialed");
  });

  it("returns null for an unknown conversation", async () => {
    routeSources({});
    expect(await resolveCallChannel("conv_ghost")).toBeNull();
  });

  it("prefers inbound when (hypothetically) both match", async () => {
    routeSources({ inbound: true, outboundStatus: "completed" });
    const r = await resolveCallChannel("conv_both");
    expect(r?.channel).toBe("inbound");
  });
});

describe("captureCallFeedback", () => {
  it("captures a good mark on an inbound call", async () => {
    routeSources({ inbound: true });
    const row = await captureCallFeedback({
      conversationId: "conv_in",
      mark: "good",
      ratedBy: "user-1",
      note: "  clear and accurate  ",
      tags: ["tone", " accuracy "],
    });
    expect(row.mark).toBe("good");
    expect(captured).toHaveLength(1);
    const [convId, channel, mark, note, tags] = captured[0].params;
    expect(convId).toBe("conv_in");
    expect(channel).toBe("inbound");
    expect(mark).toBe("good");
    expect(note).toBe("clear and accurate"); // trimmed
    expect(tags).toEqual(["tone", "accuracy"]); // trimmed + filtered
  });

  it("throws CALL_NOT_FOUND for an unknown conversation", async () => {
    routeSources({});
    await expect(
      captureCallFeedback({ conversationId: "ghost", mark: "good", ratedBy: "u" })
    ).rejects.toMatchObject({ code: "CALL_NOT_FOUND" });
  });

  it("throws CALL_NOT_MARKABLE for a dry-run/in-flight outbound call", async () => {
    routeSources({ outboundStatus: "dry_run" });
    await expect(
      captureCallFeedback({ conversationId: "conv_dry", mark: "bad", ratedBy: "u" })
    ).rejects.toMatchObject({ code: "CALL_NOT_MARKABLE" });
  });

  it("coerces an empty note to null", async () => {
    routeSources({ inbound: true });
    await captureCallFeedback({
      conversationId: "conv_in",
      mark: "bad",
      ratedBy: "u",
      note: "   ",
    });
    expect(captured[0].params[3]).toBeNull();
  });
});

describe("getFeedbackForCall", () => {
  it("queries by conversation_id ordered newest first", async () => {
    routeSources({});
    mockQuery.mockResolvedValueOnce({ rows: [{ id: "fb-1" }, { id: "fb-2" }] });
    const rows = await getFeedbackForCall("conv_x");
    expect(rows).toHaveLength(2);
    expect(mockQuery.mock.calls[0][0]).toContain("ORDER BY rated_at DESC");
    expect(mockQuery.mock.calls[0][1]).toEqual(["conv_x"]);
  });
});
