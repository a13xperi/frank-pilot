/**
 * Route-layer tests for src/modules/payment/intents.ts (`POST /api/payments/intents`).
 *
 * Auth strategy: real JWT + mock `query` so authenticate() resolves to the
 * fixture user. Same pattern as payment-routes.test.ts.
 *
 * Stripe: jest.mock the singleton in src/lib/stripe so the route never hits
 * a real key. The mock records the `idempotencyKey` we passed in to assert
 * spec-§4.1 key shape and Stripe-side idempotency wiring.
 *
 * Tape + DB writes are mocked at the boundary — we assert on the calls, not
 * the side effects. Filesystem stays clean.
 */

import express from "express";
import request from "supertest";
import { generateToken, AuthUser } from "../middleware/auth";

// ── Mocks (must be declared before module imports) ─────────────────────────

jest.mock("../config/database", () => ({ query: jest.fn(), transaction: jest.fn() }));
jest.mock("../utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const mockStampTape = jest.fn().mockResolvedValue(null);
jest.mock("../modules/tape", () => {
  const real = jest.requireActual("../modules/tape");
  return {
    ...real,
    stampTape: mockStampTape,
  };
});

const mockPaymentIntentsCreate = jest.fn();
const mockGetStripe = jest.fn(() => ({
  paymentIntents: { create: mockPaymentIntentsCreate },
}));
jest.mock("../lib/stripe", () => ({
  getStripe: () => mockGetStripe(),
}));

import { query } from "../config/database";
import intentsRouter from "../modules/payment/intents";

const mockQuery = query as jest.MockedFunction<typeof query>;

// ── Test users ─────────────────────────────────────────────────────────────

const APP_ID = "11111111-2222-3333-4444-555555555555";

const applicant: AuthUser = {
  id: "user-applicant-001",
  email: "tenant@example.com",
  role: "applicant",
  firstName: "Jane",
  lastName: "Doe",
  propertyIds: [],
  emailVerified: true,
};

const unverifiedApplicant: AuthUser = {
  ...applicant,
  id: "user-applicant-002",
  emailVerified: false,
};

const staffUser: AuthUser = {
  id: "user-staff-001",
  email: "staff@example.com",
  role: "senior_manager",
  firstName: "Bob",
  lastName: "Manager",
  propertyIds: ["prop-001"],
  emailVerified: true,
};

function tokenFor(user: AuthUser): string {
  return `Bearer ${generateToken(user)}`;
}

/** Stub the users-table fetch that `authenticate` runs. */
function mockAuthQuery(user: AuthUser) {
  mockQuery.mockResolvedValueOnce({
    rows: [
      {
        id: user.id,
        email: user.email,
        role: user.role,
        first_name: user.firstName,
        last_name: user.lastName,
        property_ids: user.propertyIds,
        is_active: true,
        email_verified_at: user.emailVerified ? new Date() : null,
      },
    ],
  } as any);
}

function mockOwnership(rows: number) {
  // callerOwnsApplication: SELECT 1 FROM user_applications WHERE ...
  mockQuery.mockResolvedValueOnce({
    rows: rows > 0 ? [{ "?column?": 1 }] : [],
  } as any);
}

function mockIdempotencyLookup(row: Record<string, unknown> | null) {
  // lookup(): SELECT ... FROM payment_idempotency WHERE ...
  mockQuery.mockResolvedValueOnce({ rows: row ? [row] : [] } as any);
}

// ── Build test app ─────────────────────────────────────────────────────────

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/intents", intentsRouter);
  return app;
}

const app = buildApp();

beforeEach(() => {
  jest.clearAllMocks();
});

// ── Auth + scope guards ────────────────────────────────────────────────────

describe("POST /intents — auth and scope guards", () => {
  it("returns 401 with no Authorization header", async () => {
    const res = await request(app)
      .post("/intents")
      .send({ applicationId: APP_ID, amountCents: 12500, attemptN: 1 });
    expect(res.status).toBe(401);
  });

  it("returns 403 with code EMAIL_UNVERIFIED for an applicant without a verified email", async () => {
    mockAuthQuery(unverifiedApplicant);

    const res = await request(app)
      .post("/intents")
      .set("Authorization", tokenFor(unverifiedApplicant))
      .send({ applicationId: APP_ID, amountCents: 12500, attemptN: 1 });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("EMAIL_UNVERIFIED");
  });

  it("returns 403 for a staff role (route is applicant/tenant-only)", async () => {
    mockAuthQuery(staffUser);

    const res = await request(app)
      .post("/intents")
      .set("Authorization", tokenFor(staffUser))
      .send({ applicationId: APP_ID, amountCents: 12500, attemptN: 1 });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/applicant or tenant role required/i);
  });

  it("returns 403 when the caller does not own the application", async () => {
    mockAuthQuery(applicant);
    mockOwnership(0);

    const res = await request(app)
      .post("/intents")
      .set("Authorization", tokenFor(applicant))
      .send({ applicationId: APP_ID, amountCents: 12500, attemptN: 1 });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/application not accessible/i);
  });
});

