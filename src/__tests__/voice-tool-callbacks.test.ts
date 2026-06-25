/**
 * Tests for src/modules/voice-intake/tool-callbacks.ts — the in-call server-
 * tool receiver mounted at POST /api/webhooks/elevenlabs/tools/:tool_name.
 *
 * Same HMAC + raw-body discipline as the post-call webhook spec: we compute
 * the signature directly, send it via header, and assert against the SQL the
 * router fires (idempotency lookup, processed-event insert) plus the tape
 * stamp side-effect.
 *
 * Phase A invariant under test: dispatch registry is empty by default, so
 * every well-signed call hits the "unknown tool" branch and returns 200 with
 * { ok: false }. A test-only handler registration covers the "happy path"
 * branch end-to-end.
 *
 * Status-code policy (see tool-callbacks.ts header):
 *   - 503 when flag off / sentinel secret
 *   - 400 only on AUTH layer (sig, replay, body parse, payload validation)
 *   - 200 for everything else, even handler failure
 */

import express from "express";
import request from "supertest";
import crypto from "crypto";

const SECRET = "wsec_test_fixture_12345";

const mockQuery = jest.fn();
jest.mock("../config/database", () => ({
  query: (...args: unknown[]) => mockQuery(...args),
}));

jest.mock("../utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const mockStampTape = jest.fn().mockResolvedValue(null);
jest.mock("../modules/tape", () => {
  const real = jest.requireActual("../modules/tape");
  return { ...real, stampTape: mockStampTape };
});

import toolCallbackRouter, {
  registerToolHandler,
  clearToolHandlersForTests,
  type ToolHandler,
} from "../modules/voice-intake/tool-callbacks";

function buildApp(): express.Express {
  const app = express();
  app.use("/api/webhooks/elevenlabs/tools", toolCallbackRouter);
  return app;
}

function signedBody(
  payload: Record<string, unknown>,
  opts?: { skewSecs?: number; tamper?: boolean; secret?: string }
): { body: string; header: string; ts: number } {
  const ts = Math.floor(Date.now() / 1000) + (opts?.skewSecs ?? 0);
  const body = JSON.stringify(payload);
  const secret = opts?.secret ?? SECRET;
  const sig = crypto
    .createHmac("sha256", secret)
    .update(`${ts}.`)
    .update(body, "utf8")
    .digest("hex");
  // Tamper by flipping the last hex char to a *guaranteed-different* value.
  // (Naively forcing it to "0" is a no-op ~1/16 of the time — when the real
  // signature already ends in "0" — which made this test flake in CI.)
  const finalSig = opts?.tamper
    ? sig.slice(0, -1) + (sig.endsWith("0") ? "1" : "0")
    : sig;
  return { body, header: `t=${ts},v0=${finalSig}`, ts };
}

const TOOL_PAYLOAD = {
  tool_call_id: "tc_TEST_abc123",
  agent_id: "agent_8001ksp9ar8cf8ct2x70kacxr8qq",
  conversation_id: "conv_TEST_456",
  parameters: { phone: "+17025551212" },
};

beforeEach(() => {
  jest.clearAllMocks();
  clearToolHandlersForTests();
  process.env.VOICE_TOOLS_ENABLED = "true";
  process.env.ELEVENLABS_WEBHOOK_SECRET = SECRET;
});

afterAll(() => {
  delete process.env.VOICE_TOOLS_ENABLED;
  delete process.env.ELEVENLABS_WEBHOOK_SECRET;
});

describe("voice tool callbacks — auth layer", () => {
  it("returns 503 when VOICE_TOOLS_ENABLED is off", async () => {
    process.env.VOICE_TOOLS_ENABLED = "false";
    const { body, header } = signedBody(TOOL_PAYLOAD);
    const res = await request(buildApp())
      .post("/api/webhooks/elevenlabs/tools/send_app_link")
      .set("Content-Type", "application/json")
      .set("ElevenLabs-Signature", header)
      .send(body);
    expect(res.status).toBe(503);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("returns 503 when secret is sentinel", async () => {
    process.env.ELEVENLABS_WEBHOOK_SECRET = "wsec_changeme";
    const { body, header } = signedBody(TOOL_PAYLOAD);
    const res = await request(buildApp())
      .post("/api/webhooks/elevenlabs/tools/send_app_link")
      .set("Content-Type", "application/json")
      .set("ElevenLabs-Signature", header)
      .send(body);
    expect(res.status).toBe(503);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("rejects tampered signature with 400", async () => {
    const { body, header } = signedBody(TOOL_PAYLOAD, { tamper: true });
    const res = await request(buildApp())
      .post("/api/webhooks/elevenlabs/tools/send_app_link")
      .set("Content-Type", "application/json")
      .set("ElevenLabs-Signature", header)
      .send(body);
    expect(res.status).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
    expect(mockStampTape).not.toHaveBeenCalled();
  });

  it("rejects stale timestamp with 400", async () => {
    const { body, header } = signedBody(TOOL_PAYLOAD, { skewSecs: -60 * 60 });
    const res = await request(buildApp())
      .post("/api/webhooks/elevenlabs/tools/send_app_link")
      .set("Content-Type", "application/json")
      .set("ElevenLabs-Signature", header)
      .send(body);
    expect(res.status).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("rejects missing signature header with 400", async () => {
    const res = await request(buildApp())
      .post("/api/webhooks/elevenlabs/tools/send_app_link")
      .set("Content-Type", "application/json")
      .send(JSON.stringify(TOOL_PAYLOAD));
    expect(res.status).toBe(400);
  });

  it("rejects payload missing tool_call_id with 400", async () => {
    const bad = { ...TOOL_PAYLOAD, tool_call_id: undefined };
    const { body, header } = signedBody(bad as Record<string, unknown>);
    const res = await request(buildApp())
      .post("/api/webhooks/elevenlabs/tools/send_app_link")
      .set("Content-Type", "application/json")
      .set("ElevenLabs-Signature", header)
      .send(body);
    expect(res.status).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("rejects body tool_name mismatching URL with 400", async () => {
    const bad = { ...TOOL_PAYLOAD, tool_name: "lookup_tenant" };
    const { body, header } = signedBody(bad);
    const res = await request(buildApp())
      .post("/api/webhooks/elevenlabs/tools/send_app_link")
      .set("Content-Type", "application/json")
      .set("ElevenLabs-Signature", header)
      .send(body);
    expect(res.status).toBe(400);
  });
});

describe("voice tool callbacks — dispatch", () => {
  it("returns 200 { ok: false } for unknown tool (Phase A default)", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // alreadyProcessed → no

    const { body, header } = signedBody(TOOL_PAYLOAD);
    const res = await request(buildApp())
      .post("/api/webhooks/elevenlabs/tools/send_app_link")
      .set("Content-Type", "application/json")
      .set("ElevenLabs-Signature", header)
      .send(body);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      ok: false,
      message: "Tool not yet implemented",
    });

    // Tape stamp fires with reason=unknown-tool so we can audit which tools
    // the agent is trying to call before a handler exists.
    expect(mockStampTape).toHaveBeenCalledTimes(1);
    expect(mockStampTape.mock.calls[0][0]).toMatchObject({
      kind: "VOICE_TOOL_INVOKED",
      sessionId: "conv_TEST_456",
      payload: expect.objectContaining({
        toolName: "send_app_link",
        ok: false,
        reason: "unknown-tool",
      }),
    });

    // markProcessed must NOT fire — keep the event re-deliverable once we
    // wire the handler.
    const markCall = mockQuery.mock.calls.find((c) =>
      String(c[0]).includes("INSERT INTO elevenlabs_processed_events")
    );
    expect(markCall).toBeUndefined();
  });

  it("dispatches to a registered handler and stamps tape on success", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // alreadyProcessed → miss
      .mockResolvedValueOnce({ rows: [] }); // markProcessed

    const handler: ToolHandler = jest.fn(async (params, ctx) => ({
      ok: true,
      result: { delivered: true, echoedPhone: (params as { phone: string }).phone },
      message: `sent to conversation ${ctx.conversationId}`,
    }));
    registerToolHandler("send_app_link", handler);

    const { body, header } = signedBody(TOOL_PAYLOAD);
    const res = await request(buildApp())
      .post("/api/webhooks/elevenlabs/tools/send_app_link")
      .set("Content-Type", "application/json")
      .set("ElevenLabs-Signature", header)
      .send(body);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      ok: true,
      result: { delivered: true, echoedPhone: "+17025551212" },
      message: "sent to conversation conv_TEST_456",
    });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(
      { phone: "+17025551212" },
      {
        agentId: TOOL_PAYLOAD.agent_id,
        conversationId: "conv_TEST_456",
        toolCallId: "tc_TEST_abc123",
        toolName: "send_app_link",
      }
    );

    expect(mockStampTape).toHaveBeenCalledTimes(1);
    expect(mockStampTape.mock.calls[0][0]).toMatchObject({
      kind: "VOICE_TOOL_INVOKED",
      sessionId: "conv_TEST_456",
      payload: expect.objectContaining({
        toolName: "send_app_link",
        toolCallId: "tc_TEST_abc123",
        ok: true,
      }),
    });

    // markProcessed fires last so a retry of the same tool_call_id dedupes.
    const markCall = mockQuery.mock.calls.find((c) =>
      String(c[0]).includes("INSERT INTO elevenlabs_processed_events")
    );
    expect(markCall).toBeDefined();
    expect(markCall![1]).toEqual([
      "tool:conv_TEST_456:tc_TEST_abc123",
      "tool:send_app_link",
      "conv_TEST_456",
    ]);
  });

  it("short-circuits a duplicate tool_call_id with 200 and skips the handler", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ exists: 1 }] }); // alreadyProcessed → hit

    const handler: ToolHandler = jest.fn();
    registerToolHandler("send_app_link", handler);

    const { body, header } = signedBody(TOOL_PAYLOAD);
    const res = await request(buildApp())
      .post("/api/webhooks/elevenlabs/tools/send_app_link")
      .set("Content-Type", "application/json")
      .set("ElevenLabs-Signature", header)
      .send(body);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      ok: true,
      message: "Already processed",
      result: { duplicate: true },
    });
    expect(handler).not.toHaveBeenCalled();
    // Only the dedupe SELECT ran.
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockStampTape).not.toHaveBeenCalled();
  });

  it("soft-fails when handler throws — 200 { ok: false }, no markProcessed", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // alreadyProcessed → miss

    const handler: ToolHandler = jest.fn(async () => {
      throw new Error("twilio melted");
    });
    registerToolHandler("send_app_link", handler);

    const { body, header } = signedBody(TOOL_PAYLOAD);
    const res = await request(buildApp())
      .post("/api/webhooks/elevenlabs/tools/send_app_link")
      .set("Content-Type", "application/json")
      .set("ElevenLabs-Signature", header)
      .send(body);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      ok: false,
      message: "Sorry, something went wrong on our end.",
    });

    // Handler-threw tape stamp lands so we can grep audit logs for failures.
    expect(mockStampTape).toHaveBeenCalledTimes(1);
    expect(mockStampTape.mock.calls[0][0]).toMatchObject({
      kind: "VOICE_TOOL_INVOKED",
      payload: expect.objectContaining({
        reason: "handler-threw",
        error: "twilio melted",
      }),
    });

    // Event NOT marked processed so a retry/manual re-deliver can re-fire.
    const markCall = mockQuery.mock.calls.find((c) =>
      String(c[0]).includes("INSERT INTO elevenlabs_processed_events")
    );
    expect(markCall).toBeUndefined();
  });
});

