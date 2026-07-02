/**
 * Tests for src/modules/voice-intake/redact-existing.ts — the one-time
 * redact-in-place sweep (audit C1, "migration for existing rows") over
 * voice_intake_calls rows persisted before the write-side redaction.
 *
 * Asserts the sweep applies the SAME transform persistConversation() applies
 * on write (drop inline transcript from raw_payload, pii-filter raw_payload +
 * data_collection_results), that it is idempotent (already-clean rows are not
 * rewritten), that dry-run writes nothing, and that keyset pagination advances.
 */

const mockQuery = jest.fn();
jest.mock("../config/database", () => ({
  query: (...args: unknown[]) => mockQuery(...args),
}));

jest.mock("../utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import {
  redactExistingVoiceIntakeRows,
  redactStoredRawPayload,
  redactStoredDataResults,
} from "../modules/voice-intake/redact-existing";

// A pre-C1 row exactly as the old write path stored it: inline transcript with
// the caller reading SSN digits aloud, plus collected PII fields in the clear.
const DIRTY_RAW = {
  conversation_id: "conv_dirty_1",
  agent_id: "agent_1",
  transcript: [
    { role: "agent", message: "Can you read me your social?" },
    { role: "user", message: "Sure, it's 123-45-6789." },
  ],
  analysis: {
    data_collection_results: {
      ssn: { value: "123-45-6789" },
      date_of_birth: { value: "1961-04-09" },
    },
  },
  metadata: { call_duration_secs: 300 },
};

const DIRTY_DCR = {
  ssn: { value: "123-45-6789" },
  date_of_birth: { value: "1961-04-09" },
  first_name: { value: "Ethel" },
};

// What a post-C1 (write-side redacted) row looks like — the sweep must leave
// it untouched.
const CLEAN_RAW = redactStoredRawPayload(DIRTY_RAW) as Record<string, unknown>;

function selectBatches(...batches: Array<Array<Record<string, unknown>>>) {
  mockQuery.mockImplementation(async (sql: unknown) => {
    const s = String(sql);
    if (/SELECT id, raw_payload, data_collection_results/i.test(s)) {
      return { rows: batches.shift() ?? [] };
    }
    return { rows: [] }; // UPDATEs
  });
}

function updateCalls(): Array<unknown[]> {
  return mockQuery.mock.calls.filter((c) =>
    /UPDATE voice_intake_calls/i.test(String(c[0]))
  );
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("redactStoredRawPayload — the write-side transform on stored jsonb", () => {
  it("drops the inline transcript and redacts SSN/DOB patterns + keys", () => {
    const out = redactStoredRawPayload(DIRTY_RAW)!;
    expect(out.transcript).toBeUndefined();
    const json = JSON.stringify(out);
    expect(json).not.toContain("123-45-6789");
    expect(json).not.toContain("1961-04-09");
    // Non-PII structure survives.
    expect(out.conversation_id).toBe("conv_dirty_1");
    expect((out.metadata as Record<string, unknown>).call_duration_secs).toBe(300);
  });

  it("returns null (nothing to rewrite) for non-object payloads", () => {
    expect(redactStoredRawPayload(null)).toBeNull();
    expect(redactStoredRawPayload("scalar")).toBeNull();
    expect(redactStoredRawPayload([1, 2])).toBeNull();
  });
});

describe("redactExistingVoiceIntakeRows", () => {
  it("rewrites a dirty row (transcript dropped, SSN/DOB redacted in both columns) and skips a clean one", async () => {
    selectBatches([
      { id: "row-dirty", raw_payload: DIRTY_RAW, data_collection_results: DIRTY_DCR },
      { id: "row-clean", raw_payload: CLEAN_RAW, data_collection_results: {} },
    ]);

    const result = await redactExistingVoiceIntakeRows();

    expect(result).toMatchObject({ scanned: 2, updated: 1, dryRun: false });
    const updates = updateCalls();
    expect(updates).toHaveLength(1);
    const [, params] = updates[0] as [string, unknown[]];
    expect(params[0]).toBe("row-dirty");

    const rewrittenRaw = JSON.parse(String(params[1]));
    expect(rewrittenRaw.transcript).toBeUndefined();
    expect(JSON.stringify(rewrittenRaw)).not.toContain("123-45-6789");

    const rewrittenDcr = JSON.parse(String(params[2]));
    expect(JSON.stringify(rewrittenDcr)).not.toContain("123-45-6789");
    expect(JSON.stringify(rewrittenDcr)).not.toContain("1961-04-09");
    // Non-PII collected fields survive redaction.
    expect(rewrittenDcr.first_name.value).toBe("Ethel");
  });

  it("is idempotent — a second sweep over already-redacted rows updates nothing", async () => {
    // A genuinely-swept row holds the transform's own output (note: the
    // pii-filter flattens a PII-KEYED object to the string "[REDACTED]", so
    // the fixture must come from the real transform, not be hand-written).
    const sweptDcr = redactStoredDataResults(DIRTY_DCR);
    selectBatches([
      { id: "row-1", raw_payload: CLEAN_RAW, data_collection_results: sweptDcr },
    ]);

    const result = await redactExistingVoiceIntakeRows();

    expect(result).toMatchObject({ scanned: 1, updated: 0 });
    expect(updateCalls()).toHaveLength(0);
  });

  it("dry-run counts would-be updates without writing", async () => {
    selectBatches([
      { id: "row-dirty", raw_payload: DIRTY_RAW, data_collection_results: DIRTY_DCR },
    ]);

    const result = await redactExistingVoiceIntakeRows({ dryRun: true });

    expect(result).toMatchObject({ scanned: 1, updated: 1, dryRun: true });
    expect(updateCalls()).toHaveLength(0);
  });

  it("keyset-paginates: the second SELECT starts after the last id of the first batch", async () => {
    selectBatches(
      [
        { id: "id-aaa", raw_payload: CLEAN_RAW, data_collection_results: {} },
        { id: "id-bbb", raw_payload: CLEAN_RAW, data_collection_results: {} },
      ],
      [{ id: "id-ccc", raw_payload: CLEAN_RAW, data_collection_results: {} }]
    );

    const result = await redactExistingVoiceIntakeRows({ batchSize: 2 });

    expect(result).toMatchObject({ scanned: 3, batches: 2 });
    const selects = mockQuery.mock.calls.filter((c) =>
      /SELECT id, raw_payload/i.test(String(c[0]))
    );
    expect(selects).toHaveLength(3); // batch1, batch2, empty terminator
    expect((selects[0][1] as unknown[])[0]).toBeNull(); // first page: no cursor
    expect((selects[1][1] as unknown[])[0]).toBe("id-bbb"); // cursor advanced
    expect((selects[2][1] as unknown[])[0]).toBe("id-ccc");
  });

  it("leaves rows with null/non-object payloads untouched", async () => {
    selectBatches([
      { id: "row-null", raw_payload: null, data_collection_results: {} },
    ]);

    const result = await redactExistingVoiceIntakeRows();

    expect(result).toMatchObject({ scanned: 1, updated: 0 });
    expect(updateCalls()).toHaveLength(0);
  });
});
