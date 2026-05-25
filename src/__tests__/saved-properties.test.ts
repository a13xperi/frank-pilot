/**
 * Saved-property shortlist route + conversion tests.
 *
 * Covers:
 *   POST   /saved                      (guest save mints uh_guest cookie; authed save)
 *   DELETE /saved/:propertyId          (idempotent, owner-scoped)
 *   GET    /saved                      (grouped by list_name; empty when no owner)
 *   PATCH  /saved/:propertyId/alert    (vacancy-alert toggle)
 *   GET    /saved/compare              (owner-scoped, order-preserving)
 *   migrateGuestSavesToUser()          (guest → user conversion, idempotent)
 *
 * Strategy mirrors src/__tests__/waitlist-routes.test.ts: query()/transaction()
 * are mocked and each test scripts the rows the handler will SELECT/INSERT/etc.
 *
 * Query ordering matters. The route's optional-auth helper issues a `SELECT id
 * FROM users` ONLY when a Bearer token is present, so unauth (guest) tests skip
 * that row. A guest WRITE resolves the property slug first, then the guest
 * session, then the save insert (+ slug re-read).
 */
import type { QueryResult } from "pg";
import express from "express";
import request from "supertest";
import { generateToken, AuthUser } from "../middleware/auth";

function qr<T extends Record<string, unknown>>(rows: T[]): QueryResult<T> {
  return { rows } as unknown as QueryResult<T>;
}
function qrWithCount<T extends Record<string, unknown>>(
  rows: T[],
  rowCount: number
): QueryResult<T> {
  return { rows, rowCount } as unknown as QueryResult<T>;
}

jest.mock("../config/database", () => ({
  query: jest.fn(),
  transaction: jest.fn(),
}));
jest.mock("../utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import { query, transaction } from "../config/database";
import savedRouter from "../modules/saved/routes";
import {
  migrateGuestSavesToUser,
  hashGuestToken,
} from "../modules/saved/service";

const mockQuery = query as jest.MockedFunction<typeof query>;
const mockTransaction = transaction as jest.MockedFunction<typeof transaction>;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/saved", savedRouter);
  return app;
}
const app = buildApp();

const SLUG = "donna-louise-2";
const PROPERTY_ID = "550e8400-e29b-41d4-a716-446655440099";
const GUEST_SESSION_ID = "11111111-1111-1111-1111-111111111111";

let __seq = 0;
function makeUser(): AuthUser {
  __seq += 1;
  return {
    id: `00000000-0000-0000-0000-${String(__seq).padStart(12, "0")}`,
    email: `u${__seq}@x.com`,
    role: "applicant",
    firstName: "Ann",
    lastName: "App",
    propertyIds: [],
    emailVerified: true,
  };
}

describe("POST /saved (guest)", () => {
  beforeEach(() => jest.clearAllMocks());

  it("400 on missing propertyId", async () => {
    const res = await request(app).post("/saved").send({});
    expect(res.status).toBe(400);
  });

  it("404 when slug resolves to no property", async () => {
    mockQuery.mockResolvedValueOnce(qr([])); // resolvePropertyIdBySlug → none
    const res = await request(app).post("/saved").send({ propertyId: SLUG });
    expect(res.status).toBe(404);
  });

  it("first guest save mints a uh_guest httpOnly cookie + returns the item", async () => {
    // No Bearer → no users SELECT. Order:
    mockQuery.mockResolvedValueOnce(qr([{ id: PROPERTY_ID }])); // resolve slug
    mockQuery.mockResolvedValueOnce(qr([{ id: GUEST_SESSION_ID }])); // INSERT guest_sessions
    mockQuery.mockResolvedValueOnce(
      qr([
        {
          id: "saved-1",
          property_id: PROPERTY_ID,
          list_name: "My list",
          alert_enabled: false,
          created_at: new Date("2026-05-24T00:00:00Z"),
        },
      ])
    ); // INSERT saved_properties RETURNING
    mockQuery.mockResolvedValueOnce(qr([{ slug: SLUG }])); // resolveSlug

    const res = await request(app).post("/saved").send({ propertyId: SLUG });
    expect(res.status).toBe(201);
    expect(res.body.saved).toMatchObject({
      propertyId: PROPERTY_ID,
      propertySlug: SLUG,
      listName: "My list",
      alertEnabled: false,
    });
    const setCookie = res.headers["set-cookie"];
    expect(setCookie).toBeDefined();
    const cookieStr = Array.isArray(setCookie) ? setCookie.join(";") : String(setCookie);
    expect(cookieStr).toContain("uh_guest=");
    expect(cookieStr).toContain("HttpOnly");
    expect(cookieStr).toContain("SameSite=Lax");
  });

  it("existing guest cookie reuses the session — no new cookie", async () => {
    const rawToken = "existing-guest-token-aaaaaaaaaaaaaaaaaaaa";
    mockQuery.mockResolvedValueOnce(qr([{ id: PROPERTY_ID }])); // resolve slug
    mockQuery.mockResolvedValueOnce(qr([{ id: GUEST_SESSION_ID }])); // UPDATE guest_sessions (found)
    mockQuery.mockResolvedValueOnce(
      qr([
        {
          id: "saved-2",
          property_id: PROPERTY_ID,
          list_name: "My list",
          alert_enabled: false,
          created_at: new Date("2026-05-24T00:00:00Z"),
        },
      ])
    );
    mockQuery.mockResolvedValueOnce(qr([{ slug: SLUG }]));

    const res = await request(app)
      .post("/saved")
      .set("Cookie", `uh_guest=${rawToken}`)
      .send({ propertyId: SLUG });
    expect(res.status).toBe(201);
    expect(res.headers["set-cookie"]).toBeUndefined();
    // The guest session was resolved by token_hash, not the raw token.
    const updateCall = mockQuery.mock.calls.find(
      (c) => typeof c[0] === "string" && (c[0] as string).includes("UPDATE guest_sessions")
    );
    expect(updateCall![1]).toEqual([hashGuestToken(rawToken)]);
  });
});

