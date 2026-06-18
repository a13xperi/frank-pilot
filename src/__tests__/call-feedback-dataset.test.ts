/**
 * Dataset-assembler tests for src/modules/call-feedback/dataset.ts.
 *
 * assembleTrainingDataset is exercised over a mocked join result so we can
 * assert: the mark filter (good-only vs +negatives), the incremental WHERE
 * param, inbound transcript extraction from raw_payload, outbound structured
 * fallback, JSONL shape, and the markIncluded stamp.
 */

const mockQuery = jest.fn();
jest.mock("../config/database", () => ({
  query: (...args: unknown[]) => mockQuery(...args),
}));

jest.mock("../utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import {
  assembleTrainingDataset,
  toJsonl,
  type DatasetExample,
} from "../modules/call-feedback/dataset";

function field(value: unknown): { value: unknown } {
  return { value };
}

const INBOUND_ROW = {
  feedback_id: "fb-in",
  conversation_id: "conv_in",
  channel: "inbound",
  mark: "good",
  note: "great call",
  tags: ["tone"],
  raw_payload: {
    transcript: [
      { role: "agent", message: "Hi, this is Frank." },
      { role: "user", message: "Hello." },
      { role: "agent", message: "" }, // dropped (empty)
    ],
  },
  data_collection_results: {
    name: field("Jane Doe"),
    household: field(3),
    blank: field(""),
  },
  outbound_outcome: null,
  dynamic_variables: null,
};

const OUTBOUND_ROW = {
  feedback_id: "fb-out",
  conversation_id: "conv_out",
  channel: "outbound",
  mark: "bad",
  note: "talked over the applicant",
  tags: [],
  raw_payload: null,
  data_collection_results: null,
  outbound_outcome: "declined",
  dynamic_variables: { applicant_name: "John", property_names: "Donna Louise 1" },
};

beforeEach(() => mockQuery.mockReset());

describe("assembleTrainingDataset", () => {
  it("defaults to GOOD marks only and passes incremental=false", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [INBOUND_ROW] });
    const res = await assembleTrainingDataset();
    const [, params] = mockQuery.mock.calls[0];
    expect(params[0]).toEqual(["good"]);
    expect(params[1]).toBe(false);
    expect(res.counts).toEqual({ good: 1, bad: 0, total: 1 });
  });

  it("includes BAD marks as negatives when asked", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [INBOUND_ROW, OUTBOUND_ROW] });
    const res = await assembleTrainingDataset({ includeNegatives: true });
    expect(mockQuery.mock.calls[0][1][0]).toEqual(["good", "bad"]);
    expect(res.counts).toEqual({ good: 1, bad: 1, total: 2 });
  });

  it("extracts an ordered transcript and collected fields for inbound", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [INBOUND_ROW] });
    const { examples } = await assembleTrainingDataset();
    const ex = examples[0] as DatasetExample;
    expect(ex.channel).toBe("inbound");
    expect(ex.transcript).toEqual([
      { role: "agent", message: "Hi, this is Frank." },
      { role: "user", message: "Hello." },
    ]); // empty turn dropped
    expect(ex.collected).toEqual({ name: "Jane Doe", household: "3" }); // blank dropped
    expect(ex.tags).toEqual(["tone"]);
  });

  it("falls back to structured outcome + dynamic vars for outbound (no transcript)", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [OUTBOUND_ROW] });
    const { examples } = await assembleTrainingDataset({ includeNegatives: true });
    const ex = examples[0];
    expect(ex.channel).toBe("outbound");
    expect(ex.transcript).toEqual([]);
    expect(ex.collected).toEqual({
      outcome: "declined",
      applicant_name: "John",
      property_names: "Donna Louise 1",
    });
  });

  it("passes incrementalOnly through as the WHERE param", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await assembleTrainingDataset({ incrementalOnly: true });
    expect(mockQuery.mock.calls[0][1][1]).toBe(true);
  });

  it("stamps dataset_included_at only when markIncluded is set", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [INBOUND_ROW, OUTBOUND_ROW] })
      .mockResolvedValueOnce({ rows: [] }); // the UPDATE
    await assembleTrainingDataset({ includeNegatives: true, markIncluded: true });
    expect(mockQuery).toHaveBeenCalledTimes(2);
    const [updateSql, updateParams] = mockQuery.mock.calls[1];
    expect(updateSql).toContain("UPDATE call_transcript_feedback");
    expect(updateSql).toContain("dataset_included_at = NOW()");
    expect(updateParams[0]).toEqual(["fb-in", "fb-out"]);
  });

  it("does NOT run an UPDATE when markIncluded is false", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [INBOUND_ROW] });
    await assembleTrainingDataset();
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it("emits one JSON object per line in jsonl", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [INBOUND_ROW, OUTBOUND_ROW] });
    const res = await assembleTrainingDataset({ includeNegatives: true });
    const lines = res.jsonl.split("\n");
    expect(lines).toHaveLength(2);
    expect(() => JSON.parse(lines[0])).not.toThrow();
    expect(JSON.parse(lines[0]).conversationId).toBe("conv_in");
  });
});

describe("toJsonl", () => {
  it("returns an empty string for no examples", () => {
    expect(toJsonl([])).toBe("");
  });
});
