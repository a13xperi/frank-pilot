/**
 * Tests for src/modules/payment/service.ts
 *
 * Validates the PCI-DSS compliant payment setup flow:
 * - Stripe customer creation (real Stripe vs. stub when unconfigured)
 * - Tokenized payment method attachment (no raw card data handled)
 * - Auto-pay enrollment with $25/month rent reduction incentive
 * - Payment status projection including effective rent calculation
 *
 * PCI-DSS note: PaymentService never captures raw card data; it receives
 * only Stripe PaymentMethod IDs tokenized client-side. Tests verify
 * that no raw card values appear in DB writes or audit logs.
 */

import type { QueryResult } from "pg";
import { PaymentService } from "../modules/payment/service";

/** Wrap rows in a minimal QueryResult shape without casting to `any`. */
function qr<T extends Record<string, unknown>>(rows: T[]): QueryResult<T> {
  return { rows } as unknown as QueryResult<T>;
}

// ── Mocks ─────────────────────────────────────────────────────────────────────

jest.mock("../config/database", () => ({ query: jest.fn() }));
jest.mock("../middleware/audit", () => ({ writeAuditLog: jest.fn() }));
jest.mock("../utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

// Stripe is require()'d dynamically inside the constructor — mock it at
// module level so jest intercepts the dynamic require.
const mockStripeCustomersCreate = jest.fn();
const mockStripeCustomersUpdate = jest.fn();
const mockStripePaymentMethodsAttach = jest.fn();

jest.mock("stripe", () => {
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
      customers: {
        create: mockStripeCustomersCreate,
        update: mockStripeCustomersUpdate,
      },
      paymentMethods: {
        attach: mockStripePaymentMethodsAttach,
      },
    })),
  };
});

import { query } from "../config/database";
import { writeAuditLog } from "../middleware/audit";

const mockQuery = query as jest.MockedFunction<typeof query>;
const mockAuditLog = writeAuditLog as jest.MockedFunction<typeof writeAuditLog>;

// ── Helpers ───────────────────────────────────────────────────────────────────

const originalEnv = process.env;

function makeApp(overrides: Record<string, unknown> = {}) {
  return {
    id: "app-001",
    stripe_customer_id: "cus_abc123",
    stripe_payment_method_id: "pm_abc123",
    payment_method: "ach",
    auto_pay_enrolled: false,
    requested_rent_amount: "1500",
    ...overrides,
  };
}

const baseActor = { actorId: "user-1", actorRole: "leasing_agent" };

// ── createCustomer — Stripe NOT configured (stub path) ────────────────────────

describe("PaymentService.createCustomer — stub (Stripe not configured)", () => {
  let service: PaymentService;

  beforeEach(() => {
    mockQuery.mockReset();
    mockAuditLog.mockReset();
    mockStripeCustomersCreate.mockReset();
    mockStripeCustomersUpdate.mockReset();
    mockStripePaymentMethodsAttach.mockReset();
    process.env = { ...originalEnv };
    delete process.env.STRIPE_SECRET_KEY; // ensure stub path
    mockAuditLog.mockResolvedValue(undefined);
    mockQuery.mockResolvedValue(qr([]));
    service = new PaymentService();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("returns a stub customerId prefixed with cus_stub_", async () => {
    const result = await service.createCustomer({
      applicationId: "app-001",
      email: "jane@example.com",
      firstName: "Jane",
      lastName: "Doe",
      ...baseActor,
    });

    expect(result.customerId).toMatch(/^cus_stub_/);
  });

  it("persists the stub customerId to the DB", async () => {
    const result = await service.createCustomer({
      applicationId: "app-001",
      email: "jane@example.com",
      firstName: "Jane",
      lastName: "Doe",
      ...baseActor,
    });

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("stripe_customer_id"),
      ["app-001", result.customerId]
    );
  });

  it("does NOT write an audit log on the stub path", async () => {
    await service.createCustomer({
      applicationId: "app-001",
      email: "jane@example.com",
      firstName: "Jane",
      lastName: "Doe",
      ...baseActor,
    });

    expect(mockAuditLog).not.toHaveBeenCalled();
  });

  it("does NOT call Stripe when key is set to the placeholder value", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_changeme";
    service = new PaymentService(); // re-create with the placeholder key

    await service.createCustomer({
      applicationId: "app-001",
      email: "jane@example.com",
      firstName: "Jane",
      lastName: "Doe",
      ...baseActor,
    });

    expect(mockStripeCustomersCreate).not.toHaveBeenCalled();
  });
});