// ── Zod validation ─────────────────────────────────────────────────────────

describe("POST /intents — payload validation", () => {
  it("returns 400 when applicationId is not a UUID", async () => {
    mockAuthQuery(applicant);

    const res = await request(app)
      .post("/intents")
      .set("Authorization", tokenFor(applicant))
      .send({ applicationId: "not-a-uuid", amountCents: 12500, attemptN: 1 });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/validation failed/i);
  });

  it("returns 400 when amountCents is non-positive", async () => {
    mockAuthQuery(applicant);

    const res = await request(app)
      .post("/intents")
      .set("Authorization", tokenFor(applicant))
      .send({ applicationId: APP_ID, amountCents: 0, attemptN: 1 });

    expect(res.status).toBe(400);
  });

  it("returns 400 when amountCents exceeds the safety ceiling", async () => {
    mockAuthQuery(applicant);

    const res = await request(app)
      .post("/intents")
      .set("Authorization", tokenFor(applicant))
      .send({ applicationId: APP_ID, amountCents: 100_000_000, attemptN: 1 });

    expect(res.status).toBe(400);
  });

  it("returns 400 when attemptN is non-positive", async () => {
    mockAuthQuery(applicant);

    const res = await request(app)
      .post("/intents")
      .set("Authorization", tokenFor(applicant))
      .send({ applicationId: APP_ID, amountCents: 12500, attemptN: 0 });

    expect(res.status).toBe(400);
  });
});

// ── Create path ────────────────────────────────────────────────────────────

describe("POST /intents — create path (no prior row)", () => {
  it("calls Stripe with the canonical idempotency key shape and 201s with client_secret", async () => {
    mockAuthQuery(applicant);
    mockOwnership(1);
    mockIdempotencyLookup(null); // no existing row → create
    mockPaymentIntentsCreate.mockResolvedValue({
      id: "pi_live_001",
      client_secret: "pi_live_001_secret_xyz",
    });
    // insertPending: 1 INSERT then 1 SELECT.
    mockQuery.mockResolvedValueOnce({ rows: [] } as any); // INSERT
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          idempotency_key: `pi:${APP_ID}:1`,
          application_id: APP_ID,
          attempt_n: 1,
          status: "pending",
          payment_intent_id: "pi_live_001",
          client_secret: "pi_live_001_secret_xyz",
          amount_cents: 12500,
          currency: "usd",
          last_event_at: null,
          created_at: new Date(),
        },
      ],
    } as any); // SELECT after insert
    // writeAuditLog: 1 INSERT into audit_log.
    mockQuery.mockResolvedValueOnce({ rows: [] } as any);

    const res = await request(app)
      .post("/intents")
      .set("Authorization", tokenFor(applicant))
      .send({ applicationId: APP_ID, amountCents: 12500, attemptN: 1 });

    expect(res.status).toBe(201);
    expect(res.body.clientSecret).toBe("pi_live_001_secret_xyz");
    expect(res.body.paymentIntentId).toBe("pi_live_001");
    expect(res.body.idempotencyKey).toBe(`pi:${APP_ID}:1`);

    // Stripe call: idempotencyKey passed as the second-arg request option,
    // amount/currency/metadata in the first-arg params.
    expect(mockPaymentIntentsCreate).toHaveBeenCalledTimes(1);
    const [params, opts] = mockPaymentIntentsCreate.mock.calls[0];
    expect(params.amount).toBe(12500);
    expect(params.currency).toBe("usd");
    expect(params.metadata.applicationId).toBe(APP_ID);
    expect(params.metadata.attemptN).toBe("1");
    expect(opts.idempotencyKey).toBe(`pi:${APP_ID}:1`);

    // Tape stamp recorded the intent_created kind.
    expect(mockStampTape).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "BP08_PAYMENT_INTENT_CREATED",
        sessionId: `pi:${APP_ID}:1`,
      })
    );
  });

  it("returns 502 when Stripe throws", async () => {
    mockAuthQuery(applicant);
    mockOwnership(1);
    mockIdempotencyLookup(null);
    mockPaymentIntentsCreate.mockRejectedValue(new Error("Stripe down"));

    const res = await request(app)
      .post("/intents")
      .set("Authorization", tokenFor(applicant))
      .send({ applicationId: APP_ID, amountCents: 12500, attemptN: 1 });

    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/failed to create payment intent/i);
    // No tape stamp written because we never reached the success branch.
    expect(mockStampTape).not.toHaveBeenCalled();
  });
});

