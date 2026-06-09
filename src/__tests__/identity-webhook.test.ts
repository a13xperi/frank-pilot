/**
 * Webhook tests for the Stripe Identity verdict path in
 * src/modules/payment/webhook.ts (Phase 4b).
 *
 * Mirrors payment-webhook.test.ts: real Stripe SDK for the signature
 * round-trip, mocked DB + collaborators for the side-effects. The heavy
 * collaborators (state-machine transition, the screening pipeline, the
 * mapper, audit) are mocked so these tests assert the WEBHOOK's routing /
 * persistence / HOLD behavior — not those units (which have their own suites).
 *
 * getStripe() returns the REAL webhooks helper (so constructEvent does a real
 * HMAC check) but a MOCKED identity.verificationSessions.retrieve — the real
 * retrieve would hit the network.
 */

import express from "express";
import request from "supertest";
import Stripe from "stripe";

const FAKE_KEY = "sk_test_signing_only_does_not_call_api";
const WEBHOOK_SECRET = "whsec_test_fixture_secret_abcdef";
const stripe = new Stripe(FAKE_KEY, { apiVersion: "2026-05-27.dahlia" });

const mockRetrieve = jest.fn();
const mockMapStripeSessionToResult = jest.fn();
const mockTransition = jest.fn();
const mockRunFullScreening = jest.fn();

jest.mock("../config/database", () => ({ query: jest.fn(), transaction: jest.fn() }));
jest.mock("../utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock("../middleware/audit", () => ({ writeAuditLog: jest.fn().mockResolvedValue(undefined) }));
jest.mock("../utils/encryption", () => ({ decrypt: (v: string) => `decrypted(${v})` }));
jest.mock("../modules/tape", () => ({ stampTape: jest.fn().mockResolvedValue(null) }));
jest.mock("../modules/ledger/service", () => ({
  LedgerService: jest.fn().mockImplementation(() => ({ recordPayment: jest.fn(), recordRefund: jest.fn() })),
}));
jest.mock("../modules/integrations/email", () => ({
  getEmailService: () => ({ sendPaymentReceipt: jest.fn(), sendRefundConfirmation: jest.fn() }),
}));

jest.mock("../lib/stripe", () => ({
  getStripe: () => ({
    webhooks: stripe.webhooks,
    identity: { verificationSessions: { retrieve: (...a: unknown[]) => mockRetrieve(...a) } },
  }),
  expectedLivemode: () => (process.env.STRIPE_SECRET_KEY ?? "").startsWith("sk_live_"),
}));

jest.mock("../modules/screening/identity-verification", () => ({
  IdentityVerificationService: jest.fn().mockImplementation(() => ({
    mapStripeSessionToResult: (...a: unknown[]) => mockMapStripeSessionToResult(...a),
  })),
}));
jest.mock("../modules/screening/state-machine", () => ({
  transitionApplicationStatus: (...a: unknown[]) => mockTransition(...a),
}));
jest.mock("../modules/screening/service", () => ({
  ScreeningService: jest.fn().mockImplementation(() => ({ runFullScreening: mockRunFullScreening })),
}));

import { query } from "../config/database";
import webhookRouter from "../modules/payment/webhook";

const mockQuery = query as jest.MockedFunction<typeof query>;
const flush = () => new Promise((resolve) => setImmediate(resolve));

function buildApp() {
  const app = express();
  app.use("/webhook", webhookRouter);
  return app;
}
const app = buildApp();

const APP_ID = "11111111-2222-3333-4444-555555555555";

function identityEvent(
  type: string,
  opts: { id?: string; sessionId?: string; status?: string; applicationId?: string | null } = {}
) {
  const metadata =
    opts.applicationId === null ? {} : { applicationId: opts.applicationId ?? APP_ID };
  return {
    id: opts.id ?? "evt_idv_001",
    object: "event",
    api_version: "2025-02-24.acacia",
    created: Math.floor(Date.now() / 1000),
    type,
    livemode: false,
    pending_webhooks: 1,
    request: { id: null, idempotency_key: null },
    data: {
      object: {
        id: opts.sessionId ?? "vs_test_001",
        object: "identity.verification_session",
        status: opts.status ?? "verified",
        metadata,
      },
    },
  };
}

function signedHeader(payload: string, secret: string = WEBHOOK_SECRET): string {
  return stripe.webhooks.generateTestHeaderString({ payload, secret });
}

async function postEvent(event: object) {
  const payload = JSON.stringify(event);
  return request(app)
    .post("/webhook")
    .set("Content-Type", "application/json")
    .set("Stripe-Signature", signedHeader(payload))
    .send(payload);
}

const originalSecret = process.env.STRIPE_WEBHOOK_SECRET;
const originalScreenFlag = process.env.SCREENING_ON_SUBMIT_ENABLED;

beforeAll(() => {
  process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
});
afterAll(() => {
  process.env.STRIPE_WEBHOOK_SECRET = originalSecret;
  process.env.SCREENING_ON_SUBMIT_ENABLED = originalScreenFlag;
});

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.SCREENING_ON_SUBMIT_ENABLED;

  // SQL-routed DB mock — robust to call ordering.
  mockQuery.mockImplementation((sql: any) => {
    const s = String(sql);
    if (/stripe_processed_events/i.test(s) && /SELECT/i.test(s)) {
      return Promise.resolve({ rows: [] }) as any; // alreadyProcessed → not a dup
    }
    if (/FROM applications a/i.test(s) && /LEFT JOIN users/i.test(s)) {
      return Promise.resolve({
        rows: [
          {
            submitted_by: "99999999-8888-7777-6666-555555555555",
            submitter_role: "applicant",
            first_name: "Sam",
            last_name: "Lee",
            date_of_birth_encrypted: "enc",
          },
        ],
      }) as any; // ctx
    }
    if (/UPDATE applications SET\s+identity_verification_result/i.test(s)) {
      return Promise.resolve({ rows: [{ id: APP_ID }] }) as any; // persist (in awaiting_identity)
    }
    return Promise.resolve({ rows: [] }) as any; // markProcessed, overall update, session_status
  });

  mockRetrieve.mockResolvedValue({
    id: "vs_test_001",
    status: "verified",
    last_verification_report: { id: "vr_1", document: { type: "driving_license", error: null }, selfie: { error: null } },
  });
  mockTransition.mockResolvedValue({ changed: true, status: "screening" });
  mockRunFullScreening.mockResolvedValue({});
});