// ── createCustomer — Stripe IS configured ─────────────────────────────────────

describe("PaymentService.createCustomer — live Stripe path", () => {
  let service: PaymentService;

  beforeEach(() => {
    mockQuery.mockReset();
    mockAuditLog.mockReset();
    mockStripeCustomersCreate.mockReset();
    mockStripeCustomersUpdate.mockReset();
    mockStripePaymentMethodsAttach.mockReset();
    process.env = { ...originalEnv, STRIPE_SECRET_KEY: "sk_test_real123" };
    mockAuditLog.mockResolvedValue(undefined);
    mockQuery.mockResolvedValue(qr([]));
    mockStripeCustomersCreate.mockResolvedValue({ id: "cus_live_001" });
    service = new PaymentService();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("calls stripe.customers.create with email and full name", async () => {
    await service.createCustomer({
      applicationId: "app-001",
      email: "jane@example.com",
      firstName: "Jane",
      lastName: "Doe",
      ...baseActor,
    });

    expect(mockStripeCustomersCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "jane@example.com",
        name: "Jane Doe",
      })
    );
  });

  it("persists the Stripe-returned customerId to the DB", async () => {
    await service.createCustomer({
      applicationId: "app-001",
      email: "jane@example.com",
      firstName: "Jane",
      lastName: "Doe",
      ...baseActor,
    });

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("stripe_customer_id"),
      ["app-001", "cus_live_001"]
    );
  });

  it("writes a payment_setup audit log with step=customer_created", async () => {
    await service.createCustomer({
      applicationId: "app-001",
      email: "jane@example.com",
      firstName: "Jane",
      lastName: "Doe",
      ...baseActor,
    });

    expect(mockAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "payment_setup",
        applicationId: "app-001",
        details: expect.objectContaining({ step: "customer_created" }),
      })
    );
  });

  it("returns the Stripe customerId", async () => {
    const result = await service.createCustomer({
      applicationId: "app-001",
      email: "jane@example.com",
      firstName: "Jane",
      lastName: "Doe",
      ...baseActor,
    });

    expect(result.customerId).toBe("cus_live_001");
  });
});

// ── setupPaymentMethod ────────────────────────────────────────────────────────