// ── Replay path ────────────────────────────────────────────────────────────

describe("POST /intents — replay path (pending row exists)", () => {
  it("returns the cached client_secret and does NOT call Stripe a second time", async () => {
    mockAuthQuery(applicant);
    mockOwnership(1);
    mockIdempotencyLookup({
      idempotency_key: `pi:${APP_ID}:1`,
      application_id: APP_ID,
      attempt_n: 1,
      status: "pending",
      payment_intent_id: "pi_live_001",
      client_secret: "pi_live_001_secret_xyz",
      amount_cents: 12500,
      currency: "usd",
      last_event_at: null,
      created_at: new Date(),
    });
    // writeAuditLog: 1 INSERT
    mockQuery.mockResolvedValueOnce({ rows: [] } as any);

    const res = await request(app)
      .post("/intents")
      .set("Authorization", tokenFor(applicant))
      .send({ applicationId: APP_ID, amountCents: 12500, attemptN: 1 });

    expect(res.status).toBe(200);
    expect(res.body.clientSecret).toBe("pi_live_001_secret_xyz");
    expect(res.body.paymentIntentId).toBe("pi_live_001");
    expect(res.body.replay).toBe(true);

    expect(mockPaymentIntentsCreate).not.toHaveBeenCalled();
    // No new BP08_PAYMENT_INTENT_CREATED stamp on replay.
    expect(mockStampTape).not.toHaveBeenCalled();
  });
});

// ── Blocked path ───────────────────────────────────────────────────────────

describe("POST /intents — blocked path (terminal status)", () => {
  it("returns 409 and emits a replay-blocked stamp for a succeeded row", async () => {
    mockAuthQuery(applicant);
    mockOwnership(1);
    mockIdempotencyLookup({
      idempotency_key: `pi:${APP_ID}:1`,
      application_id: APP_ID,
      attempt_n: 1,
      status: "succeeded",
      payment_intent_id: "pi_live_001",
      client_secret: "pi_live_001_secret_xyz",
      amount_cents: 12500,
      currency: "usd",
      last_event_at: new Date(),
      created_at: new Date(),
    });
    mockQuery.mockResolvedValueOnce({ rows: [] } as any); // writeAuditLog

    const res = await request(app)
      .post("/intents")
      .set("Authorization", tokenFor(applicant))
      .send({ applicationId: APP_ID, amountCents: 12500, attemptN: 1 });

    expect(res.status).toBe(409);
    expect(res.body.reason).toBe("succeeded");
    expect(res.body.paymentIntentId).toBe("pi_live_001");
    // No client_secret leak on the blocked response.
    expect(res.body.clientSecret).toBeUndefined();

    expect(mockStampTape).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "BP08_PAYMENT_REPLAY_BLOCKED",
        sessionId: `pi:${APP_ID}:1`,
      })
    );
    expect(mockPaymentIntentsCreate).not.toHaveBeenCalled();
  });

  it("returns 409 with reason=failed for a failed row", async () => {
    mockAuthQuery(applicant);
    mockOwnership(1);
    mockIdempotencyLookup({
      idempotency_key: `pi:${APP_ID}:2`,
      application_id: APP_ID,
      attempt_n: 2,
      status: "failed",
      payment_intent_id: "pi_live_002",
      client_secret: null,
      amount_cents: 12500,
      currency: "usd",
      last_event_at: new Date(),
      created_at: new Date(),
    });
    mockQuery.mockResolvedValueOnce({ rows: [] } as any); // writeAuditLog

    const res = await request(app)
      .post("/intents")
      .set("Authorization", tokenFor(applicant))
      .send({ applicationId: APP_ID, amountCents: 12500, attemptN: 2 });

    expect(res.status).toBe(409);
    expect(res.body.reason).toBe("failed");
  });
});