describe("POST /saved (authed user)", () => {
  beforeEach(() => jest.clearAllMocks());

  it("authed save scopes to user_id + uses the user-side conflict target", async () => {
    const user = makeUser();
    // POST resolves the property slug BEFORE the owner. So: slug SELECT, then
    // the optional-auth users SELECT, then the save insert + slug re-read.
    mockQuery.mockResolvedValueOnce(qr([{ id: PROPERTY_ID }])); // resolve slug
    mockQuery.mockResolvedValueOnce(qr([{ id: user.id }])); // optional-auth users SELECT
    mockQuery.mockResolvedValueOnce(
      qr([
        {
          id: "saved-u1",
          property_id: PROPERTY_ID,
          list_name: "My list",
          alert_enabled: false,
          created_at: new Date("2026-05-24T00:00:00Z"),
        },
      ])
    );
    mockQuery.mockResolvedValueOnce(qr([{ slug: SLUG }]));

    const token = generateToken(user);
    const res = await request(app)
      .post("/saved")
      .set("Authorization", `Bearer ${token}`)
      .send({ propertyId: SLUG });
    expect(res.status).toBe(201);
    // No guest cookie for an authed save.
    expect(res.headers["set-cookie"]).toBeUndefined();
    const insertCall = mockQuery.mock.calls.find(
      (c) =>
        typeof c[0] === "string" && (c[0] as string).includes("INSERT INTO saved_properties")
    );
    expect(insertCall![0]).toContain("user_id");
    // Partial-unique indexes can't be named as constraints; the upsert infers
    // the user-side index by its columns + matching WHERE predicate.
    expect(insertCall![0]).toContain("ON CONFLICT (user_id, property_id, list_name)");
    expect(insertCall![0]).toContain("WHERE user_id IS NOT NULL");
    expect(insertCall![1]![0]).toBe(user.id);
  });
});

describe("DELETE /saved/:propertyId", () => {
  beforeEach(() => jest.clearAllMocks());

  it("idempotent ok=true with no owner cookie", async () => {
    // resolvePropertyRef: UUID path → SELECT properties (found), then no owner.
    mockQuery.mockResolvedValueOnce(qr([{ id: PROPERTY_ID }])); // properties SELECT (uuid)
    // resolveOwnerForRead: no Bearer, no cookie → returns null, no query.
    const res = await request(app).delete(`/saved/${PROPERTY_ID}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, removed: 0 });
  });

  it("removes the guest's save (owner-scoped DELETE)", async () => {
    const rawToken = "guest-del-token-bbbbbbbbbbbbbbbbbbbb";
    mockQuery.mockResolvedValueOnce(qr([{ id: PROPERTY_ID }])); // resolve uuid
    mockQuery.mockResolvedValueOnce(qr([{ id: GUEST_SESSION_ID }])); // resolveOwnerForRead UPDATE guest_sessions
    mockQuery.mockResolvedValueOnce(qrWithCount([], 1)); // DELETE

    const res = await request(app)
      .delete(`/saved/${PROPERTY_ID}`)
      .set("Cookie", `uh_guest=${rawToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, removed: 1 });
    const delCall = mockQuery.mock.calls.find(
      (c) =>
        typeof c[0] === "string" && (c[0] as string).includes("DELETE FROM saved_properties")
    );
    expect(delCall![0]).toContain("guest_session_id = $1");
    expect(delCall![1]).toEqual([GUEST_SESSION_ID, PROPERTY_ID]);
  });
});

