/**
 * Route-layer tests for src/modules/properties/routes.ts
 *
 * Tests HTTP contract: status codes, auth enforcement, RBAC, Zod validation,
 * service delegation, and error propagation across all four endpoints.
 *
 * Auth strategy: real JWT tokens + mock the users DB query that `authenticate`
 * runs on every request — exercises actual auth middleware.
 *
 * Service strategy: mock PropertyService at module level (instantiated at route
 * scope) — isolates routes from DB concerns covered in service tests.
 *
 * RBAC facts under test:
 *   property:view   → ALL roles (leasing_agent, senior_manager, regional_manager,
 *                      asset_manager, system_admin)
 *   property:manage → asset_manager, system_admin only
 *                     leasing_agent / senior_manager / regional_manager → 403
 */

import express from "express";
import request from "supertest";
import { generateToken, AuthUser } from "../middleware/auth";

// ── Mocks (must be declared before module imports) ─────────────────────────

jest.mock("../config/database", () => ({ query: jest.fn(), transaction: jest.fn() }));
jest.mock("../utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const mockList = jest.fn();
const mockListWithAvailability = jest.fn();
const mockGetById = jest.fn();
const mockGetAvailability = jest.fn();
const mockGetRentRange = jest.fn();
const mockCreate = jest.fn();
const mockUpdate = jest.fn();

// Keep the constants in sync with the route source-of-truth so the 400 contract
// assertions (allowed[]) catch any divergence in the underlying enum.
jest.mock("../modules/properties/service", () => ({
  PropertyService: jest.fn().mockImplementation(() => ({
    list: mockList,
    listWithAvailability: mockListWithAvailability,
    getById: mockGetById,
    getAvailability: mockGetAvailability,
    getRentRange: mockGetRentRange,
    create: mockCreate,
    update: mockUpdate,
  })),
  AMI_TIER_ORDER: ["30", "50", "60", "80"] as const,
  BEDROOM_FILTERS: ["studio", "1", "2", "3"] as const,
  AVAILABILITY_FILTERS: ["available_now"] as const,
}));

import { query } from "../config/database";
import propertyRouter from "../modules/properties/routes";

const mockQuery = query as jest.MockedFunction<typeof query>;

// ── Test users ─────────────────────────────────────────────────────────────

const leasingAgent: AuthUser = {
  id: "user-la-001",
  email: "agent@example.com",
  role: "leasing_agent",
  firstName: "Alice",
  lastName: "Agent",
  propertyIds: ["prop-001"],
  emailVerified: true,
};

const seniorManager: AuthUser = {
  id: "user-sm-001",
  email: "sm@example.com",
  role: "senior_manager",
  firstName: "Bob",
  lastName: "Manager",
  propertyIds: ["prop-001"],
  emailVerified: true,
};

const assetManager: AuthUser = {
  id: "user-am-001",
  email: "am@example.com",
  role: "asset_manager",
  firstName: "Carol",
  lastName: "Asset",
  propertyIds: [],
  emailVerified: true,
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
  app.use("/properties", propertyRouter);
  return app;
}

const app = buildApp();

// ── GET /properties — list all properties ─────────────────────────────────

describe("GET /properties", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns 200 anonymously — listing is a public marketing surface", async () => {
    mockListWithAvailability.mockResolvedValue([]);
    const res = await request(app).get("/properties");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ properties: [], total: 0 });
  });

  it("returns 200 with a malformed Authorization header (anonymous treated same as authed for listing)", async () => {
    mockListWithAvailability.mockResolvedValue([]);
    const res = await request(app)
      .get("/properties")
      .set("Authorization", "Bearer bad.token.here");
    expect(res.status).toBe(200);
  });

  it("returns 200 for leasing_agent (property:view open to all roles)", async () => {
    mockAuthQuery(leasingAgent);
    mockListWithAvailability.mockResolvedValue([]);
    const res = await request(app)
      .get("/properties")
      .set("Authorization", tokenFor(leasingAgent));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ properties: [], total: 0 });
  });

  it("returns 200 with properties array and total count", async () => {
    const sampleProp = {
      id: "prop-001",
      name: "Sunrise Apts",
      city: "Atlanta",
      state: "GA",
      availability: {
        availableCount: 3,
        leasedCount: 1,
        totalUnits: 4,
        bedroomBreakdown: { studio: 0, br1: 2, br2: 1, br3: 0 },
      },
    };
    mockAuthQuery(seniorManager);
    mockListWithAvailability.mockResolvedValue([sampleProp]);
    const res = await request(app)
      .get("/properties")
      .set("Authorization", tokenFor(seniorManager));
    expect(res.status).toBe(200);
    expect(res.body.properties).toHaveLength(1);
    expect(res.body.total).toBe(1);
    expect(res.body.properties[0].name).toBe("Sunrise Apts");
    expect(res.body.properties[0].availability.availableCount).toBe(3);
  });

  it("returns 500 when service throws", async () => {
    mockAuthQuery(assetManager);
    mockListWithAvailability.mockRejectedValue(new Error("DB connection lost"));
    const res = await request(app)
      .get("/properties")
      .set("Authorization", tokenFor(assetManager));
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/failed to list properties/i);
  });

  // ── Wedge #8 filter contract ─────────────────────────────────────────────
  // Mirrors PR #69's applicants/units?amiTier= 400 shape so the browse
  // surface and the apply funnel are consistent for the client.

  it("returns 200 and forwards amiTier=50 to service", async () => {
    mockAuthQuery(leasingAgent);
    mockListWithAvailability.mockResolvedValue([]);
    const res = await request(app)
      .get("/properties?amiTier=50")
      .set("Authorization", tokenFor(leasingAgent));
    expect(res.status).toBe(200);
    expect(mockListWithAvailability).toHaveBeenCalledWith(
      expect.objectContaining({ amiTier: "50" })
    );
  });

  it("returns 400 on invalid amiTier with allowed[]", async () => {
    mockAuthQuery(leasingAgent);
    const res = await request(app)
      .get("/properties?amiTier=70")
      .set("Authorization", tokenFor(leasingAgent));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid amiTier/i);
    expect(res.body.allowed).toEqual(["30", "50", "60", "80"]);
  });

  it("returns 200 and forwards bedroom=2 to service", async () => {
    mockAuthQuery(leasingAgent);
    mockListWithAvailability.mockResolvedValue([]);
    const res = await request(app)
      .get("/properties?bedroom=2")
      .set("Authorization", tokenFor(leasingAgent));
    expect(res.status).toBe(200);
    expect(mockListWithAvailability).toHaveBeenCalledWith(
      expect.objectContaining({ bedroom: "2" })
    );
  });

  it("returns 400 on invalid bedroom with allowed[]", async () => {
    mockAuthQuery(leasingAgent);
    const res = await request(app)
      .get("/properties?bedroom=loft")
      .set("Authorization", tokenFor(leasingAgent));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid bedroom/i);
    expect(res.body.allowed).toEqual(["studio", "1", "2", "3"]);
  });

  it("returns 200 and forwards availability=available_now to service", async () => {
    mockAuthQuery(leasingAgent);
    mockListWithAvailability.mockResolvedValue([]);
    const res = await request(app)
      .get("/properties?availability=available_now")
      .set("Authorization", tokenFor(leasingAgent));
    expect(res.status).toBe(200);
    expect(mockListWithAvailability).toHaveBeenCalledWith(
      expect.objectContaining({ availability: "available_now" })
    );
  });

  it("returns 400 on invalid availability with allowed[]", async () => {
    mockAuthQuery(leasingAgent);
    const res = await request(app)
      .get("/properties?availability=soon")
      .set("Authorization", tokenFor(leasingAgent));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid availability/i);
    expect(res.body.allowed).toEqual(["available_now"]);
  });

  it("combines amiTier + bedroom + availability filters into one call", async () => {
    mockAuthQuery(leasingAgent);
    mockListWithAvailability.mockResolvedValue([]);
    const res = await request(app)
      .get("/properties?amiTier=60&bedroom=2&availability=available_now")
      .set("Authorization", tokenFor(leasingAgent));
    expect(res.status).toBe(200);
    expect(mockListWithAvailability).toHaveBeenCalledWith({
      amiTier: "60",
      bedroom: "2",
      availability: "available_now",
    });
  });
});

