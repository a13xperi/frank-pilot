/**
 * housing-qa-routes.test.ts — route tests for POST /api/housing-qa.
 *
 * Mocks @anthropic-ai/sdk (no real network). Asserts:
 *   - empty / oversized question → 400
 *   - valid question → 200 { answer }, AND the system prompt passed to the SDK
 *     contains the injected grounded context
 *   - missing ANTHROPIC_API_KEY → 503 (clean, no crash)
 */
import express from "express";
import request from "supertest";

// Capture the system prompt the route passes to the SDK so we can assert the
// grounded context is injected.
const createMock = jest.fn();

jest.mock("@anthropic-ai/sdk", () => {
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
      messages: { create: createMock },
    })),
  };
});

jest.mock("../utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import { housingQaRouter } from "../modules/housing-qa/routes";

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/housing-qa", housingQaRouter());
  return app;
}

const ORIGINAL_KEY = process.env.ANTHROPIC_API_KEY;

beforeEach(() => {
  createMock.mockReset();
  process.env.ANTHROPIC_API_KEY = "test-key-123";
});

afterAll(() => {
  if (ORIGINAL_KEY === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = ORIGINAL_KEY;
});

describe("POST /api/housing-qa — validation", () => {
  it("rejects an empty question with 400", async () => {
    const res = await request(makeApp())
      .post("/api/housing-qa")
      .send({ question: "" });
    expect(res.status).toBe(400);
    expect(createMock).not.toHaveBeenCalled();
  });

  it("rejects a missing question body with 400", async () => {
    const res = await request(makeApp()).post("/api/housing-qa").send({});
    expect(res.status).toBe(400);
    expect(createMock).not.toHaveBeenCalled();
  });

  it("rejects an oversized question (>1000 chars) with 400", async () => {
    const res = await request(makeApp())
      .post("/api/housing-qa")
      .send({ question: "a".repeat(1001) });
    expect(res.status).toBe(400);
    expect(createMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/housing-qa — grounded answer", () => {
  it("returns 200 { answer } and injects grounded context into the system prompt", async () => {
    createMock.mockResolvedValueOnce({
      content: [{ type: "text", text: "The application fee is $35.95 per adult." }],
    });

    const res = await request(makeApp())
      .post("/api/housing-qa")
      .send({ question: "How much is the application fee?" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      answer: "The application fee is $35.95 per adult.",
    });

    expect(createMock).toHaveBeenCalledTimes(1);
    const callArg = createMock.mock.calls[0][0];
    // model + user message wired correctly
    expect(callArg.model).toContain("haiku");
    expect(callArg.messages).toEqual([
      { role: "user", content: "How much is the application fee?" },
    ]);
    // The system prompt must carry the guardrails AND the injected context.
    expect(callArg.system).toMatch(/GROUNDING RULES \(non-negotiable\)/);
    expect(callArg.system).toMatch(/BEGIN CONTEXT/);
    expect(callArg.system).toMatch(/"routing": "process"/);
    // always-on facts injected so the answer can be grounded
    expect(callArg.system).toMatch(/\$35\.95/);
  });

  it("injects a refusal note for an unknown property", async () => {
    createMock.mockResolvedValueOnce({
      content: [{ type: "text", text: "I don't have that property." }],
    });

    const res = await request(makeApp())
      .post("/api/housing-qa")
      .send({ question: "Tell me about Moonbeam Towers" });

    expect(res.status).toBe(200);
    const callArg = createMock.mock.calls[0][0];
    expect(callArg.system).toMatch(/Moonbeam Towers/);
    expect(callArg.system).toMatch(/NOT in the statewide HUD-LIHTC or available-now data/);
  });

  it("returns 502 when the model call throws", async () => {
    createMock.mockRejectedValueOnce(new Error("upstream boom"));
    const res = await request(makeApp())
      .post("/api/housing-qa")
      .send({ question: "How much is the fee?" });
    expect(res.status).toBe(502);
    expect(res.body.error).toBeDefined();
    // the raw upstream error is never echoed to the client
    expect(JSON.stringify(res.body)).not.toMatch(/upstream boom/);
  });
});

describe("POST /api/housing-qa — missing API key", () => {
  it("returns 503 (clean) when ANTHROPIC_API_KEY is absent", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const res = await request(makeApp())
      .post("/api/housing-qa")
      .send({ question: "How much is the application fee?" });
    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/temporarily unavailable/i);
    expect(createMock).not.toHaveBeenCalled();
  });
});
