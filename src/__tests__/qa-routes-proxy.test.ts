/**
 * Route-layer tests for the QA-bundle streaming-proxy endpoints
 * (src/modules/qa/routes.ts → `/api/qa/bundles/:stem/{png,sidecar,replay}`).
 *
 * These endpoints close the critical vulnerability from PR #103: previously
 * the operator UI fetched sidecar JSON + rrweb replay bytes directly from the
 * public Supabase Storage bucket, so anyone with a URL bypassed every
 * server-side gate. Now every artifact request is gated by `authenticate` +
 * `requirePermission("audit:view")`, audited via `qa_bundle_read`, and
 * proxied through the server's service-role credentials.
 *
 * Auth strategy mirrors fair-housing-routes.test.ts: real JWT tokens + a
 * mocked users-DB query so we exercise the real auth middleware.
 *
 * Storage strategy: mock global `fetch` so the route's outbound Supabase
 * call returns canned bytes. We don't need a real bucket to verify the gate.
 */

import express from "express";
import request from "supertest";
import { generateToken, AuthUser } from "../middleware/auth";

// ── Mocks (must precede module imports) ───────────────────────────────────

jest.mock("../config/database", () => ({ query: jest.fn(), transaction: jest.fn() }));
jest.mock("../utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const mockWriteAuditLog = jest.fn();
jest.mock("../middleware/audit", () => ({
  ...jest.requireActual("../middleware/audit"),
  writeAuditLog: (...args: unknown[]) => mockWriteAuditLog(...args),
}));

import { query } from "../config/database";
import { qaRouter } from "../modules/qa/routes";

const mockQuery = query as jest.MockedFunction<typeof query>;

// ── Fixtures ──────────────────────────────────────────────────────────────

const STEM = "frank-home-20260522-143000";
const BAD_STEM = "not-a-valid-stem";

const leasingAgent: AuthUser = {
  id: "user-la-001",
  email: "agent@example.com",
  role: "leasing_agent",
  firstName: "Alice",
  lastName: "Agent",
  propertyIds: [],
  emailVerified: true,
};

const regionalManager: AuthUser = {
  id: "user-rm-001",
  email: "rm@example.com",
  role: "regional_manager",
  firstName: "Carol",
  lastName: "Regional",
  propertyIds: [],
  emailVerified: true,
};

function tokenFor(user: AuthUser): string {
  return `Bearer ${generateToken(user)}`;
}

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

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/qa", qaRouter());
  return app;
}

// ── Mock global fetch (Supabase Storage REST) ─────────────────────────────

const originalFetch = global.fetch;
let mockFetch: jest.Mock;

function setStorageEnv() {
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role";
}

function unsetStorageEnv() {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.SUPABASE_KEY;
}

beforeEach(() => {
  jest.resetAllMocks();
  mockFetch = jest.fn();
  global.fetch = mockFetch as unknown as typeof global.fetch;
  setStorageEnv();
});

afterAll(() => {
  global.fetch = originalFetch;
  unsetStorageEnv();
});

const app = buildApp();

// ── Tests ─────────────────────────────────────────────────────────────────

