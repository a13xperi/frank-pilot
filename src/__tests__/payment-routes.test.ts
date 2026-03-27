/**
 * Route-layer tests for src/modules/payment/routes.ts
 *
 * Tests HTTP contract: status codes, auth enforcement, RBAC, Zod validation,
 * service delegation, and error propagation across all four endpoints.
 *
 * Auth strategy: real JWT tokens + mock the users DB query that `authenticate`
 * runs on every request — exercises actual auth middleware.
 *
 * Service strategy: mock PaymentService at module level (instantiated at route
 * scope) — isolates routes from Stripe / DB concerns covered in service tests.
 *
 * RBAC facts under test:
 *   payment:setup → senior_manager, regional_manager, asset_manager, system_admin
 *   payment:view  → leasing_agent, senior_manager, regional_manager, asset_manager, system_admin
 */

import express from "express";
import request from "supertest";
import { generateToken, AuthUser } from "../middleware/auth";

// ── Mocks (must be declared before module imports) ─────────────────────────

jest.mock("../config/database", () => ({ query: jest.fn(), transaction: jest.fn() }));
jest.mock("../utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

// Stripe is required dynamically in PaymentService constructor — virtual mock
// prevents module-not-found errors when the route module is loaded.
jest.mock("stripe", () => jest.fn().mockReturnValue({}), { virtual: true });

const mockCreateCustomer = jest.fn();
const mockSetupPaymentMethod = jest.fn();
const mockEnrollAutoPay = jest.fn();
const mockGetPaymentStatus = jest.fn();

jest.mock("../modules/payment/service", () => ({
  PaymentService: jest.fn().mockImplementation(() => ({
    createCustomer: mockCreateCustomer,
    setupPaymentMethod: mockSetupPaymentMethod,
    enrollAutoPay: mockEnrollAutoPay,
    getPaymentStatus: mockGetPaymentStatus,
  })),
}));

import { query } from "../config/database";
import paymentRouter from "../modules/payment/routes";

const mockQuery = query as jest.MockedFunction<typeof query>;

// ── Test users ─────────────────────────────────────────────────────────────

const leasingAgent: AuthUser = {
  id: "user-la-001",
  email: "agent@example.com",
  role: "leasing_agent",
  firstName: "Alice",
  lastName: "Agent",
  propertyIds: ["prop-001"],
};

const seniorManager: AuthUser = {
  id: "user-sm-001",
  email: "sm@example.com",
  role: "senior_manager",
  firstName: "Bob",
  lastName: "Manager",
  propertyIds: ["prop-001"],
};

function tokenFor(user: AuthUser): string {
  return `Bearer ${generateToken(user)}`;
}

/** Mock the users DB query that authenticate() uses to verify an active user. */
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
      },
    ],
  } as any);
}

// ── Build test app ─────────────────────────────────────────────────────────

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/payment", paymentRouter);
  return app;
}

const app = buildApp();

// ── POST /:applicationId/customer — create Stripe customer ────────────────

describe("POST /payment/:applicationId/customer", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns 401 when no Authorization header is provided", async () => {
    const res = await request(app)
      .post("/payment/app-001/customer")
      .send({ email: "tenant@example.com", firstName: "Jane", lastName: "Doe" });
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/authentication required/i);
  });

  it("returns 401 when token is invalid", async () => {
    const res = await request(app)
      .post("/payment/app-001/customer")
      .set("Authorization", "Bearer bad.token.here")
      .send({ email: "tenant@example.com", firstName: "Jane", lastName: "Doe" });
    expect(res.status).toBe(401);
  });

  it("returns 403 when leasing_agent attempts to create customer (payment:setup)", async () => {
    mockAuthQuery(leasingAgent);

    const res = await request(app)
      .post("/payment/app-001/customer")
      .set("Authorization", tokenFor(leasingAgent))
      .send({ email: "tenant@example.com", firstName: "Jane", lastName: "Doe" });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/insufficient permissions/i);
  });

  it("returns 200 with customer result when senior_manager creates customer", async () => {
    mockAuthQuery(seniorManager);
    mockCreateCustomer.mockResolvedValue({ customerId: "cus_001", applicationId: "app-001" });

    const res = await request(app)
      .post("/payment/app-001/customer")
      .set("Authorization", tokenFor(seniorManager))
      .send({ email: "tenant@example.com", firstName: "Jane", lastName: "Doe" });

    expect(res.status).toBe(200);
    expect(res.body.customerId).toBe("cus_001");
  });

  it("passes correct args to service.createCustomer including actorId and actorRole", async () => {
    mockAuthQuery(seniorManager);
    mockCreateCustomer.mockResolvedValue({ customerId: "cus_002" });

    await request(app)
      .post("/payment/app-001/customer")
      .set("Authorization", tokenFor(seniorManager))
      .send({ email: "jane@example.com", firstName: "Jane", lastName: "Doe" });

    expect(mockCreateCustomer).toHaveBeenCalledWith({
      applicationId: "app-001",
      email: "jane@example.com",
      firstName: "Jane",
      lastName: "Doe",
      actorId: seniorManager.id,
      actorRole: seniorManager.role,
    });
  });

  it("returns 400 when service.createCustomer throws", async () => {
    mockAuthQuery(seniorManager);
    mockCreateCustomer.mockRejectedValue(new Error("Application not found"));

    const res = await request(app)
      .post("/payment/app-001/customer")
      .set("Authorization", tokenFor(seniorManager))
      .send({ email: "tenant@example.com", firstName: "Jane", lastName: "Doe" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not found/i);
  });
});

