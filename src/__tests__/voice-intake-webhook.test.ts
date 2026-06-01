/**
 * Webhook tests for src/modules/voice-intake/webhook.ts.
 *
 * Signature path: we compute `HMAC-SHA256(secret, "<ts>.<rawBody>")` directly
 * (mirrors ElevenLabs' signing scheme) and send it as `ElevenLabs-Signature:
 * t=<ts>,v0=<hex>`. The router verifies against the same secret and either
 * accepts or rejects.
 *
 * The DB layer is mocked end-to-end so the test is hermetic — we assert on
 * the exact SQL we expect (alreadyProcessed lookup, persistConversation
 * upsert, markProcessed insert) and on the tape stamp side-effect.
 *
 * Mount order: the webhook router installs its own `express.raw` body parser.
 * The test app does NOT install `express.json()`, mirroring the production
 * order in src/index.ts: webhook MUST sit before json().
 */

import express from "express";
import request from "supertest";
import crypto from "crypto";

const SECRET = "wsec_test_fixture_12345";

// ── Mocks (must be declared before module imports) ─────────────────────────

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

const mockSendMagicLinkSms = jest.fn();
jest.mock("../modules/auth/magic-link-service", () => ({
  sendMagicLinkSms: mockSendMagicLinkSms,
}));

// ── Import under test (must come after the mocks above) ───────────────────

import webhookRouter, { __test } from "../modules/voice-intake/webhook";