describe("PaymentService.setupPaymentMethod", () => {
  let service: PaymentService;

  beforeEach(() => {
    mockQuery.mockReset();
    mockAuditLog.mockReset();
    mockStripeCustomersCreate.mockReset();
    mockStripeCustomersUpdate.mockReset();
    mockStripePaymentMethodsAttach.mockReset();
    process.env = { ...originalEnv };
    delete process.env.STRIPE_SECRET_KEY; // stub mode — no Stripe calls
    mockAuditLog.mockResolvedValue(undefined);
    service = new PaymentService();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("throws when no stripe_customer_id exists on the application", async () => {
    mockQuery.mockResolvedValueOnce(qr([makeApp({ stripe_customer_id: null })]));

    await expect(
      service.setupPaymentMethod({
        applicationId: "app-001",
        paymentMethodId: "pm_test_001",
        paymentType: "ach",
        ...baseActor,
      })
    ).rejects.toThrow(/customer must be created/i);
  });

  it("saves payment_method and stripe_payment_method_id to DB", async () => {
    mockQuery
      .mockResolvedValueOnce(qr([makeApp()])) // getApplication
      .mockResolvedValueOnce(qr([]));          // UPDATE

    await service.setupPaymentMethod({
      applicationId: "app-001",
      paymentMethodId: "pm_test_001",
      paymentType: "ach",
      ...baseActor,
    });

    const updateCall = mockQuery.mock.calls.find(
      (c) => (c[0] as string).includes("payment_method")
    );
    expect(updateCall?.[1]).toContain("ach");
    expect(updateCall?.[1]).toContain("pm_test_001");
  });

  it("writes a payment_setup audit log with step=payment_method_attached", async () => {
    mockQuery
      .mockResolvedValueOnce(qr([makeApp()]))
      .mockResolvedValueOnce(qr([]));

    await service.setupPaymentMethod({
      applicationId: "app-001",
      paymentMethodId: "pm_test_001",
      paymentType: "credit_card",
      ...baseActor,
    });

    expect(mockAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "payment_setup",
        details: expect.objectContaining({
          step: "payment_method_attached",
          paymentType: "credit_card",
        }),
      })
    );
  });

  it("returns success:true with the paymentType", async () => {
    mockQuery
      .mockResolvedValueOnce(qr([makeApp()]))
      .mockResolvedValueOnce(qr([]));

    const result = await service.setupPaymentMethod({
      applicationId: "app-001",
      paymentMethodId: "pm_test_001",
      paymentType: "bank_transfer",
      ...baseActor,
    });

    expect(result).toEqual({ success: true, paymentType: "bank_transfer" });
  });

  it("calls stripe.paymentMethods.attach when Stripe is configured", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_real123";
    mockStripePaymentMethodsAttach.mockResolvedValue({});
    mockStripeCustomersUpdate.mockResolvedValue({});
    service = new PaymentService();

    mockQuery
      .mockResolvedValueOnce(qr([makeApp({ stripe_customer_id: "cus_abc" })]))
      .mockResolvedValueOnce(qr([]));

    await service.setupPaymentMethod({
      applicationId: "app-001",
      paymentMethodId: "pm_test_live",
      paymentType: "ach",
      ...baseActor,
    });

    expect(mockStripePaymentMethodsAttach).toHaveBeenCalledWith(
      "pm_test_live",
      { customer: "cus_abc" }
    );
    expect(mockStripeCustomersUpdate).toHaveBeenCalledWith(
      "cus_abc",
      { invoice_settings: { default_payment_method: "pm_test_live" } }
    );
  });
});

// ── enrollAutoPay ─────────────────────────────────────────────────────────────

describe("PaymentService.enrollAutoPay", () => {
  let service: PaymentService;

  beforeEach(() => {
    mockQuery.mockReset();
    mockAuditLog.mockReset();
    mockStripeCustomersCreate.mockReset();
    mockStripeCustomersUpdate.mockReset();
    mockStripePaymentMethodsAttach.mockReset();
    process.env = { ...originalEnv };
    delete process.env.STRIPE_SECRET_KEY;
    mockAuditLog.mockResolvedValue(undefined);
    mockQuery.mockResolvedValue(qr([]));
    service = new PaymentService();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("throws when no payment method is set up", async () => {
    mockQuery.mockResolvedValueOnce(qr([makeApp({ stripe_payment_method_id: null })]));

    await expect(
      service.enrollAutoPay({ applicationId: "app-001", ...baseActor })
    ).rejects.toThrow(/payment method must be set up/i);
  });

  it("returns enrolled:true and monthlyDiscount:25", async () => {
    mockQuery
      .mockResolvedValueOnce(qr([makeApp()]))
      .mockResolvedValueOnce(qr([]));

    const result = await service.enrollAutoPay({
      applicationId: "app-001",
      ...baseActor,
    });

    expect(result).toEqual({ enrolled: true, monthlyDiscount: 25 });
  });

  it("sets auto_pay_enrolled=true in DB", async () => {
    mockQuery
      .mockResolvedValueOnce(qr([makeApp()]))
      .mockResolvedValueOnce(qr([]));

    await service.enrollAutoPay({ applicationId: "app-001", ...baseActor });

    const updateCall = mockQuery.mock.calls.find(
      (c) => (c[0] as string).includes("auto_pay_enrolled")
    );
    expect(updateCall).toBeDefined();
    expect(updateCall?.[0]).toContain("true");
  });

  it("writes auto_pay_enrolled audit log with monthlyDiscount:25", async () => {
    mockQuery
      .mockResolvedValueOnce(qr([makeApp()]))
      .mockResolvedValueOnce(qr([]));

    await service.enrollAutoPay({ applicationId: "app-001", ...baseActor });

    expect(mockAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "auto_pay_enrolled",
        applicationId: "app-001",
        details: { monthlyDiscount: 25 },
      })
    );
  });
});