describe("voice tool callbacks — EL ConvAI webhook-tool contract (secret header + flat body)", () => {
  const TOOL_SECRET = "tsec_test_fixture_67890";

  beforeEach(() => {
    process.env.VOICE_TOOL_SECRET = TOOL_SECRET;
  });
  afterEach(() => {
    delete process.env.VOICE_TOOL_SECRET;
  });

  it("authenticates via X-Frank-Tool-Secret and passes the FLAT body as params", async () => {
    const handler: ToolHandler = jest.fn(async (params) => ({
      ok: true,
      result: { echoed: (params as { query: string }).query },
      message: "ok",
    }));
    registerToolHandler("web_search", handler);

    const res = await request(buildApp())
      .post("/api/webhooks/elevenlabs/tools/web_search")
      .set("Content-Type", "application/json")
      .set("X-Frank-Tool-Secret", TOOL_SECRET)
      .send(JSON.stringify({ query: "bus routes near 1700 E Charleston" }));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      ok: true,
      result: { echoed: "bus routes near 1700 E Charleston" },
      message: "ok",
    });
    // Flat body, no ids → handler gets the params verbatim with empty ctx ids.
    expect(handler).toHaveBeenCalledWith(
      { query: "bus routes near 1700 E Charleston" },
      { agentId: "", conversationId: "", toolCallId: "", toolName: "web_search" }
    );
    // No conversation/tool ids → idempotency layer is skipped entirely.
    expect(
      mockQuery.mock.calls.find((c) => String(c[0]).includes("elevenlabs_processed_events"))
    ).toBeUndefined();
  });

  it("rejects a wrong secret header with 400 (no HMAC present)", async () => {
    const handler: ToolHandler = jest.fn();
    registerToolHandler("web_search", handler);

    const res = await request(buildApp())
      .post("/api/webhooks/elevenlabs/tools/web_search")
      .set("Content-Type", "application/json")
      .set("X-Frank-Tool-Secret", "wrong-secret-value-here")
      .send(JSON.stringify({ query: "x" }));

    expect(res.status).toBe(400);
    expect(handler).not.toHaveBeenCalled();
  });

  it("still honors a nested `parameters` object when present", async () => {
    const handler: ToolHandler = jest.fn(async () => ({ ok: true }));
    registerToolHandler("web_search", handler);

    await request(buildApp())
      .post("/api/webhooks/elevenlabs/tools/web_search")
      .set("Content-Type", "application/json")
      .set("X-Frank-Tool-Secret", TOOL_SECRET)
      .send(
        JSON.stringify({
          conversation_id: "conv_X",
          parameters: { query: "nested form" },
        })
      );

    expect(handler).toHaveBeenCalledWith(
      { query: "nested form" },
      expect.objectContaining({ conversationId: "conv_X", toolName: "web_search" })
    );
  });
});