// ── POST /:applicationId/method — set up payment method ───────────────────

describe("POST /payment/:applicationId/method", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns 401 when no token provided", async () => {
    const res = await request(app)
      .post("/payment/app-001/method")
      .send({ paymentMethodId: "pm_001", paymentType: "ach" });
    expect(res.status).toBe(401);
  });

  it("returns 403 when leasing_agent attempts to set up payment method", async () => {
    mockAuthQuery(leasingAgent);

    const res = await request(app)
      .post("/payment/app-001/method")
      .set("Authorization", tokenFor(leasingAgent))
      .send({ paymentMethodId: "pm_001", paymentType: "ach" });

    expect(res.status).toBe(403);
  });

  it("returns 400 when paymentMethodId is missing (Zod validation)", async () => {
    mockAuthQuery(seniorManager);

    const res = await request(app)
      .post("/payment/app-001/method")
      .set("Authorization", tokenFor(seniorManager))
      .send({ paymentType: "ach" }); // missing paymentMethodId

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/validation failed/i);
    expect(res.body.details).toBeDefined();
  });

  it("returns 400 when paymentType is invalid enum value", async () => {
    mockAuthQuery(seniorManager);

    const res = await request(app)
      .post("/payment/app-001/method")
      .set("Authorization", tokenFor(seniorManager))
      .send({ paymentMethodId: "pm_001", paymentType: "bitcoin" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/validation failed/i);
  });

  it("accepts all valid paymentType enum values", async () => {
    const validTypes = ["ach", "credit_card", "debit_card", "bank_transfer"];

    for (const paymentType of validTypes) {
      mockAuthQuery(seniorManager);
      mockSetupPaymentMethod.mockResolvedValue({ success: true, paymentType });

      const res = await request(app)
        .post("/payment/app-001/method")
        .set("Authorization", tokenFor(seniorManager))
        .send({ paymentMethodId: "pm_001", paymentType });

      expect(res.status).toBe(200);
    }
  });

  it("returns 200 with result when valid method setup submitted", async () => {
    mockAuthQuery(seniorManager);
    mockSetupPaymentMethod.mockResolvedValue({ success: true, applicationId: "app-001" });

    const res = await request(app)
      .post("/payment/app-001/method")
      .set("Authorization", tokenFor(seniorManager))
      .send({ paymentMethodId: "pm_test_001", paymentType: "ach" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it("passes correct args to service.setupPaymentMethod", async () => {
    mockAuthQuery(seniorManager);
    mockSetupPaymentMethod.mockResolvedValue({ success: true });

    await request(app)
      .post("/payment/app-001/method")
      .set("Authorization", tokenFor(seniorManager))
      .send({ paymentMethodId: "pm_xyz", paymentType: "credit_card" });

    expect(mockSetupPaymentMethod).toHaveBeenCalledWith({
      applicationId: "app-001",
      paymentMethodId: "pm_xyz",
      paymentType: "credit_card",
      actorId: seniorManager.id,
      actorRole: seniorManager.role,
    });
  });

  it("returns 400 when service.setupPaymentMethod throws", async () => {
    mockAuthQuery(seniorManager);
    mockSetupPaymentMethod.mockRejectedValue(new Error("No Stripe customer ID found"));

    const res = await request(app)
      .post("/payment/app-001/method")
      .set("Authorization", tokenFor(seniorManager))
      .send({ paymentMethodId: "pm_001", paymentType: "ach" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/stripe customer/i);
  });
});

// ── POST /:applicationId/auto-pay — enroll in auto-pay ───────────────────

describe("POST /payment/:applicationId/auto-pay", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns 401 when no token provided", async () => {
    const res = await request(app).post("/payment/app-001/auto-pay");
    expect(res.status).toBe(401);
  });

  it("returns 403 when leasing_agent attempts to enroll auto-pay", async () => {
    mockAuthQuery(leasingAgent);

    const res = await request(app)
      .post("/payment/app-001/auto-pay")
      .set("Authorization", tokenFor(leasingAgent));

    expect(res.status).toBe(403);
  });

  it("returns 200 with enrolled result when senior_manager enrolls auto-pay", async () => {
    mockAuthQuery(seniorManager);
    mockEnrollAutoPay.mockResolvedValue({ enrolled: true, monthlyDiscount: 25 });

    const res = await request(app)
      .post("/payment/app-001/auto-pay")
      .set("Authorization", tokenFor(seniorManager));

    expect(res.status).toBe(200);
    expect(res.body.enrolled).toBe(true);
    expect(res.body.monthlyDiscount).toBe(25);
  });

  it("passes applicationId, actorId, and actorRole to service.enrollAutoPay", async () => {
    mockAuthQuery(seniorManager);
    mockEnrollAutoPay.mockResolvedValue({ enrolled: true });

    await request(app)
      .post("/payment/app-001/auto-pay")
      .set("Authorization", tokenFor(seniorManager));

    expect(mockEnrollAutoPay).toHaveBeenCalledWith({
      applicationId: "app-001",
      actorId: seniorManager.id,
      actorRole: seniorManager.role,
    });
  });

  it("returns 400 when service.enrollAutoPay throws (no payment method set up)", async () => {
    mockAuthQuery(seniorManager);
    mockEnrollAutoPay.mockRejectedValue(new Error("No payment method configured"));

    const res = await request(app)
      .post("/payment/app-001/auto-pay")
      .set("Authorization", tokenFor(seniorManager));

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/no payment method/i);
  });
});

