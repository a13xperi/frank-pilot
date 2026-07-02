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
// Dedicated static-header tool secret (audit C3) — the receiver refuses the
// static path unless this is set AND distinct from the webhook secret.
const TOOL_SECRET = "eltool_test_fixture_67890";

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
  process.env.ELEVENLABS_TOOL_SECRET = TOOL_SECRET;
});

afterAll(() => {
  delete process.env.VOICE_TOOLS_ENABLED;
  delete process.env.ELEVENLABS_WEBHOOK_SECRET;
  delete process.env.ELEVENLABS_TOOL_SECRET;
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

  it("tolerates a missing tool_call_id (defaults it) and proceeds to dispatch", async () => {
    // ElevenLabs convai server tools post only the request_body_schema fields,
    // not a {tool_call_id, agent_id} wrapper — so a missing tool_call_id must be
    // defaulted, NOT rejected. Requiring it 400'd every real tool call.
    mockQuery.mockResolvedValueOnce({ rows: [] }); // alreadyProcessed → no
    const bad = { ...TOOL_PAYLOAD, tool_call_id: undefined };
    const { body, header } = signedBody(bad as Record<string, unknown>);
    const res = await request(buildApp())
      .post("/api/webhooks/elevenlabs/tools/send_app_link")
      .set("Content-Type", "application/json")
      .set("ElevenLabs-Signature", header)
      .send(body);
    // No handler registered for send_app_link in this suite → Phase-A default,
    // but crucially it got PAST the auth/validate gate (200, not 400).
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(false);
    expect(mockQuery).toHaveBeenCalled();
  });

  it("rejects an unsigned call lacking the tool secret with 400", async () => {
    // The server-tool auth path: no HMAC signature AND no valid secret header.
    const res = await request(buildApp())
      .post("/api/webhooks/elevenlabs/tools/send_app_link")
      .set("Content-Type", "application/json")
      .set("x-elevenlabs-tool-secret", "wrong-secret")
      .send(JSON.stringify(TOOL_PAYLOAD));
    expect(res.status).toBe(400);
    expect(res.body.message).toBe("Invalid tool secret");
  });

  it("accepts an unsigned server-tool call carrying the valid DEDICATED secret header", async () => {
    // How real ElevenLabs server tools authenticate: no HMAC, a static secret
    // header — which must match ELEVENLABS_TOOL_SECRET (audit C3: no fallback
    // to the webhook secret).
    mockQuery.mockResolvedValueOnce({ rows: [] }); // alreadyProcessed → no
    const res = await request(buildApp())
      .post("/api/webhooks/elevenlabs/tools/send_app_link")
      .set("Content-Type", "application/json")
      .set("x-elevenlabs-tool-secret", TOOL_SECRET)
      .send(JSON.stringify(TOOL_PAYLOAD));
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(false); // unknown tool (no handler) — but authed + dispatched
    expect(mockQuery).toHaveBeenCalled();
  });

  it("503s the static path when ELEVENLABS_TOOL_SECRET is unset — the webhook secret is NOT a fallback (C3)", async () => {
    delete process.env.ELEVENLABS_TOOL_SECRET;
    // Present the WEBHOOK secret in the tool header — the pre-C3 fallback
    // accepted exactly this; it must now fail closed.
    const res = await request(buildApp())
      .post("/api/webhooks/elevenlabs/tools/send_app_link")
      .set("Content-Type", "application/json")
      .set("x-elevenlabs-tool-secret", SECRET)
      .send(JSON.stringify(TOOL_PAYLOAD));
    expect(res.status).toBe(503);
    expect(res.body.message).toBe("Tool secret not configured");
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("503s the static path when ELEVENLABS_TOOL_SECRET equals the webhook secret (separation defeated) (C3)", async () => {
    process.env.ELEVENLABS_TOOL_SECRET = SECRET;
    const res = await request(buildApp())
      .post("/api/webhooks/elevenlabs/tools/send_app_link")
      .set("Content-Type", "application/json")
      .set("x-elevenlabs-tool-secret", SECRET)
      .send(JSON.stringify(TOOL_PAYLOAD));
    expect(res.status).toBe(503);
    expect(res.body.message).toBe("Tool secret not configured");
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

describe("voice tool callbacks — static-path replay window (C3)", () => {
  // Real ElevenLabs server-tool bodies are flat (no tool_call_id), so the
  // tool_call_id dedup keys them on a random UUID and never fires. The
  // sha256(body) nonce is what bounds replay on the static-header path.
  function staticPost(bodyObj: Record<string, unknown>) {
    return request(buildApp())
      .post("/api/webhooks/elevenlabs/tools/send_app_link")
      .set("Content-Type", "application/json")
      .set("x-elevenlabs-tool-secret", TOOL_SECRET)
      .send(JSON.stringify(bodyObj));
  }

  /**
   * Route mockQuery on SQL shape and model the nonce table with a Set:
   * claim INSERT … RETURNING → claimed row on first arrival, conflict after;
   * unconditional DELETE (the handler-throw free) removes the id again.
   */
  function mockNonceStore(): Set<string> {
    const seen = new Set<string>();
    mockQuery.mockImplementation(async (sql: unknown, params?: unknown[]) => {
      const s = String(sql);
      const id = params ? String(params[0]) : "";
      if (/INSERT INTO elevenlabs_processed_events/i.test(s) && /RETURNING/i.test(s)) {
        if (seen.has(id)) return { rows: [] }; // conflict — replay suppressed
        seen.add(id);
        return { rows: [{ event_id: id }] };
      }
      if (/DELETE FROM elevenlabs_processed_events/i.test(s) && !/INTERVAL/i.test(s)) {
        seen.delete(id);
        return { rows: [] };
      }
      return { rows: [] }; // alreadyProcessed miss, TTL purge, markProcessed
    });
    return seen;
  }

  it("runs the handler once and suppresses a byte-identical replay with no second side effect", async () => {
    mockNonceStore();
    const handler: ToolHandler = jest.fn(async () => ({ ok: true, message: "done" }));
    registerToolHandler("send_app_link", handler);

    const flatBody = { phone: "+17025551212" }; // flat = no tool_call_id, like real EL traffic
    const first = await staticPost(flatBody);
    expect(first.status).toBe(200);
    expect(first.body.ok).toBe(true);
    expect(handler).toHaveBeenCalledTimes(1);

    const replay = await staticPost(flatBody);
    expect(replay.status).toBe(200);
    expect(replay.body).toEqual({
      ok: true,
      message: "Already processed",
      result: { duplicate: true },
    });
    expect(handler).toHaveBeenCalledTimes(1); // replay did NOT reach the handler

    // A different body is a different nonce — not suppressed.
    const different = await staticPost({ phone: "+17025550000" });
    expect(different.status).toBe(200);
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("frees the nonce when the handler throws, so a legitimate retry re-runs the tool", async () => {
    mockNonceStore();
    let calls = 0;
    const handler: ToolHandler = jest.fn(async () => {
      calls += 1;
      if (calls === 1) throw new Error("transient vendor melt");
      return { ok: true, message: "recovered" };
    });
    registerToolHandler("send_app_link", handler);

    const flatBody = { phone: "+17025551212" };
    const first = await staticPost(flatBody);
    expect(first.status).toBe(200);
    expect(first.body.ok).toBe(false); // soft-fail

    // The unconditional nonce free fired (DELETE without the TTL INTERVAL).
    const freeCall = mockQuery.mock.calls.find(
      (c) =>
        /DELETE FROM elevenlabs_processed_events/i.test(String(c[0])) &&
        !/INTERVAL/i.test(String(c[0]))
    );
    expect(freeCall).toBeDefined();
    expect(String((freeCall![1] as unknown[])[0])).toMatch(/^toolnonce:send_app_link:/);

    // Retry of the identical body re-runs the handler instead of being suppressed.
    const retry = await staticPost(flatBody);
    expect(retry.status).toBe(200);
    expect(retry.body.ok).toBe(true);
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("does not consult the nonce store on the HMAC-signed path (timestamp already bounds replay)", async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const handler: ToolHandler = jest.fn(async () => ({ ok: true }));
    registerToolHandler("send_app_link", handler);

    const { body, header } = signedBody(TOOL_PAYLOAD);
    const res = await request(buildApp())
      .post("/api/webhooks/elevenlabs/tools/send_app_link")
      .set("Content-Type", "application/json")
      .set("ElevenLabs-Signature", header)
      .send(body);
    expect(res.status).toBe(200);

    const nonceCall = mockQuery.mock.calls.find((c) =>
      String((c[1] as unknown[] | undefined)?.[0] ?? "").startsWith("toolnonce:")
    );
    expect(nonceCall).toBeUndefined();
  });
});

describe("voice tool callbacks — per-IP rate limit (C3)", () => {
  afterAll(() => {
    delete process.env.ELEVENLABS_TOOLS_RATE_LIMIT;
  });

  it("429s repeated auth failures from one IP once the failure budget is spent", async () => {
    // The limiter mirrors the staff-login pattern (#7b): enforced in prod,
    // opt-in elsewhere via ELEVENLABS_TOOLS_RATE_LIMIT (so this test never
    // mutates NODE_ENV, which other modules read at load time), and
    // skipSuccessfulRequests means only failure responses (>=400) count — so
    // legitimate all-200 ElevenLabs traffic is never throttled.
    process.env.ELEVENLABS_TOOLS_RATE_LIMIT = "2";
    const app = buildApp();
    const forged = () =>
      request(app)
        .post("/api/webhooks/elevenlabs/tools/send_app_link")
        .set("Content-Type", "application/json")
        .set("x-elevenlabs-tool-secret", "wrong-secret")
        .send(JSON.stringify(TOOL_PAYLOAD));

    expect((await forged()).status).toBe(400);
    expect((await forged()).status).toBe(400);
    expect((await forged()).status).toBe(429); // budget of 2 failures exhausted
  });
});
