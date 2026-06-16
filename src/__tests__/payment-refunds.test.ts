/**
 * Route-layer tests for src/modules/payment/refunds.ts
 * (`POST /api/payments/refunds`).
 *
 * Mirrors payment-intents.test.ts: real JWT + mocked `query` so authenticate()
 * resolves to the fixture user, the Stripe singleton is mocked so the route
 * never touches a real key, and tape is mocked at the boundary.
 *
 * The contract under test: the route REQUESTS a refund (stripe.refunds.create)
 * and records intent — it must NOT post to the ledger synchronously (the
 * `charge.refunded` webhook owns that). `recordRefund` is therefore never
 * reachable from here; we assert the route never imports/calls the ledger.
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
  return { ...real, stampTape: mockStampTape };
});

const mockRefundsCreate = jest.fn();
const mockPaymentIntentsRetrieve = jest.fn();
jest.mock("../lib/stripe", () => ({
  getStripe: () => ({
    refunds: { create: mockRefundsCreate },
    paymentIntents: { retrieve: mockPaymentIntentsRetrieve },
  }),
}));

import { query } from "../config/database";
import refundsRouter from "../modules/payment/refunds";

const mockQuery = query as jest.MockedFunction<typeof query>;

// ── Test users ─────────────────────────────────────────────────────────────

const APP_ID = "11111111-2222-3333-4444-555555555555";

const staffUser: AuthUser = {
  id: "user-staff-001",
  email: "staff@example.com",
  role: "senior_manager", // holds ledger:manage
  firstName: "Bob",
  lastName: "Manager",
  propertyIds: ["prop-001"],
  emailVerified: true,
};

const applicant: AuthUser = {
  id: "user-applicant-001",
  email: "tenant@example.com",
  role: "applicant", // lacks ledger:manage
  firstName: "Jane",
  lastName: "Doe",
  propertyIds: [],
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

/** lookupOriginalPayment: SELECT ... FROM payment_idempotency */
function mockOriginalPayment(row: Record<string, unknown> | null) {
  mockQuery.mockResolvedValueOnce({ rows: row ? [row] : [] } as any);
}

const succeededPayment = {
  application_id: APP_ID,
  amount_cents: 12500,
  currency: "usd",
  status: "succeeded",
};

// ── Build test app ─────────────────────────────────────────────────────────

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/refunds", refundsRouter);
  return app;
}

const app = buildApp();

beforeEach(() => {
  jest.clearAllMocks();
  // The refund path now reads the intent back (to decide refund_application_fee /
  // reverse_transfer). Default to a non-Connect, no-fee charge so the existing
  // refund assertions are unchanged unless a test opts into a fee.
  mockPaymentIntentsRetrieve.mockResolvedValue({
    application_fee_amount: null,
    transfer_data: null,
  });
});

// ── Auth + permission gate ───────────────────────────────────────────────

describe("POST /refunds — auth and permission", () => {
  it("returns 401 with no Authorization header", async () => {
    const res = await request(app).post("/refunds").send({ paymentIntentId: "pi_test_001" });
    expect(res.status).toBe(401);
    expect(mockRefundsCreate).not.toHaveBeenCalled();
  });

  it("returns 403 for a role lacking ledger:manage (applicant)", async () => {
    mockAuthQuery(applicant);
    const res = await request(app)
      .post("/refunds")
      .set("Authorization", tokenFor(applicant))
      .send({ paymentIntentId: "pi_test_001" });
    expect(res.status).toBe(403);
    expect(mockRefundsCreate).not.toHaveBeenCalled();
  });
});

// ── Validation ─────────────────────────────────────────────────────────────

describe("POST /refunds — validation", () => {
  it("returns 400 when paymentIntentId is missing", async () => {
    mockAuthQuery(staffUser);
    const res = await request(app)
      .post("/refunds")
      .set("Authorization", tokenFor(staffUser))
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/validation failed/i);
    expect(mockRefundsCreate).not.toHaveBeenCalled();
  });

  it("returns 404 when no payment exists for the PaymentIntent", async () => {
    mockAuthQuery(staffUser);
    mockOriginalPayment(null);
    const res = await request(app)
      .post("/refunds")
      .set("Authorization", tokenFor(staffUser))
      .send({ paymentIntentId: "pi_missing" });
    expect(res.status).toBe(404);
    expect(mockRefundsCreate).not.toHaveBeenCalled();
  });

  it("returns 409 when the original payment is not in 'succeeded' state", async () => {
    mockAuthQuery(staffUser);
    mockOriginalPayment({ ...succeededPayment, status: "pending" });
    const res = await request(app)
      .post("/refunds")
      .set("Authorization", tokenFor(staffUser))
      .send({ paymentIntentId: "pi_test_001" });
    expect(res.status).toBe(409);
    expect(mockRefundsCreate).not.toHaveBeenCalled();
  });

  it("returns 400 when amountCents exceeds the original payment", async () => {
    mockAuthQuery(staffUser);
    mockOriginalPayment(succeededPayment);
    const res = await request(app)
      .post("/refunds")
      .set("Authorization", tokenFor(staffUser))
      .send({ paymentIntentId: "pi_test_001", amountCents: 99999 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/exceeds/i);
    expect(mockRefundsCreate).not.toHaveBeenCalled();
  });
});