describe("GET /saved", () => {
  beforeEach(() => jest.clearAllMocks());

  it("empty shortlist when there is no owner", async () => {
    const res = await request(app).get("/saved");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ lists: [], count: 0 });
  });

  it("groups saves by list_name with property summary", async () => {
    const rawToken = "guest-list-token-cccccccccccccccccccc";
    mockQuery.mockResolvedValueOnce(qr([{ id: GUEST_SESSION_ID }])); // resolveOwnerForRead
    mockQuery.mockResolvedValueOnce(
      qr([
        {
          id: "s1",
          property_id: PROPERTY_ID,
          list_name: "My list",
          alert_enabled: false,
          created_at: new Date("2026-05-24T00:00:00Z"),
          name: "Donna Louise 2",
          slug: SLUG,
          ami_set_aside: "60% AMI",
          available_count: 3,
          rent_min: 900,
          rent_max: 1400,
        },
        {
          id: "s2",
          property_id: "650e8400-e29b-41d4-a716-446655440011",
          list_name: "Dream homes",
          alert_enabled: true,
          created_at: new Date("2026-05-24T01:00:00Z"),
          name: "Sunrise Villas",
          slug: "sunrise-villas",
          ami_set_aside: null,
          available_count: 0,
          rent_min: null,
          rent_max: null,
        },
      ])
    );

    const res = await request(app).get("/saved").set("Cookie", `uh_guest=${rawToken}`);
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(2);
    expect(res.body.lists).toHaveLength(2);
    const myList = res.body.lists.find((l: { listName: string }) => l.listName === "My list");
    expect(myList.items[0]).toMatchObject({
      propertySlug: SLUG,
      amiTier: "60",
      availableCount: 3,
      rentMin: 900,
      rentMax: 1400,
      walkScore: null,
    });
  });
});

describe("PATCH /saved/:propertyId/alert", () => {
  beforeEach(() => jest.clearAllMocks());

  it("400 on bad body", async () => {
    const res = await request(app)
      .patch(`/saved/${PROPERTY_ID}/alert`)
      .send({ enabled: "yes" });
    expect(res.status).toBe(400);
  });

  it("404 when the owner has no save for the property", async () => {
    const rawToken = "guest-alert-token-dddddddddddddddddddd";
    mockQuery.mockResolvedValueOnce(qr([{ id: PROPERTY_ID }])); // resolve uuid
    mockQuery.mockResolvedValueOnce(qr([{ id: GUEST_SESSION_ID }])); // owner
    mockQuery.mockResolvedValueOnce(qr([])); // UPDATE ... RETURNING → none
    const res = await request(app)
      .patch(`/saved/${PROPERTY_ID}/alert`)
      .set("Cookie", `uh_guest=${rawToken}`)
      .send({ enabled: true });
    expect(res.status).toBe(404);
  });

  it("toggles the alert and returns the updated item", async () => {
    const rawToken = "guest-alert-ok-token-eeeeeeeeeeeeeeee";
    mockQuery.mockResolvedValueOnce(qr([{ id: PROPERTY_ID }])); // resolve uuid
    mockQuery.mockResolvedValueOnce(qr([{ id: GUEST_SESSION_ID }])); // owner
    mockQuery.mockResolvedValueOnce(
      qr([
        {
          id: "s1",
          property_id: PROPERTY_ID,
          list_name: "My list",
          alert_enabled: true,
          created_at: new Date("2026-05-24T00:00:00Z"),
        },
      ])
    ); // UPDATE RETURNING
    mockQuery.mockResolvedValueOnce(qr([{ slug: SLUG }])); // resolveSlug

    const res = await request(app)
      .patch(`/saved/${PROPERTY_ID}/alert`)
      .set("Cookie", `uh_guest=${rawToken}`)
      .send({ enabled: true });
    expect(res.status).toBe(200);
    expect(res.body.saved.alertEnabled).toBe(true);
  });
});