// ── GET /properties/:propertyId/availability — wedge #8 ───────────────────

describe("GET /properties/:propertyId/availability", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns 401 without auth", async () => {
    const res = await request(app).get("/properties/prop-001/availability");
    expect(res.status).toBe(401);
  });

  it("returns 200 with bedroom-grouped availability when found", async () => {
    const payload = {
      propertyId: "prop-001",
      availableCount: 4,
      bedroomBreakdown: { studio: 1, br1: 2, br2: 1, br3: 0 },
      units: [
        {
          id: "u-1",
          unitNumber: "A-101",
          bedrooms: 1,
          bathrooms: 1,
          sqft: 650,
          monthlyRent: 995,
          availableFrom: null,
        },
      ],
    };
    mockAuthQuery(leasingAgent);
    mockGetAvailability.mockResolvedValue(payload);
    const res = await request(app)
      .get("/properties/prop-001/availability")
      .set("Authorization", tokenFor(leasingAgent));
    expect(res.status).toBe(200);
    expect(res.body.availableCount).toBe(4);
    expect(res.body.bedroomBreakdown.br1).toBe(2);
    expect(res.body.units).toHaveLength(1);
  });

  it("returns 404 when property is not found", async () => {
    mockAuthQuery(leasingAgent);
    mockGetAvailability.mockResolvedValue(null);
    const res = await request(app)
      .get("/properties/missing/availability")
      .set("Authorization", tokenFor(leasingAgent));
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/property not found/i);
  });

  it("returns 500 when service throws", async () => {
    mockAuthQuery(assetManager);
    mockGetAvailability.mockRejectedValue(new Error("DB timeout"));
    const res = await request(app)
      .get("/properties/prop-001/availability")
      .set("Authorization", tokenFor(assetManager));
    expect(res.status).toBe(500);
  });
});