describe("POST /webhook — identity.verification_session.verified", () => {
  it("maps the session, persists the verdict, advances → screening, returns 200", async () => {
    mockMapStripeSessionToResult.mockReturnValue({
      result: "verified",
      confidence: 0.95,
      idType: "driver_license",
      livenessScore: 0.99,
      details: { documentValid: true, selfieMatch: true, riskSignals: [] },
    });

    const res = await postEvent(identityEvent("identity.verification_session.verified"));

    expect(res.status).toBe(200);
    expect(mockRetrieve).toHaveBeenCalledWith("vs_test_001", { expand: ["last_verification_report"] });
    expect(mockMapStripeSessionToResult).toHaveBeenCalled();
    // persisted the verdict guarded to awaiting_identity
    const persistCall = mockQuery.mock.calls.find((c) =>
      /UPDATE applications SET\s+identity_verification_result/i.test(String(c[0]))
    );
    expect(persistCall).toBeDefined();
    expect(String(persistCall![0])).toMatch(/status = 'awaiting_identity'/);
    // advanced awaiting_identity → screening
    expect(mockTransition).toHaveBeenCalledWith(
      expect.objectContaining({ from: "awaiting_identity", to: "screening", trigger: "identity_session_resolved" })
    );
  });

  it("does NOT kick the pipeline when SCREENING_ON_SUBMIT_ENABLED is off (staff manual /screen)", async () => {
    mockMapStripeSessionToResult.mockReturnValue({
      result: "verified", confidence: 0.95, idType: "driver_license", livenessScore: 0.99,
      details: { documentValid: true, selfieMatch: true, riskSignals: [] },
    });
    await postEvent(identityEvent("identity.verification_session.verified"));
    await flush();
    expect(mockRunFullScreening).not.toHaveBeenCalled();
  });

  it("kicks runFullScreening when SCREENING_ON_SUBMIT_ENABLED is on", async () => {
    process.env.SCREENING_ON_SUBMIT_ENABLED = "true";
    mockMapStripeSessionToResult.mockReturnValue({
      result: "verified", confidence: 0.95, idType: "driver_license", livenessScore: 0.99,
      details: { documentValid: true, selfieMatch: true, riskSignals: [] },
    });
    await postEvent(identityEvent("identity.verification_session.verified"));
    await flush();
    expect(mockRunFullScreening).toHaveBeenCalledWith(
      APP_ID,
      "99999999-8888-7777-6666-555555555555",
      "applicant"
    );
  });
});