describe("GET /saved/compare", () => {
  beforeEach(() => jest.clearAllMocks());

  it("400 when ids missing", async () => {
    const res = await request(app).get("/saved/compare");
    expect(res.status).toBe(400);
  });

  it("empty when no owner", async () => {
    const res = await request(app).get(`/saved/compare?ids=${PROPERTY_ID}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ properties: [] });
  });

  it("returns owner-scoped compare rows preserving request order", async () => {
    const rawToken = "guest-cmp-token-ffffffffffffffffffff";
    const idA = PROPERTY_ID;
    const idB = "650e8400-e29b-41d4-a716-446655440011";
    mockQuery.mockResolvedValueOnce(qr([{ id: GUEST_SESSION_ID }])); // owner
    // resolvePropertyRef for each id (both UUIDs):
    mockQuery.mockResolvedValueOnce(qr([{ id: idA }]));
    mockQuery.mockResolvedValueOnce(qr([{ id: idB }]));
    // getCompare query (returns out of order — handler must reorder to [A,B]):
    mockQuery.mockResolvedValueOnce(
      qr([
        {
          property_id: idB,
          slug: "sunrise-villas",
          name: "Sunrise Villas",
          city: "Reno",
          ami_set_aside: null,
          available_count: 0,
          rent_min: null,
          rent_max: null,
        },
        {
          property_id: idA,
          slug: SLUG,
          name: "Donna Louise 2",
          city: "Las Vegas",
          ami_set_aside: "60% AMI",
          available_count: 3,
          rent_min: 900,
          rent_max: 1400,
        },
      ])
    );

    const res = await request(app)
      .get(`/saved/compare?ids=${idA},${idB}`)
      .set("Cookie", `uh_guest=${rawToken}`);
    expect(res.status).toBe(200);
    expect(res.body.properties.map((p: { propertyId: string }) => p.propertyId)).toEqual([
      idA,
      idB,
    ]);
    expect(res.body.properties[0]).toMatchObject({ amiTier: "60", city: "Las Vegas" });
  });
});

describe("migrateGuestSavesToUser (conversion)", () => {
  beforeEach(() => jest.clearAllMocks());

  it("no-op when there is no guest token", async () => {
    const n = await migrateGuestSavesToUser(null, "user-1");
    expect(n).toBe(0);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("migrates guest saves onto the user, dropping collisions and stamping conversion", async () => {
    const userId = "00000000-0000-0000-0000-000000000abc";
    const clientQuery = jest
      .fn()
      // SELECT ... FOR UPDATE → un-converted session
      .mockResolvedValueOnce({ rows: [{ id: GUEST_SESSION_ID, converted_user_id: null }] })
      // UPDATE re-point (NOT EXISTS guard) → 2 rows migrated
      .mockResolvedValueOnce({ rowCount: 2 })
      // DELETE leftover colliding guest rows
      .mockResolvedValueOnce({ rowCount: 1 })
      // UPDATE guest_sessions stamp
      .mockResolvedValueOnce({ rowCount: 1 });
    mockTransaction.mockImplementation((async (fn: (c: { query: typeof clientQuery }) => unknown) =>
      fn({ query: clientQuery })) as unknown as typeof transaction);

    const n = await migrateGuestSavesToUser("raw-guest-token-zzzzzzzzzzzzzzzzzzzz", userId);
    expect(n).toBe(2);
    // Re-point flips owner columns.
    const repoint = clientQuery.mock.calls.find(
      (c) => typeof c[0] === "string" && c[0].includes("SET user_id = $2, guest_session_id = NULL")
    );
    expect(repoint).toBeDefined();
    // Conversion is stamped.
    const stamp = clientQuery.mock.calls.find(
      (c) => typeof c[0] === "string" && c[0].includes("SET converted_user_id = $2")
    );
    expect(stamp).toBeDefined();
  });

  it("idempotent: already-converted session is a no-op", async () => {
    const clientQuery = jest
      .fn()
      .mockResolvedValueOnce({ rows: [{ id: GUEST_SESSION_ID, converted_user_id: "someone" }] });
    mockTransaction.mockImplementation((async (fn: (c: { query: typeof clientQuery }) => unknown) =>
      fn({ query: clientQuery })) as unknown as typeof transaction);
    const n = await migrateGuestSavesToUser("raw-token-already-converted-xxxx", "user-2");
    expect(n).toBe(0);
    // Only the SELECT FOR UPDATE ran — no re-point.
    expect(clientQuery).toHaveBeenCalledTimes(1);
  });
});