// ── GET /properties/:propertyId/rent-range — wedge #9 ─────────────────────

describe("GET /properties/:propertyId/rent-range", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns 401 without auth", async () => {
    const res = await request(app).get("/properties/prop-001/rent-range");
    expect(res.status).toBe(401);
  });

  it("returns 200 with rentRange + amiTier when found", async () => {
    const payload = {
      propertyId: "prop-001",
      rentRange: {
        studio: { low: 747, high: 747 },
        br1: { low: 995, high: 995 },
        br2: null,
        br3: null,
      },
      amiTier: "60% AMI",
    };
    mockAuthQuery(leasingAgent);
    mockGetRentRange.mockResolvedValue(payload);
    const res = await request(app)
      .get("/properties/prop-001/rent-range")
      .set("Authorization", tokenFor(leasingAgent));
    expect(res.status).toBe(200);
    expect(res.body.amiTier).toBe("60% AMI");
    expect(res.body.rentRange.br1).toEqual({ low: 995, high: 995 });
    expect(res.body.rentRange.br2).toBeNull();
    expect(res.body.rentRange.br3).toBeNull();
  });

  it("returns 404 when property is not found", async () => {
    mockAuthQuery(leasingAgent);
    mockGetRentRange.mockResolvedValue(null);
    const res = await request(app)
      .get("/properties/missing/rent-range")
      .set("Authorization", tokenFor(leasingAgent));
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/property not found/i);
  });

  it("returns 500 when service throws", async () => {
    mockAuthQuery(assetManager);
    mockGetRentRange.mockRejectedValue(new Error("DB timeout"));
    const res = await request(app)
      .get("/properties/prop-001/rent-range")
      .set("Authorization", tokenFor(assetManager));
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/failed to get property rent range/i);
  });
});

