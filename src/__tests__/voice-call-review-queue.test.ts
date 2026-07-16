/**
 * Tests for src/modules/voice-intake/call-review-queue.ts and its webhook
 * wiring — Feedback-loop Phase 2 ("review every call").
 *
 * Unit layer: flag gating, insert shape, idempotency clause.
 * Integration layer: through the signed webhook router — the enqueue fires
 * for EVERY line (including outbound-validation events that skip intake
 * persistence), and a queue failure never breaks the 200/mark-processed path.
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

const mockHandleOutboundPostCall = jest.fn().mockResolvedValue(undefined);
jest.mock("../modules/outbound-validation/outcome", () => {
  const real = jest.requireActual("../modules/outbound-validation/outcome");
  return {
    ...real,
    handleOutboundPostCall: (...args: unknown[]) => mockHandleOutboundPostCall(...args),
  };
});

// ── Imports under test (must come after the mocks above) ───────────────────

import webhookRouter from "../modules/voice-intake/webhook";
import {
  enqueueCallReview,
  isCallReviewQueueEnabled,
} from "../modules/voice-intake/call-review-queue";

const OUTBOUND_AGENT_ID = "agent_outbound_test_123";

function buildApp(): express.Express {
  const app = express();
  app.use("/api/webhooks/elevenlabs/post-call", webhookRouter);
  return app;
}

function signedBody(payload: Record<string, unknown>): { body: string; header: string } {
  const ts = Math.floor(Date.now() / 1000);
  const body = JSON.stringify(payload);
  const sig = crypto
    .createHmac("sha256", SECRET)
    .update(`${ts}.`)
    .update(body, "utf8")
    .digest("hex");
  return { body, header: `t=${ts},v0=${sig}` };
}

function basePayload(conversationId: string, agentId: string) {
  return {
    type: "post_call_transcription",
    data: {
      conversation_id: conversationId,
      agent_id: agentId,
      metadata: { start_time_unix_secs: 1752680000, call_duration_secs: 87 },
      analysis: {},
    },
  };
}

/** SQL-substring router for the mocked query() — everything defaults to empty. */
function routeQueries(overrides?: {
  onQueueInsert?: () => Promise<unknown>;
}): void {
  mockQuery.mockImplementation(async (sql: string) => {
    if (sql.includes("INSERT INTO call_review_queue") && overrides?.onQueueInsert) {
      return overrides.onQueueInsert();
    }
    if (sql.includes("COUNT(*)")) return { rows: [{ count: 0 }] };
    return { rows: [] };
  });
}

function queueInsertCalls(): unknown[][] {
  return mockQuery.mock.calls.filter(([sql]) =>
    String(sql).includes("INSERT INTO call_review_queue")
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.ELEVENLABS_WEBHOOK_SECRET = SECRET;
  process.env.FRANK_OUTBOUND_ENABLED = "true";
  process.env.VOICE_INTAKE_ENABLED = "false";
  process.env.CARE_LINE_ENABLED = "false";
  process.env.ELEVENLABS_OUTBOUND_AGENT_ID = OUTBOUND_AGENT_ID;
  process.env.CALL_REVIEW_QUEUE_ENABLED = "true";
  routeQueries();
});

afterAll(() => {
  delete process.env.CALL_REVIEW_QUEUE_ENABLED;
  delete process.env.ELEVENLABS_OUTBOUND_AGENT_ID;
});

// ── Unit: enqueueCallReview ────────────────────────────────────────────────

describe("enqueueCallReview (unit)", () => {
  it("is a no-op when CALL_REVIEW_QUEUE_ENABLED is not 'true'", async () => {
    process.env.CALL_REVIEW_QUEUE_ENABLED = "false";
    expect(isCallReviewQueueEnabled()).toBe(false);
    await enqueueCallReview(
      { conversation_id: "conv_a", agent_id: "agent_a" },
      "post_call_transcription"
    );
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("inserts ids + timing only, with the ON CONFLICT idempotency clause", async () => {
    await enqueueCallReview(
      {
        conversation_id: "conv_b",
        agent_id: "agent_b",
        metadata: { start_time_unix_secs: 1752680000, call_duration_secs: 42 },
      },
      "post_call_audio"
    );
    expect(queueInsertCalls()).toHaveLength(1);
    const [sql, params] = queueInsertCalls()[0] as [string, unknown[]];
    expect(sql).toContain("ON CONFLICT (conversation_id) DO NOTHING");
    expect(params).toEqual(["conv_b", "agent_b", "post_call_audio", 1752680000, 42]);
  });

  it("tolerates missing metadata (nulls, not throws)", async () => {
    await enqueueCallReview(
      { conversation_id: "conv_c", agent_id: "agent_c" },
      "post_call_transcription"
    );
    const [, params] = queueInsertCalls()[0] as [string, unknown[]];
    expect(params).toEqual(["conv_c", "agent_c", "post_call_transcription", null, null]);
  });
});

// ── Integration: through the signed webhook router ─────────────────────────

describe("webhook wiring (integration)", () => {
  it("enqueues an outbound-validation call even though intake persistence is skipped", async () => {
    const payload = basePayload("conv_outbound_1", OUTBOUND_AGENT_ID);
    const { body, header } = signedBody(payload);

    const res = await request(buildApp())
      .post("/api/webhooks/elevenlabs/post-call")
      .set("Content-Type", "application/json")
      .set("ElevenLabs-Signature", header)
      .send(body);

    expect(res.status).toBe(200);
    expect(mockHandleOutboundPostCall).toHaveBeenCalledTimes(1);
    expect(queueInsertCalls()).toHaveLength(1);
    const [, params] = queueInsertCalls()[0] as [string, unknown[]];
    expect(params[0]).toBe("conv_outbound_1");
  });

  it("does not enqueue when the flag is off", async () => {
    process.env.CALL_REVIEW_QUEUE_ENABLED = "false";
    const payload = basePayload("conv_outbound_2", OUTBOUND_AGENT_ID);
    const { body, header } = signedBody(payload);

    const res = await request(buildApp())
      .post("/api/webhooks/elevenlabs/post-call")
      .set("Content-Type", "application/json")
      .set("ElevenLabs-Signature", header)
      .send(body);

    expect(res.status).toBe(200);
    expect(queueInsertCalls()).toHaveLength(0);
  });

  it("still 200s and marks the event processed when the queue insert rejects", async () => {
    routeQueries({
      onQueueInsert: () => Promise.reject(new Error("queue table on fire")),
    });
    const payload = basePayload("conv_outbound_3", OUTBOUND_AGENT_ID);
    const { body, header } = signedBody(payload);

    const res = await request(buildApp())
      .post("/api/webhooks/elevenlabs/post-call")
      .set("Content-Type", "application/json")
      .set("ElevenLabs-Signature", header)
      .send(body);

    expect(res.status).toBe(200);
    // Dispatch succeeded (the enqueue is fire-and-forget), so the event is
    // marked processed — NOT parked in the DLQ.
    const processed = mockQuery.mock.calls.filter(([sql]) =>
      String(sql).includes("INSERT INTO elevenlabs_processed_events")
    );
    const dlq = mockQuery.mock.calls.filter(([sql]) =>
      String(sql).includes("INSERT INTO elevenlabs_webhook_dlq")
    );
    expect(processed).toHaveLength(1);
    expect(dlq).toHaveLength(0);
  });
});