describe("GET /api/qa/bundles/:stem/png — streaming proxy", () => {
  it("returns 401 when no Authorization header is provided", async () => {
    const res = await request(app).get(`/api/qa/bundles/${STEM}/png`);
    expect(res.status).toBe(401);
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockWriteAuditLog).not.toHaveBeenCalled();
  });

  it("returns 403 for leasing_agent (audit:view = regional_manager+)", async () => {
    mockAuthQuery(leasingAgent);
    const res = await request(app)
      .get(`/api/qa/bundles/${STEM}/png`)
      .set("Authorization", tokenFor(leasingAgent));
    expect(res.status).toBe(403);
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockWriteAuditLog).not.toHaveBeenCalled();
  });

  it("returns 400 when the stem fails the parseStem regex", async () => {
    mockAuthQuery(regionalManager);
    const res = await request(app)
      .get(`/api/qa/bundles/${BAD_STEM}/png`)
      .set("Authorization", tokenFor(regionalManager));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/malformed/i);
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockWriteAuditLog).not.toHaveBeenCalled();
  });

  it("returns 404 when Supabase Storage reports the object missing", async () => {
    mockAuthQuery(regionalManager);
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      text: async () => "",
    } as Response);
    const res = await request(app)
      .get(`/api/qa/bundles/${STEM}/png`)
      .set("Authorization", tokenFor(regionalManager));
    expect(res.status).toBe(404);
    expect(mockWriteAuditLog).not.toHaveBeenCalled();
  });

  it("returns 200 + image/png + bytes for a valid stem", async () => {
    mockAuthQuery(regionalManager);
    const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "image/png" }),
      arrayBuffer: async () =>
        pngBytes.buffer.slice(
          pngBytes.byteOffset,
          pngBytes.byteOffset + pngBytes.byteLength
        ),
    } as unknown as Response);
    mockWriteAuditLog.mockResolvedValueOnce(undefined);

    const res = await request(app)
      .get(`/api/qa/bundles/${STEM}/png`)
      .set("Authorization", tokenFor(regionalManager));

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/image\/png/);
    expect(res.body).toEqual(pngBytes);
    // Bucket URL was constructed via the authenticated /storage/v1/object endpoint
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, opts] = mockFetch.mock.calls[0];
    expect(String(url)).toMatch(
      /\/storage\/v1\/object\/frank-qa-screenshots\/frank-home-20260522-143000\.png$/
    );
    expect((opts as RequestInit).headers).toMatchObject({
      apikey: "test-service-role",
      Authorization: "Bearer test-service-role",
    });
  });

  it("writes an audit log entry with action=qa_bundle_read on success", async () => {
    mockAuthQuery(regionalManager);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "image/png" }),
      arrayBuffer: async () => new ArrayBuffer(0),
    } as unknown as Response);
    mockWriteAuditLog.mockResolvedValueOnce(undefined);

    await request(app)
      .get(`/api/qa/bundles/${STEM}/png`)
      .set("Authorization", tokenFor(regionalManager));

    expect(mockWriteAuditLog).toHaveBeenCalledTimes(1);
    expect(mockWriteAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "qa_bundle_read",
        actorId: regionalManager.id,
        actorRole: regionalManager.role,
        resourceType: "qa_bundle",
        details: { artifact: "png", bundle: STEM },
      })
    );
  });
});

describe("GET /api/qa/bundles/:stem/sidecar — streaming proxy", () => {
  it("returns 200 + application/json + sidecar bytes", async () => {
    mockAuthQuery(regionalManager);
    const sidecar = { url: "https://example/page", viewport: { width: 1280 } };
    const bytes = Buffer.from(JSON.stringify(sidecar));
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "application/json" }),
      arrayBuffer: async () =>
        bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    } as unknown as Response);
    mockWriteAuditLog.mockResolvedValueOnce(undefined);

    const res = await request(app)
      .get(`/api/qa/bundles/${STEM}/sidecar`)
      .set("Authorization", tokenFor(regionalManager));

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/application\/json/);
    expect(JSON.parse(res.text)).toEqual(sidecar);

    const [url] = mockFetch.mock.calls[0];
    expect(String(url)).toMatch(/frank-home-20260522-143000\.json$/);

    expect(mockWriteAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "qa_bundle_read",
        details: { artifact: "sidecar", bundle: STEM },
      })
    );
  });

  it("returns 401 without a token", async () => {
    const res = await request(app).get(`/api/qa/bundles/${STEM}/sidecar`);
    expect(res.status).toBe(401);
  });
});

describe("GET /api/qa/bundles/:stem/replay — streaming proxy", () => {
  it("returns 200 + JSON events with action=qa_bundle_read details.artifact=replay", async () => {
    mockAuthQuery(regionalManager);
    const events = [{ type: 0 }, { type: 4 }];
    const bytes = Buffer.from(JSON.stringify(events));
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "application/json" }),
      arrayBuffer: async () =>
        bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    } as unknown as Response);
    mockWriteAuditLog.mockResolvedValueOnce(undefined);

    const res = await request(app)
      .get(`/api/qa/bundles/${STEM}/replay`)
      .set("Authorization", tokenFor(regionalManager));

    expect(res.status).toBe(200);
    expect(JSON.parse(res.text)).toEqual(events);

    const [url] = mockFetch.mock.calls[0];
    expect(String(url)).toMatch(/frank-home-20260522-143000\.replay\.json$/);

    expect(mockWriteAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "qa_bundle_read",
        details: { artifact: "replay", bundle: STEM },
      })
    );
  });

  it("returns 503 when SUPABASE env is not configured", async () => {
    unsetStorageEnv();
    mockAuthQuery(regionalManager);
    const res = await request(app)
      .get(`/api/qa/bundles/${STEM}/replay`)
      .set("Authorization", tokenFor(regionalManager));
    expect(res.status).toBe(503);
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockWriteAuditLog).not.toHaveBeenCalled();
  });
});