// ── GET /properties/:propertyId — get one property ────────────────────────

describe("GET /properties/:propertyId", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns 401 without auth", async () => {
    const res = await request(app).get("/properties/prop-001");
    expect(res.status).toBe(401);
  });

  it("returns 200 with the property when found", async () => {
    const sampleProp = { id: "prop-001", name: "Sunrise Apts" };
    mockAuthQuery(leasingAgent);
    mockGetById.mockResolvedValue(sampleProp);
    const res = await request(app)
      .get("/properties/prop-001")
      .set("Authorization", tokenFor(leasingAgent));
    expect(res.status).toBe(200);
    expect(res.body.id).toBe("prop-001");
  });

  it("returns 404 when property is not found", async () => {
    mockAuthQuery(leasingAgent);
    mockGetById.mockResolvedValue(null);
    const res = await request(app)
      .get("/properties/nonexistent")
      .set("Authorization", tokenFor(leasingAgent));
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/property not found/i);
  });

  it("forwards propertyId to service.getById", async () => {
    mockAuthQuery(assetManager);
    mockGetById.mockResolvedValue({ id: "prop-abc" });
    await request(app)
      .get("/properties/prop-abc")
      .set("Authorization", tokenFor(assetManager));
    expect(mockGetById).toHaveBeenCalledWith("prop-abc");
  });

  it("returns 500 when service throws", async () => {
    mockAuthQuery(assetManager);
    mockGetById.mockRejectedValue(new Error("timeout"));
    const res = await request(app)
      .get("/properties/prop-001")
      .set("Authorization", tokenFor(assetManager));
    expect(res.status).toBe(500);
  });
});

// ── POST /properties — create property ────────────────────────────────────

describe("POST /properties", () => {
  const validPayload = {
    name: "Sunrise Apts",
    addressLine1: "100 Main St",
    city: "Atlanta",
    state: "GA",
    zip: "30301",
    unitCount: 50,
    amiArea: "Atlanta-Sandy Springs MSA",
  };

  beforeEach(() => jest.clearAllMocks());

  it("returns 401 without auth", async () => {
    const res = await request(app).post("/properties").send(validPayload);
    expect(res.status).toBe(401);
  });

  it("returns 403 when leasing_agent attempts to create (property:manage)", async () => {
    mockAuthQuery(leasingAgent);
    const res = await request(app)
      .post("/properties")
      .set("Authorization", tokenFor(leasingAgent))
      .send(validPayload);
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/insufficient permissions/i);
  });

  it("returns 403 when senior_manager attempts to create (property:manage)", async () => {
    mockAuthQuery(seniorManager);
    const res = await request(app)
      .post("/properties")
      .set("Authorization", tokenFor(seniorManager))
      .send(validPayload);
    expect(res.status).toBe(403);
  });

  it("returns 400 when required fields are missing", async () => {
    mockAuthQuery(assetManager);
    const res = await request(app)
      .post("/properties")
      .set("Authorization", tokenFor(assetManager))
      .send({ name: "Missing everything else" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/validation failed/i);
    expect(res.body.details).toBeDefined();
  });

  it("returns 400 when state is not a 2-character code", async () => {
    mockAuthQuery(assetManager);
    const res = await request(app)
      .post("/properties")
      .set("Authorization", tokenFor(assetManager))
      .send({ ...validPayload, state: "Georgia" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/validation failed/i);
  });

  it("returns 400 when unitCount is not a positive integer", async () => {
    mockAuthQuery(assetManager);
    const res = await request(app)
      .post("/properties")
      .set("Authorization", tokenFor(assetManager))
      .send({ ...validPayload, unitCount: -5 });
    expect(res.status).toBe(400);
  });

  it("returns 201 with created property on success", async () => {
    const created = { id: "prop-new", ...validPayload };
    mockAuthQuery(assetManager);
    mockCreate.mockResolvedValue(created);
    const res = await request(app)
      .post("/properties")
      .set("Authorization", tokenFor(assetManager))
      .send(validPayload);
    expect(res.status).toBe(201);
    expect(res.body.id).toBe("prop-new");
  });

  it("forwards actorId and actorRole to service.create", async () => {
    mockAuthQuery(assetManager);
    mockCreate.mockResolvedValue({ id: "prop-new" });
    await request(app)
      .post("/properties")
      .set("Authorization", tokenFor(assetManager))
      .send(validPayload);
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Sunrise Apts" }),
      assetManager.id,
      assetManager.role
    );
  });

  it("returns 400 when service throws (e.g. duplicate name)", async () => {
    mockAuthQuery(assetManager);
    mockCreate.mockRejectedValue(new Error("duplicate key value"));
    const res = await request(app)
      .post("/properties")
      .set("Authorization", tokenFor(assetManager))
      .send(validPayload);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/duplicate key value/i);
  });
});