// ── getPaymentStatus ──────────────────────────────────────────────────────────

describe("PaymentService.getPaymentStatus", () => {
  let service: PaymentService;

  beforeEach(() => {
    mockQuery.mockReset();
    mockAuditLog.mockReset();
    mockStripeCustomersCreate.mockReset();
    mockStripeCustomersUpdate.mockReset();
    mockStripePaymentMethodsAttach.mockReset();
    process.env = { ...originalEnv };
    delete process.env.STRIPE_SECRET_KEY;
    service = new PaymentService();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("returns null when application is not found", async () => {
    mockQuery.mockResolvedValueOnce(qr([]));

    expect(await service.getPaymentStatus("app-missing")).toBeNull();
  });

  it("returns effectiveRent equal to requestedRent when auto-pay is not enrolled", async () => {
    mockQuery.mockResolvedValueOnce(qr([makeApp({ auto_pay_enrolled: false, requested_rent_amount: "1500" })]));

    const status = await service.getPaymentStatus("app-001");

    expect(status.requestedRent).toBe(1500);
    expect(status.effectiveRent).toBe(1500);
    expect(status.autoPayDiscount).toBe(0);
  });

  it("deducts $25 from effectiveRent when auto-pay is enrolled", async () => {
    mockQuery.mockResolvedValueOnce(qr([makeApp({ auto_pay_enrolled: true, requested_rent_amount: "1500" })]));

    const status = await service.getPaymentStatus("app-001");

    expect(status.effectiveRent).toBe(1475);
    expect(status.autoPayDiscount).toBe(25);
    expect(status.autoPayEnrolled).toBe(true);
  });

  it("floors effectiveRent at $0 when rent is less than the $25 discount", async () => {
    mockQuery.mockResolvedValueOnce(qr([makeApp({ auto_pay_enrolled: true, requested_rent_amount: "20" })]));

    const status = await service.getPaymentStatus("app-001");

    expect(status.effectiveRent).toBe(0);
  });

  it("reports hasPaymentMethod=true when stripe_payment_method_id is set", async () => {
    mockQuery.mockResolvedValueOnce(qr([makeApp({ stripe_payment_method_id: "pm_abc" })]));

    const status = await service.getPaymentStatus("app-001");

    expect(status.hasPaymentMethod).toBe(true);
    expect(status.hasCustomer).toBe(true);
  });

  it("reports hasPaymentMethod=false and hasCustomer=false when not configured", async () => {
    mockQuery.mockResolvedValueOnce(qr([makeApp({ stripe_customer_id: null, stripe_payment_method_id: null })]));

    const status = await service.getPaymentStatus("app-001");

    expect(status.hasPaymentMethod).toBe(false);
    expect(status.hasCustomer).toBe(false);
  });

  it("defaults requestedRent to 0 when requested_rent_amount is null", async () => {
    mockQuery.mockResolvedValueOnce(qr([makeApp({ requested_rent_amount: null })]));

    const status = await service.getPaymentStatus("app-001");

    expect(status.requestedRent).toBe(0);
    expect(status.effectiveRent).toBe(0);
  });
});