function buildApp(): express.Express {
  const app = express();
  app.use("/api/webhooks/elevenlabs/post-call", webhookRouter);
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

const PAYLOAD = {
  type: "post_call_transcription",
  event_timestamp: 1700000000,
  data: {
    conversation_id: "conv_TEST_123",
    agent_id: "agent_8001ksp9ar8cf8ct2x70kacxr8qq",
    status: "done",
    metadata: {
      start_time_unix_secs: 1700000000,
      call_duration_secs: 120,
      detected_language: "en",
      cost: { llm_input_tokens: 1500 },
    },
    analysis: {
      call_successful: "success",
      evaluation_criteria_results: { name: { result: "success" } },
      data_collection_results: {
        name: { value: "Maria Garcia" },
        phone: { value: "+17025551212" },
        current_city: { value: "Las Vegas" },
      },
    },
  },
};

beforeEach(() => {
  jest.clearAllMocks();
  process.env.VOICE_INTAKE_ENABLED = "true";
  process.env.ELEVENLABS_WEBHOOK_SECRET = SECRET;
});

afterAll(() => {
  delete process.env.VOICE_INTAKE_ENABLED;
  delete process.env.ELEVENLABS_WEBHOOK_SECRET;
});

describe("voice-intake webhook", () => {
  it("returns 503 when VOICE_INTAKE_ENABLED is off", async () => {
    process.env.VOICE_INTAKE_ENABLED = "false";
    const { body, header } = signedBody(PAYLOAD);
    const res = await request(buildApp())
      .post("/api/webhooks/elevenlabs/post-call")
      .set("Content-Type", "application/json")
      .set("ElevenLabs-Signature", header)
      .send(body);
    expect(res.status).toBe(503);
  });

  it("returns 503 when secret is sentinel", async () => {
    process.env.ELEVENLABS_WEBHOOK_SECRET = "wsec_changeme";
    const { body, header } = signedBody(PAYLOAD);
    const res = await request(buildApp())
      .post("/api/webhooks/elevenlabs/post-call")
      .set("Content-Type", "application/json")
      .set("ElevenLabs-Signature", header)
      .send(body);
    expect(res.status).toBe(503);
  });

  it("rejects tampered signature with 400", async () => {
    const { body, header } = signedBody(PAYLOAD, { tamper: true });
    const res = await request(buildApp())
      .post("/api/webhooks/elevenlabs/post-call")
      .set("Content-Type", "application/json")
      .set("ElevenLabs-Signature", header)
      .send(body);
    expect(res.status).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("rejects stale timestamp with 400 (replay window)", async () => {
    const { body, header } = signedBody(PAYLOAD, { skewSecs: -60 * 60 });
    const res = await request(buildApp())
      .post("/api/webhooks/elevenlabs/post-call")
      .set("Content-Type", "application/json")
      .set("ElevenLabs-Signature", header)
      .send(body);
    expect(res.status).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("rejects missing header with 400", async () => {
    const res = await request(buildApp())
      .post("/api/webhooks/elevenlabs/post-call")
      .set("Content-Type", "application/json")
      .send(JSON.stringify(PAYLOAD));
    expect(res.status).toBe(400);
  });

  it("accepts a valid signed payload, persists call, stamps tape, returns 200", async () => {
    mockQuery
      // alreadyProcessed → no rows
      .mockResolvedValueOnce({ rows: [] })
      // persistConversation upsert → returns id
      .mockResolvedValueOnce({ rows: [{ id: "11111111-1111-1111-1111-111111111111" }] })
      // markProcessed
      .mockResolvedValueOnce({ rows: [] });

    const { body, header } = signedBody(PAYLOAD);
    const res = await request(buildApp())
      .post("/api/webhooks/elevenlabs/post-call")
      .set("Content-Type", "application/json")
      .set("ElevenLabs-Signature", header)
      .send(body);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: true });

    // L2 dedupe checked first.
    const firstSql = mockQuery.mock.calls[0][0] as string;
    expect(firstSql).toContain("FROM elevenlabs_processed_events");

    // Upsert into voice_intake_calls fired with the conversation_id payload.
    const upsertCall = mockQuery.mock.calls.find((c) =>
      String(c[0]).includes("INSERT INTO voice_intake_calls")
    );
    expect(upsertCall).toBeDefined();
    expect(upsertCall![1]).toEqual(
      expect.arrayContaining(["conv_TEST_123", PAYLOAD.data.agent_id])
    );

    // markProcessed fired.
    const markCall = mockQuery.mock.calls.find((c) =>
      String(c[0]).includes("INSERT INTO elevenlabs_processed_events")
    );
    expect(markCall).toBeDefined();

    // Compliance stamp fired with the right kind + conversation id.
    expect(mockStampTape).toHaveBeenCalledTimes(1);
    expect(mockStampTape.mock.calls[0][0]).toMatchObject({
      kind: "VOICE_INTAKE_COMPLETED",
      sessionId: "conv_TEST_123",
    });
  });

  it("short-circuits a duplicate event with 200 and skips dispatch", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ exists: 1 }] }); // alreadyProcessed → hit

    const { body, header } = signedBody(PAYLOAD);
    const res = await request(buildApp())
      .post("/api/webhooks/elevenlabs/post-call")
      .set("Content-Type", "application/json")
      .set("ElevenLabs-Signature", header)
      .send(body);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: true, duplicate: true });
    // Only the dedupe SELECT ran — no upsert, no markProcessed.
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockStampTape).not.toHaveBeenCalled();
  });

  it("parks failures in DLQ and still 200s ElevenLabs", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // alreadyProcessed
      .mockRejectedValueOnce(new Error("simulated upsert failure")) // persistConversation throws
      // DLQ probe: not yet parked
      .mockResolvedValueOnce({ rows: [] })
      // DLQ row count under cap
      .mockResolvedValueOnce({ rows: [{ count: 0 }] })
      // DLQ insert
      .mockResolvedValueOnce({ rows: [] });

    const { body, header } = signedBody(PAYLOAD);
    const res = await request(buildApp())
      .post("/api/webhooks/elevenlabs/post-call")
      .set("Content-Type", "application/json")
      .set("ElevenLabs-Signature", header)
      .send(body);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: true });

    const dlqInsert = mockQuery.mock.calls.find((c) =>
      String(c[0]).includes("INSERT INTO elevenlabs_webhook_dlq")
    );
    expect(dlqInsert).toBeDefined();
    expect(dlqInsert![1][3]).toBe("simulated upsert failure");

    // markProcessed must NOT fire on a dispatch failure — otherwise the next
    // delivery would short-circuit and we'd silently drop the event.
    const markCall = mockQuery.mock.calls.find((c) =>
      String(c[0]).includes("INSERT INTO elevenlabs_processed_events")
    );
    expect(markCall).toBeUndefined();
  });
});

describe("voice-intake signature helpers", () => {
  it("parses a well-formed header", () => {
    const out = __test.parseSignatureHeader("t=12345,v0=abc");
    expect(out).toEqual({ timestamp: 12345, signatures: ["abc"] });
  });

  it("accepts multiple v0 signatures (rotation window)", () => {
    const out = __test.parseSignatureHeader("t=12345,v0=aaa,v0=bbb");
    expect(out?.signatures).toEqual(["aaa", "bbb"]);
  });

  it("rejects a header with no timestamp", () => {
    expect(__test.parseSignatureHeader("v0=abc")).toBeNull();
  });

  it("rejects a header with no signature", () => {
    expect(__test.parseSignatureHeader("t=12345")).toBeNull();
  });

  it("computes a stable HMAC for fixed inputs", () => {
    const sig = __test.computeSignature("secret", 1, Buffer.from("hello"));
    expect(sig).toBe(
      crypto.createHmac("sha256", "secret").update("1.").update("hello").digest("hex")
    );
  });
});