// ── PATCH /properties/:propertyId — update property ───────────────────────

describe("PATCH /properties/:propertyId", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns 401 without auth", async () => {
    const res = await request(app).patch("/properties/prop-001").send({ name: "New Name" });
    expect(res.status).toBe(401);
  });

  it("returns 403 when leasing_agent attempts to update (property:manage)", async () => {
    mockAuthQuery(leasingAgent);
    const res = await request(app)
      .patch("/properties/prop-001")
      .set("Authorization", tokenFor(leasingAgent))
      .send({ name: "New Name" });
    expect(res.status).toBe(403);
  });

  it("returns 400 when unitCount is a non-integer (Zod validation)", async () => {
    mockAuthQuery(assetManager);
    const res = await request(app)
      .patch("/properties/prop-001")
      .set("Authorization", tokenFor(assetManager))
      .send({ unitCount: 2.5 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/validation failed/i);
  });

  it("returns 200 with updated property on success", async () => {
    const updated = { id: "prop-001", name: "New Name", unitCount: 75 };
    mockAuthQuery(assetManager);
    mockUpdate.mockResolvedValue(updated);
    const res = await request(app)
      .patch("/properties/prop-001")
      .set("Authorization", tokenFor(assetManager))
      .send({ name: "New Name", unitCount: 75 });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe("New Name");
  });

  it("forwards propertyId, input, actorId, actorRole to service.update", async () => {
    mockAuthQuery(assetManager);
    mockUpdate.mockResolvedValue({ id: "prop-001" });
    await request(app)
      .patch("/properties/prop-001")
      .set("Authorization", tokenFor(assetManager))
      .send({ amiArea: "Miami MSA" });
    expect(mockUpdate).toHaveBeenCalledWith(
      "prop-001",
      expect.objectContaining({ amiArea: "Miami MSA" }),
      assetManager.id,
      assetManager.role
    );
  });

  it("returns 400 when service throws (e.g. property not found)", async () => {
    mockAuthQuery(assetManager);
    mockUpdate.mockRejectedValue(new Error("Property not found: prop-999"));
    const res = await request(app)
      .patch("/properties/prop-999")
      .set("Authorization", tokenFor(assetManager))
      .send({ name: "Ghost" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/property not found/i);
  });

  it("returns 400 when service throws (e.g. no fields provided)", async () => {
    mockAuthQuery(assetManager);
    mockUpdate.mockRejectedValue(new Error("No fields provided for update"));
    const res = await request(app)
      .patch("/properties/prop-001")
      .set("Authorization", tokenFor(assetManager))
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/no fields provided/i);
  });
});