// ── Happy path ─────────────────────────────────────────────────────────────

describe("POST /refunds — request lifecycle", () => {
  it("creates the Stripe refund with the right payment_intent + metadata and returns 202", async () => {
    mockAuthQuery(staffUser);
    mockOriginalPayment(succeededPayment);
    mockRefundsCreate.mockResolvedValue({ id: "re_test_001", status: "succeeded" });
    // UPDATE payment_idempotency, then writeAuditLog INSERT.
    mockQuery.mockResolvedValueOnce({ rows: [] } as any);
    mockQuery.mockResolvedValueOnce({ rows: [] } as any);

    const res = await request(app)
      .post("/refunds")
      .set("Authorization", tokenFor(staffUser))
      .send({ paymentIntentId: "pi_test_001", reason: "duplicate charge" });

    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({ refundId: "re_test_001", status: "succeeded" });

    expect(mockRefundsCreate).toHaveBeenCalledTimes(1);
    const [params, opts] = mockRefundsCreate.mock.calls[0];
    expect(params).toMatchObject({
      payment_intent: "pi_test_001",
      reason: "requested_by_customer",
      metadata: expect.objectContaining({
        applicationId: APP_ID,
        actorId: staffUser.id,
        staffReason: "duplicate charge",
      }),
    });
    // No `amount` ⇒ full refund.
    expect(params.amount).toBeUndefined();
    // PaymentIntent-scoped idempotency key.
    expect(opts).toMatchObject({ idempotencyKey: "refund:pi_test_001:full" });

    // payment_refund_requested audit written.
    const auditCall = mockQuery.mock.calls.find((c) =>
      String(c[0]).includes("INSERT INTO audit_log")
    );
    expect(auditCall).toBeDefined();
    expect(auditCall![1]).toEqual(expect.arrayContaining(["payment_refund_requested"]));

    // Tape stamped.
    expect(mockStampTape).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "BP08_PAYMENT_REFUND_REQUESTED" })
    );

    // Refund REQUEST only — NO synchronous ledger write. The query log must not
    // touch the ledger_entries table; the webhook posts the offsetting entry.
    const ledgerWrite = mockQuery.mock.calls.find((c) =>
      /INSERT\s+INTO\s+ledger_entries/i.test(String(c[0]))
    );
    expect(ledgerWrite).toBeUndefined();
  });

  it("passes a partial amount and a 'partial' idempotency key when amountCents is given", async () => {
    mockAuthQuery(staffUser);
    mockOriginalPayment(succeededPayment);
    mockRefundsCreate.mockResolvedValue({ id: "re_test_002", status: "pending" });
    mockQuery.mockResolvedValueOnce({ rows: [] } as any);
    mockQuery.mockResolvedValueOnce({ rows: [] } as any);

    const res = await request(app)
      .post("/refunds")
      .set("Authorization", tokenFor(staffUser))
      .send({ paymentIntentId: "pi_test_001", amountCents: 5000 });

    expect(res.status).toBe(202);
    const [params, opts] = mockRefundsCreate.mock.calls[0];
    expect(params.amount).toBe(5000);
    expect(opts).toMatchObject({ idempotencyKey: "refund:pi_test_001:5000" });
  });

  it("returns 502 when Stripe refund creation fails, with no audit/ledger write", async () => {
    mockAuthQuery(staffUser);
    mockOriginalPayment(succeededPayment);
    mockRefundsCreate.mockRejectedValue(new Error("Stripe is down"));

    const res = await request(app)
      .post("/refunds")
      .set("Authorization", tokenFor(staffUser))
      .send({ paymentIntentId: "pi_test_001" });

    expect(res.status).toBe(502);
    const auditCall = mockQuery.mock.calls.find((c) =>
      String(c[0]).includes("INSERT INTO audit_log")
    );
    expect(auditCall).toBeUndefined();
    expect(mockStampTape).not.toHaveBeenCalled();
  });
});
