/**
 * D2 — maintenance-tech completion flow.
 *
 * The contract under test: a work order may NOT transition to `completed`
 * until at least one `completion_photo` attachment carrying a full GPS fix
 * (latitude AND longitude) exists. The gate lives in
 * MaintenanceService.complete() and surfaces on the route as a 422 with
 * code "completion_photo_required".
 *
 * Strategy mirrors messages-routes.test.ts: mock the DB `query`, mount the
 * real router on a bare express app, and authenticate with a real staff JWT
 * decoded against a mocked users row. Each test queues mockResolvedValueOnce
 * results in the exact order the handler chain issues them:
 *   authenticate (users row) → [service queries in call order].
 */
import express from "express";
import request from "supertest";
import { generateToken, AuthUser } from "../middleware/auth";

jest.mock("../config/database", () => ({
  query: jest.fn(),
  transaction: jest.fn(),
}));
jest.mock("../utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import { query } from "../config/database";
import maintenanceRouter from "../modules/maintenance/routes";

const mockQuery = query as jest.MockedFunction<typeof query>;

const app = express();
app.use(express.json());
app.use("/api/maintenance", maintenanceRouter);

// Staff user with maintenance:manage (asset_manager is global-scope + has the
// permission per the RBAC matrix).
const techUser: AuthUser = {
  id: "user-tech-1",
  email: "tech@example.com",
  role: "asset_manager",
  firstName: "Tess",
  lastName: "Tech",
  propertyIds: [],
  emailVerified: true,
};

// authenticate() → SELECT ... FROM users WHERE id = $1
function mockUsersRow(user: AuthUser) {
  mockQuery.mockResolvedValueOnce({
    rows: [
      {
        id: user.id,
        email: user.email,
        role: user.role,
        first_name: user.firstName,
        last_name: user.lastName,
        property_ids: user.propertyIds ?? [],
        is_active: true,
        email_verified_at: new Date("2026-01-01T00:00:00Z"),
      },
    ],
  } as any);
}

const WO_ID = "11111111-1111-1111-1111-111111111111";

// resetAllMocks before AND after each test: the `before` clears any queued
// mockResolvedValueOnce from a prior test; the `after` drops any entry this
// test queued but the handler chain short-circuited before consuming (e.g. a
// validation-rejection path), so it can never bleed into the next test.
beforeEach(() => jest.resetAllMocks());
afterEach(() => jest.resetAllMocks());

describe("D2 completion gate — POST /:id/complete", () => {
  it("rejects completion with 422 when NO geolocated completion photo exists", async () => {
    const token = generateToken(techUser);
    mockUsersRow(techUser);
    // countGeolocatedCompletionPhotos → COUNT = 0 (no photo / photo w/o geo)
    mockQuery.mockResolvedValueOnce({ rows: [{ count: "0" }] } as any);

    const res = await request(app)
      .post(`/api/maintenance/${WO_ID}/complete`)
      .set("Authorization", `Bearer ${token}`)
      .send({ notes: "Fixed the leak" });

    expect(res.status).toBe(422);
    expect(res.body.code).toBe("completion_photo_required");

    // The UPDATE must NOT have run — only authenticate + the count query fired.
    expect(mockQuery).toHaveBeenCalledTimes(2);
    const ranUpdate = mockQuery.mock.calls.some(
      ([sql]) => typeof sql === "string" && /UPDATE\s+work_orders/i.test(sql)
    );
    expect(ranUpdate).toBe(false);
  });

  it("allows completion when ≥1 geolocated completion photo exists", async () => {
    const token = generateToken(techUser);
    mockUsersRow(techUser);
    // countGeolocatedCompletionPhotos → COUNT = 1
    mockQuery.mockResolvedValueOnce({ rows: [{ count: "1" }] } as any);
    // UPDATE work_orders ... RETURNING application_id
    mockQuery.mockResolvedValueOnce({ rows: [{ application_id: null }] } as any);
    // writeAuditLog INSERT
    mockQuery.mockResolvedValueOnce({ rows: [] } as any);

    const res = await request(app)
      .post(`/api/maintenance/${WO_ID}/complete`)
      .set("Authorization", `Bearer ${token}`)
      .send({ notes: "Fixed the leak", actualCost: 120.5 });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });

    // The completion UPDATE ran exactly once.
    const updateCalls = mockQuery.mock.calls.filter(
      ([sql]) => typeof sql === "string" && /UPDATE\s+work_orders/i.test(sql)
    );
    expect(updateCalls).toHaveLength(1);
  });

  it("the gate query counts ONLY completion_photo rows with both coordinates", async () => {
    const token = generateToken(techUser);
    mockUsersRow(techUser);
    mockQuery.mockResolvedValueOnce({ rows: [{ count: "0" }] } as any);

    await request(app)
      .post(`/api/maintenance/${WO_ID}/complete`)
      .set("Authorization", `Bearer ${token}`)
      .send({ notes: "x" });

    // 2nd query (after authenticate) is the gate count — assert its predicate.
    const [sql, params] = mockQuery.mock.calls[1] as [string, unknown[]];
    expect(sql).toMatch(/kind\s*=\s*'completion_photo'/);
    expect(sql).toMatch(/latitude\s+IS\s+NOT\s+NULL/i);
    expect(sql).toMatch(/longitude\s+IS\s+NOT\s+NULL/i);
    expect(params[0]).toBe(WO_ID);
  });
});