describe("POST /webhook — could_not_screen HOLD", () => {
  it("canceled/unmappable → screening_review + overall could_not_screen, never a pass", async () => {
    mockMapStripeSessionToResult.mockReturnValue({
      result: "could_not_screen", confidence: 0, idType: "unknown", livenessScore: 0,
      details: { documentValid: false, selfieMatch: false, riskSignals: ["could_not_screen"] },
    });

    const res = await postEvent(identityEvent("identity.verification_session.canceled", { status: "canceled" }));
    await flush();

    expect(res.status).toBe(200);
    expect(mockTransition).toHaveBeenCalledWith(
      expect.objectContaining({ from: "awaiting_identity", to: "screening_review", trigger: "could_not_screen" })
    );
    const overallUpdate = mockQuery.mock.calls.find((c) =>
      /overall_screening_result = 'could_not_screen'/i.test(String(c[0]))
    );
    expect(overallUpdate).toBeDefined();
    expect(mockRunFullScreening).not.toHaveBeenCalled();
  });
});

describe("POST /webhook — identity.verification_session.processing", () => {
  it("records session status only — no retrieve, no transition", async () => {
    const res = await postEvent(
      identityEvent("identity.verification_session.processing", { status: "processing" })
    );
    expect(res.status).toBe(200);
    expect(mockRetrieve).not.toHaveBeenCalled();
    expect(mockMapStripeSessionToResult).not.toHaveBeenCalled();
    expect(mockTransition).not.toHaveBeenCalled();
  });
});

describe("POST /webhook — identity guards", () => {
  it("missing applicationId metadata → 200 but no retrieve/transition", async () => {
    const res = await postEvent(
      identityEvent("identity.verification_session.verified", { applicationId: null })
    );
    expect(res.status).toBe(200);
    expect(mockRetrieve).not.toHaveBeenCalled();
    expect(mockTransition).not.toHaveBeenCalled();
  });

  it("duplicate event (already processed) → short-circuits before mapping", async () => {
    mockQuery.mockImplementation((sql: any) => {
      if (/stripe_processed_events/i.test(String(sql)) && /SELECT/i.test(String(sql))) {
        return Promise.resolve({ rows: [{ event_id: "evt_idv_001" }] }) as any; // already processed
      }
      return Promise.resolve({ rows: [] }) as any;
    });
    const res = await postEvent(identityEvent("identity.verification_session.verified"));
    expect(res.status).toBe(200);
    expect(res.body.duplicate).toBe(true);
    expect(mockMapStripeSessionToResult).not.toHaveBeenCalled();
  });

  it("verdict for an app no longer in awaiting_identity → no transition (CAS no-op)", async () => {
    mockMapStripeSessionToResult.mockReturnValue({
      result: "verified", confidence: 0.95, idType: "driver_license", livenessScore: 0.99,
      details: { documentValid: true, selfieMatch: true, riskSignals: [] },
    });
    // persist UPDATE matches 0 rows (app already advanced)
    mockQuery.mockImplementation((sql: any) => {
      const s = String(sql);
      if (/stripe_processed_events/i.test(s) && /SELECT/i.test(s)) return Promise.resolve({ rows: [] }) as any;
      if (/FROM applications a/i.test(s) && /LEFT JOIN users/i.test(s)) {
        return Promise.resolve({ rows: [{ submitted_by: null, submitter_role: null, first_name: "A", last_name: "B", date_of_birth_encrypted: null }] }) as any;
      }
      if (/UPDATE applications SET\s+identity_verification_result/i.test(s)) {
        return Promise.resolve({ rows: [] }) as any; // 0 rows — not in awaiting_identity
      }
      return Promise.resolve({ rows: [] }) as any;
    });

    const res = await postEvent(identityEvent("identity.verification_session.verified"));
    expect(res.status).toBe(200);
    expect(mockTransition).not.toHaveBeenCalled();
  });

  it("livemode mismatch (live event at test deployment) → 400, no processing", async () => {
    const savedKey = process.env.STRIPE_SECRET_KEY;
    process.env.STRIPE_SECRET_KEY = "sk_live_xxx"; // expectedLivemode → true; event.livemode false
    try {
      const res = await postEvent(identityEvent("identity.verification_session.verified"));
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/livemode mismatch/i);
      expect(mockMapStripeSessionToResult).not.toHaveBeenCalled();
    } finally {
      process.env.STRIPE_SECRET_KEY = savedKey;
    }
  });
});
