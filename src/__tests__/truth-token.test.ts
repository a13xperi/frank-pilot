/**
 * Truth Token — mint & verify (Phase 3).
 *
 * Mocks config/database with an in-memory truth_tokens store keyed by
 * answer_hash so issueTruthToken's INSERT and verifyTruthToken's SELECT round-
 * trip without a real Postgres. utils/logger is stubbed (PII filter is exercised
 * elsewhere). The router is mounted standalone via supertest — these are the
 * module's own files, so we don't need to boot src/index.ts.
 *
 * Assertions:
 *   - issue → verify(answer_hash) → hash_valid:true, sources echoed, model id
 *     present (full round-trip through the mocked store + the GET route).
 *   - the answer_hash BINDS the answer: recomputing over a TAMPERED answer
 *     yields a DIFFERENT hash → no stored row → verify reports hash_valid:false.
 */

import request from "supertest";
import express from "express";

// In-memory truth_tokens store, keyed by answer_hash. The query() mock parses
// just enough of the two SQL shapes the service issues (INSERT ... RETURNING,
// SELECT ... WHERE answer_hash = $1) to behave like the real table, including
// the ON CONFLICT (answer_hash) DO NOTHING / RETURNING contract.
const store = new Map<string, Record<string, unknown>>();

const queryMock = jest.fn(async (text: string, params: unknown[] = []) => {
  if (text.includes("INSERT INTO truth_tokens")) {
    const [
      request_id,
      answer_hash,
      model_id,
      engine,
      source_ids_json,
      source_set_hash,
      ledger_head,
      question_hash,
      created_by,
    ] = params as string[];
    // ON CONFLICT (answer_hash) DO NOTHING → RETURNING yields no row.
    if (store.has(answer_hash)) return { rows: [] };
    const row = {
      id: `tt-${store.size + 1}`,
      request_id: request_id ?? null,
      answer_hash,
      model_id,
      engine: engine ?? null,
      // pg parses jsonb columns back into JS values, so store the parsed array.
      source_ids: JSON.parse(source_ids_json),
      source_set_hash,
      ledger_head: ledger_head ?? null,
      question_hash: question_hash ?? null,
      created_by,
      created_at: new Date("2026-06-16T12:00:00.000Z"),
    };
    store.set(answer_hash, row);
    return { rows: [row] };
  }
  if (text.includes("SELECT * FROM truth_tokens WHERE answer_hash")) {
    const answer_hash = (params[0] as string) ?? "";
    const row = store.get(answer_hash);
    return { rows: row ? [row] : [] };
  }
  return { rows: [] };
});

jest.mock("../config/database", () => ({
  query: (...args: unknown[]) =>
    (queryMock as unknown as (...a: unknown[]) => unknown)(...args),
}));
jest.mock("../utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { issueTruthToken, __test } =
  require("../modules/truth-token/service") as typeof import("../modules/truth-token/service");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { truthTokenRoutes } =
  require("../modules/truth-token/routes") as typeof import("../modules/truth-token/routes");

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/truth-tokens", truthTokenRoutes());
  return app;
}

beforeEach(() => {
  store.clear();
  queryMock.mockClear();
});

describe("Truth Token — issue & verify", () => {
  const issued = {
    question: "Is the property income-restricted?",
    answer: "Yes, units at this property are restricted to 60% AMI.",
    sourceIds: ["property:001", "tenantFaq:12"],
    modelId: "claude-haiku-4-5-20251001",
    createdBy: "housing-qa",
  };

  it("issue → verify yields hash_valid true with sources + model id", async () => {
    const { token, answer_hash } = await issueTruthToken(issued);
    expect(answer_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(token.answerHash).toBe(answer_hash);
    expect(token.modelId).toBe(issued.modelId);
    // sourceIds are deduped + sorted by the service.
    expect(token.sourceIds).toEqual(["property:001", "tenantFaq:12"]);

    const app = makeApp();
    const res = await request(app).get(`/api/truth-tokens/verify/${answer_hash}`);
    expect(res.status).toBe(200);
    expect(res.body.hash_valid).toBe(true);
    expect(res.body.sources).toEqual(["property:001", "tenantFaq:12"]);
    expect(res.body.model_id).toBe(issued.modelId);
    expect(res.body.created_at).toBe("2026-06-16T12:00:00.000Z");
    expect(res.body.ledger_contradiction).toBe(false);
  });

  it("tampered answer recomputes to a different hash → unknown token → not valid", async () => {
    const { answer_hash } = await issueTruthToken(issued);

    // The hash binds the answer: a single-char change to the answer text
    // produces a distinct answer_hash with no stored row behind it.
    const tamperedHash = __test.computeAnswerHash({
      question: issued.question,
      answer: issued.answer + " (edited)",
      sourceIds: issued.sourceIds,
      modelId: issued.modelId,
    });
    expect(tamperedHash).not.toBe(answer_hash);

    const app = makeApp();
    const res = await request(app).get(`/api/truth-tokens/verify/${tamperedHash}`);
    expect(res.status).toBe(200);
    expect(res.body.hash_valid).toBe(false);
    expect(res.body.sources).toEqual([]);
    expect(res.body.model_id).toBeNull();
  });

  it("malformed answer_hash is fail-closed (200, not valid)", async () => {
    const app = makeApp();
    const res = await request(app).get("/api/truth-tokens/verify/not-a-hash");
    expect(res.status).toBe(200);
    expect(res.body.hash_valid).toBe(false);
  });
});
