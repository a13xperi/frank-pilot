/**
 * C4 wiring tests for the voice-intake webhook: the delivered post-call
 * transcript is the evidence chain that upgrades voice-minted (unverified)
 * FCRA authorizations, so webhook.ts must actually CALL
 * verifyVoiceAuthorizationForConversation(conversation_id, transcript) —
 * BEFORE the VOICE_INTAKE_ENABLED persistence gate (VOICE_TOOLS_ENABLED can
 * mint consent rows while intake persistence is dark), and a verify failure
 * must never fail the webhook. The sibling suite (voice-intake-webhook.test.ts)
 * covers signature/idempotency/DLQ at the DB level; this one mocks the consent
 * module boundary so the call itself is asserted.
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

jest.mock("../modules/tape", () => {
  const real = jest.requireActual("../modules/tape");
  return { ...real, stampTape: jest.fn().mockResolvedValue(null) };
});

const mockVerify = jest.fn();
jest.mock("../modules/screening/consumer-report-consent", () => {
  const real = jest.requireActual("../modules/screening/consumer-report-consent");
  return {
    ...real,
    verifyVoiceAuthorizationForConversation: (...args: unknown[]) => mockVerify(...args),
  };
});

const mockPersist = jest.fn();
jest.mock("../modules/voice-intake/service", () => {
  const real = jest.requireActual("../modules/voice-intake/service");
  return { ...real, persistConversation: (...args: unknown[]) => mockPersist(...args) };
});

jest.mock("../modules/voice-intake/inbound-notify", () => ({
  maybeNotifyInbound: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../modules/outbound-validation/outcome", () => ({
  isOutboundValidationEvent: () => false,
  handleOutboundPostCall: jest.fn(),
}));
jest.mock("../modules/care-line", () => ({
  isCareLineEvent: () => false,
  handleCareLinePostCall: jest.fn(),
}));
jest.mock("../modules/caller-history/service", () => ({
  updateCallerHistory: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../modules/follow-ups/service", () => ({
  findFollowUpByConversation: jest.fn().mockResolvedValue(null),
  recordFollowUpOutcome: jest.fn().mockResolvedValue(undefined),
  maybeCreateCutoffCallback: jest.fn().mockResolvedValue(undefined),
}));

// ── Import under test (must come after the mocks above) ───────────────────

import webhookRouter from "../modules/voice-intake/webhook";
import { logger } from "../utils/logger";

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

const TRANSCRIPT = [
  { role: "agent", message: "This authorizes a background and credit check. Do you agree?" },
  { role: "user", message: "Yes, I agree." },
];

const PAYLOAD = {
  type: "post_call_transcription",
  event_timestamp: 1700000000,
  data: {
    conversation_id: "conv_C4_1",
    agent_id: "agent_8001ksp9ar8cf8ct2x70kacxr8qq",
    status: "done",
    transcript: TRANSCRIPT,
    metadata: { start_time_unix_secs: 1700000000, call_duration_secs: 60 },
    analysis: { call_successful: "success" },
  },
};

/** Let the fire-and-forget verify (and its .catch) settle. */
const flushDetached = () => new Promise((resolve) => setImmediate(resolve));

async function postSigned() {
  const { body, header } = signedBody(PAYLOAD);
  return request(buildApp())
    .post("/api/webhooks/elevenlabs/post-call")
    .set("Content-Type", "application/json")
    .set("ElevenLabs-Signature", header)
    .send(body);
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.VOICE_INTAKE_ENABLED = "true";
  delete process.env.FRANK_OUTBOUND_ENABLED;
  process.env.ELEVENLABS_WEBHOOK_SECRET = SECRET;
  mockQuery.mockResolvedValue({ rows: [] }); // alreadyProcessed miss + markProcessed
  mockVerify.mockResolvedValue(undefined);
  mockPersist.mockResolvedValue({ id: "11111111-1111-1111-1111-111111111111" });
});

afterAll(() => {
  delete process.env.VOICE_INTAKE_ENABLED;
  delete process.env.FRANK_OUTBOUND_ENABLED;
  delete process.env.ELEVENLABS_WEBHOOK_SECRET;
});

describe("voice-intake webhook — C4 consent transcript verification", () => {
  it("calls verifyVoiceAuthorizationForConversation with the conversation id and delivered transcript", async () => {
    const res = await postSigned();
    await flushDetached();

    expect(res.status).toBe(200);
    expect(mockVerify).toHaveBeenCalledTimes(1);
    expect(mockVerify).toHaveBeenCalledWith("conv_C4_1", TRANSCRIPT);
    expect(mockPersist).toHaveBeenCalledTimes(1);
  });

  it("verifies BEFORE the intake gate: fires even while intake persistence is dark", async () => {
    // Receiver open via the outbound flag, but VOICE_INTAKE_ENABLED off —
    // VOICE_TOOLS_ENABLED can mint consent rows while intake is dark, so the
    // upgrade must not be gated on persistence.
    process.env.VOICE_INTAKE_ENABLED = "false";
    process.env.FRANK_OUTBOUND_ENABLED = "true";

    const res = await postSigned();
    await flushDetached();

    expect(res.status).toBe(200);
    expect(mockVerify).toHaveBeenCalledTimes(1);
    expect(mockVerify).toHaveBeenCalledWith("conv_C4_1", TRANSCRIPT);
    expect(mockPersist).not.toHaveBeenCalled();
  });

  it("a thrown verify is non-fatal: webhook still 200s and the intake still persists", async () => {
    mockVerify.mockRejectedValueOnce(new Error("consent table unavailable"));

    const res = await postSigned();
    await flushDetached();

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: true });
    expect(mockPersist).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(
      "voice consent transcript verification failed (non-fatal)",
      expect.objectContaining({ conversationId: "conv_C4_1", error: "consent table unavailable" })
    );
  });
});