// ── GET /:applicationId — get payment status ──────────────────────────────

describe("GET /payment/:applicationId", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns 401 when no token provided", async () => {
    const res = await request(app).get("/payment/app-001");
    expect(res.status).toBe(401);
  });

  it("returns 200 for leasing_agent (payment:view is open to all roles)", async () => {
    mockAuthQuery(leasingAgent);
    mockGetPaymentStatus.mockResolvedValue({
      applicationId: "app-001",
      hasCustomer: false,
      hasPaymentMethod: false,
      autoPayEnrolled: false,
      effectiveRent: 1200,
    });

    const res = await request(app)
      .get("/payment/app-001")
      .set("Authorization", tokenFor(leasingAgent));

    expect(res.status).toBe(200);
    expect(res.body.applicationId).toBe("app-001");
  });

  it("returns 404 when service returns null (application not found)", async () => {
    mockAuthQuery(seniorManager);
    mockGetPaymentStatus.mockResolvedValue(null);

    const res = await request(app)
      .get("/payment/app-notexist")
      .set("Authorization", tokenFor(seniorManager));

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  it("returns 200 with full payment status when application found", async () => {
    mockAuthQuery(seniorManager);
    mockGetPaymentStatus.mockResolvedValue({
      applicationId: "app-001",
      hasCustomer: true,
      hasPaymentMethod: true,
      autoPayEnrolled: true,
      monthlyRent: 1500,
      effectiveRent: 1475,
    });

    const res = await request(app)
      .get("/payment/app-001")
      .set("Authorization", tokenFor(seniorManager));

    expect(res.status).toBe(200);
    expect(res.body.hasCustomer).toBe(true);
    expect(res.body.autoPayEnrolled).toBe(true);
    expect(res.body.effectiveRent).toBe(1475);
  });

  it("passes applicationId to service.getPaymentStatus", async () => {
    mockAuthQuery(seniorManager);
    mockGetPaymentStatus.mockResolvedValue({ applicationId: "app-xyz" });

    await request(app)
      .get("/payment/app-xyz")
      .set("Authorization", tokenFor(seniorManager));

    expect(mockGetPaymentStatus).toHaveBeenCalledWith("app-xyz");
  });

  it("returns 500 when service.getPaymentStatus throws unexpectedly", async () => {
    mockAuthQuery(seniorManager);
    mockGetPaymentStatus.mockRejectedValue(new Error("DB connection lost"));

    const res = await request(app)
      .get("/payment/app-001")
      .set("Authorization", tokenFor(seniorManager));

    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/failed to get payment status/i);
  });
});