describe("D2 attachments — POST /:id/attachments", () => {
  it("stores a geolocated completion photo (201) and audits hasGeo=true", async () => {
    const token = generateToken(techUser);
    mockUsersRow(techUser);
    // addAttachment: 1) SELECT work order exists
    mockQuery.mockResolvedValueOnce({ rows: [{ id: WO_ID, application_id: null }] } as any);
    // 2) INSERT ... RETURNING id
    mockQuery.mockResolvedValueOnce({ rows: [{ id: "att-1" }] } as any);
    // 3) writeAuditLog INSERT
    mockQuery.mockResolvedValueOnce({ rows: [] } as any);

    const res = await request(app)
      .post(`/api/maintenance/${WO_ID}/attachments`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        url: "https://store.example/photo.jpg",
        kind: "completion_photo",
        latitude: 36.1699,
        longitude: -115.1398,
      });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ id: "att-1" });

    // The INSERT carried the coordinates into the lat/long params.
    const insertCall = mockQuery.mock.calls.find(
      ([sql]) => typeof sql === "string" && /INSERT INTO work_order_attachments/i.test(sql)
    ) as [string, unknown[]];
    expect(insertCall).toBeDefined();
    expect(insertCall[1]).toContain(36.1699);
    expect(insertCall[1]).toContain(-115.1398);

    // Audit details must record the capture without the photo URL (PII-minimal).
    const auditCall = mockQuery.mock.calls.find(
      ([sql]) => typeof sql === "string" && /INSERT INTO audit_log/i.test(sql)
    ) as [string, unknown[]];
    expect(auditCall).toBeDefined();
    const details = JSON.parse(auditCall[1][6] as string);
    expect(details).toEqual({ kind: "completion_photo", hasGeo: true });
  });

  it("rejects an invalid kind with 400 (zod enum)", async () => {
    const token = generateToken(techUser);
    mockUsersRow(techUser);

    const res = await request(app)
      .post(`/api/maintenance/${WO_ID}/attachments`)
      .set("Authorization", `Bearer ${token}`)
      .send({ url: "https://store.example/p.jpg", kind: "selfie" });

    expect(res.status).toBe(400);
    // Handler short-circuits at validation — no DB call beyond authenticate.
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it("rejects out-of-range coordinates with 400", async () => {
    const token = generateToken(techUser);
    mockUsersRow(techUser);

    const res = await request(app)
      .post(`/api/maintenance/${WO_ID}/attachments`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        url: "https://store.example/p.jpg",
        kind: "completion_photo",
        latitude: 200, // invalid
        longitude: -115,
      });

    expect(res.status).toBe(400);
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });
});
