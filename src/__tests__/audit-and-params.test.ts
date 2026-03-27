/**
 * Tests for:
 *   src/middleware/audit.ts  — writeAuditLog, auditMiddleware, queryAuditLog
 *   src/utils/params.ts      — param()
 *
 * audit.ts compliance notes:
 *   - writeAuditLog PII-sanitizes details via sanitizeObject before DB write
 *   - Audit failures re-throw (never silently swallowed) — every service depends on this
 *   - auditMiddleware attaches req.audit() for deferred writes within request handlers
 *   - queryAuditLog supports all filter combinations with safe param indexing
 */

import { writeAuditLog, auditMiddleware, queryAuditLog, AuditEntry } from "../middleware/audit";
import { param } from "../utils/params";
import { query } from "../config/database";
import { sanitizeObject } from "../utils/pii-filter";

// ── Mocks ──────────────────────────────────────────────────────────────────

jest.mock("../config/database", () => ({ query: jest.fn() }));

jest.mock("../utils/pii-filter", () => ({
  // Pass-through by default; individual tests can override
  sanitizeObject: jest.fn((obj: Record<string, unknown>) => obj),
  filterPII: jest.fn((v: string) => v),
}));

jest.mock("../utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const mockQuery = query as jest.MockedFunction<typeof query>;
const mockSanitizeObject = sanitizeObject as jest.MockedFunction<typeof sanitizeObject>;

// ── writeAuditLog() ────────────────────────────────────────────────────────

describe("writeAuditLog()", () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockSanitizeObject.mockImplementation((obj) => obj);
  });

  it("inserts a row into audit_log with all provided fields", async () => {
    mockQuery.mockResolvedValue({ rows: [] } as any);

    const entry: AuditEntry = {
      action: "application_created",
      actorId: "user-001",
      actorRole: "leasing_agent",
      applicationId: "app-001",
      resourceType: "application",
      resourceId: "app-001",
      details: { propertyId: "prop-001" },
      ipAddress: "10.0.0.1",
      userAgent: "Mozilla/5.0",
    };

    await writeAuditLog(entry);

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO audit_log"),
      [
        "application_created",
        "user-001",
        "leasing_agent",
        "app-001",
        "application",
        "app-001",
        expect.any(String), // JSON.stringify(sanitizedDetails)
        "10.0.0.1",
        "Mozilla/5.0",
      ]
    );
  });

  it("PII-sanitizes details before writing to the database", async () => {
    mockQuery.mockResolvedValue({ rows: [] } as any);
    mockSanitizeObject.mockReturnValue({ propertyId: "prop-001" }); // SSN stripped

    await writeAuditLog({
      action: "application_created",
      details: { propertyId: "prop-001", ssn: "123-45-6789" },
    });

    expect(mockSanitizeObject).toHaveBeenCalledWith(
      expect.objectContaining({ ssn: "123-45-6789" })
    );
    // The stored details should be the sanitized version
    const storedDetails = JSON.parse((mockQuery.mock.calls[0]![1]! as unknown[])[6] as string);
    expect(storedDetails).not.toHaveProperty("ssn");
    expect(storedDetails).toHaveProperty("propertyId");
  });

  it("uses null for optional fields when not provided", async () => {
    mockQuery.mockResolvedValue({ rows: [] } as any);

    await writeAuditLog({ action: "test_action" });

    const params = mockQuery.mock.calls[0][1] as unknown[];
    expect(params[1]).toBeNull(); // actorId
    expect(params[2]).toBeNull(); // actorRole
    expect(params[3]).toBeNull(); // applicationId
    expect(params[4]).toBeNull(); // resourceType
    expect(params[5]).toBeNull(); // resourceId
    expect(params[7]).toBeNull(); // ipAddress
    expect(params[8]).toBeNull(); // userAgent
  });

  it("stores empty sanitized object when details is not provided", async () => {
    mockQuery.mockResolvedValue({ rows: [] } as any);

    await writeAuditLog({ action: "system_event" });

    const storedDetails = JSON.parse((mockQuery.mock.calls[0]![1]! as unknown[])[6] as string);
    expect(storedDetails).toEqual({});
  });

  it("stores details as JSON string", async () => {
    mockQuery.mockResolvedValue({ rows: [] } as any);

    await writeAuditLog({
      action: "screening_completed",
      details: { result: "pass", checks: ["bg", "credit"] },
    });

    const detailsParam = (mockQuery.mock.calls[0]![1]! as unknown[])[6];
    expect(typeof detailsParam).toBe("string");
    const parsed = JSON.parse(detailsParam as string);
    expect(parsed.result).toBe("pass");
    expect(parsed.checks).toEqual(["bg", "credit"]);
  });

  it("re-throws when the DB query fails (audit failures must not be silently swallowed)", async () => {
    mockQuery.mockRejectedValue(new Error("DB connection lost"));

    await expect(
      writeAuditLog({ action: "application_submitted", actorId: "user-001" })
    ).rejects.toThrow("DB connection lost");
  });

  it("logs an error before re-throwing on DB failure", async () => {
    const { logger } = require("../utils/logger");
    mockQuery.mockRejectedValue(new Error("Disk full"));

    try {
      await writeAuditLog({ action: "payment_setup" });
    } catch {
      // expected
    }

    expect(logger.error).toHaveBeenCalledWith(
      "Failed to write audit log",
      expect.objectContaining({ error: "Disk full", action: "payment_setup" })
    );
  });
});

// ── auditMiddleware() ──────────────────────────────────────────────────────

describe("auditMiddleware()", () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockSanitizeObject.mockImplementation((obj) => obj);
  });

  function buildMockRequest(overrides: Record<string, unknown> = {}) {
    return {
      user: { id: "user-001", role: "senior_manager" },
      params: { applicationId: "app-001", id: "res-001" },
      baseUrl: "/api/applications",
      ip: "192.168.1.1",
      socket: { remoteAddress: "192.168.1.1" },
      headers: { "user-agent": "TestAgent/1.0" },
      ...overrides,
    } as any;
  }

  it("calls next() synchronously when invoked", async () => {
    const middleware = auditMiddleware("application_created");
    const req = buildMockRequest();
    const next = jest.fn();

    await middleware(req, {} as any, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it("attaches req.audit function to the request object", async () => {
    const middleware = auditMiddleware("application_created");
    const req = buildMockRequest();
    const next = jest.fn();

    await middleware(req, {} as any, next);

    expect(typeof req.audit).toBe("function");
  });

  it("req.audit() writes audit log with actor info from req.user", async () => {
    mockQuery.mockResolvedValue({ rows: [] } as any);

    const middleware = auditMiddleware("application_submitted", "application");
    const req = buildMockRequest();

    await middleware(req, {} as any, jest.fn());
    await req.audit({ status: "submitted" });

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO audit_log"),
      expect.arrayContaining([
        "application_submitted",
        "user-001",
        "senior_manager",
      ])
    );
  });

  it("req.audit() uses applicationId from params when not passed explicitly", async () => {
    mockQuery.mockResolvedValue({ rows: [] } as any);

    const middleware = auditMiddleware("document_viewed");
    const req = buildMockRequest({ params: { applicationId: "app-param-001" } });

    await middleware(req, {} as any, jest.fn());
    await req.audit({ documentType: "lease" });

    const params = mockQuery.mock.calls[0][1] as unknown[];
    expect(params[3]).toBe("app-param-001"); // applicationId
  });

  it("req.audit() uses explicitly passed applicationId over params", async () => {
    mockQuery.mockResolvedValue({ rows: [] } as any);

    const middleware = auditMiddleware("document_viewed");
    const req = buildMockRequest({ params: { applicationId: "app-from-params" } });

    await middleware(req, {} as any, jest.fn());
    await req.audit({ type: "lease" }, "app-explicit-001"); // explicit overrides

    const params = mockQuery.mock.calls[0][1] as unknown[];
    expect(params[3]).toBe("app-explicit-001");
  });

  it("req.audit() includes IP address and user-agent in audit entry", async () => {
    mockQuery.mockResolvedValue({ rows: [] } as any);

    const middleware = auditMiddleware("login");
    const req = buildMockRequest({
      ip: "10.10.10.10",
      headers: { "user-agent": "Chrome/120" },
    });

    await middleware(req, {} as any, jest.fn());
    await req.audit({});

    const params = mockQuery.mock.calls[0][1] as unknown[];
    expect(params[7]).toBe("10.10.10.10");  // ipAddress
    expect(params[8]).toBe("Chrome/120");    // userAgent
  });
});

// ── queryAuditLog() ────────────────────────────────────────────────────────

describe("queryAuditLog()", () => {
  beforeEach(() => mockQuery.mockReset());

  it("returns rows from the audit log query", async () => {
    mockQuery.mockResolvedValue({
      rows: [
        { id: "log-001", action: "application_created" },
        { id: "log-002", action: "application_submitted" },
      ],
    } as any);

    const result = await queryAuditLog({});

    expect(result).toHaveLength(2);
    expect(result[0].action).toBe("application_created");
  });

  it("queries without WHERE clause when no filters provided", async () => {
    mockQuery.mockResolvedValue({ rows: [] } as any);

    await queryAuditLog({});

    const sql = mockQuery.mock.calls[0][0] as string;
    expect(sql).not.toContain("WHERE");
  });

  it("applies applicationId filter", async () => {
    mockQuery.mockResolvedValue({ rows: [] } as any);

    await queryAuditLog({ applicationId: "app-001" });

    const sql = mockQuery.mock.calls[0][0] as string;
    const params = mockQuery.mock.calls[0][1] as unknown[];
    expect(sql).toContain("application_id = $1");
    expect(params).toContain("app-001");
  });

  it("applies actorId filter", async () => {
    mockQuery.mockResolvedValue({ rows: [] } as any);

    await queryAuditLog({ actorId: "user-001" });

    const sql = mockQuery.mock.calls[0][0] as string;
    expect(sql).toContain("actor_id = $");
    expect(mockQuery.mock.calls[0][1]).toContain("user-001");
  });

  it("applies action filter", async () => {
    mockQuery.mockResolvedValue({ rows: [] } as any);

    await queryAuditLog({ action: "screening_completed" });

    const sql = mockQuery.mock.calls[0][0] as string;
    expect(sql).toContain("action = $");
    expect(mockQuery.mock.calls[0][1]).toContain("screening_completed");
  });

  it("applies startDate and endDate filters", async () => {
    mockQuery.mockResolvedValue({ rows: [] } as any);

    const start = new Date("2026-01-01");
    const end = new Date("2026-03-31");

    await queryAuditLog({ startDate: start, endDate: end });

    const sql = mockQuery.mock.calls[0][0] as string;
    expect(sql).toContain("created_at >=");
    expect(sql).toContain("created_at <=");
    expect(mockQuery.mock.calls[0][1]).toContain(start);
    expect(mockQuery.mock.calls[0][1]).toContain(end);
  });

  it("uses default limit=100 and offset=0 when not provided", async () => {
    mockQuery.mockResolvedValue({ rows: [] } as any);

    await queryAuditLog({});

    const params = mockQuery.mock.calls[0][1] as unknown[];
    expect(params).toContain(100);
    expect(params).toContain(0);
  });

  it("respects custom limit and offset", async () => {
    mockQuery.mockResolvedValue({ rows: [] } as any);

    await queryAuditLog({ limit: 25, offset: 50 });

    const params = mockQuery.mock.calls[0][1] as unknown[];
    expect(params).toContain(25);
    expect(params).toContain(50);
  });

  it("combines multiple filters correctly", async () => {
    mockQuery.mockResolvedValue({ rows: [] } as any);

    await queryAuditLog({
      applicationId: "app-001",
      actorId: "user-001",
      action: "approval_completed",
    });

    const sql = mockQuery.mock.calls[0][0] as string;
    expect(sql).toContain("application_id = $1");
    expect(sql).toContain("actor_id = $2");
    expect(sql).toContain("action = $3");
    // Limit/offset should use $4/$5 — no param index collision
    expect(sql).toContain("LIMIT $4");
    expect(sql).toContain("OFFSET $5");
  });

  it("orders results by created_at DESC", async () => {
    mockQuery.mockResolvedValue({ rows: [] } as any);

    await queryAuditLog({});

    const sql = mockQuery.mock.calls[0][0] as string;
    expect(sql).toContain("ORDER BY created_at DESC");
  });
});

// ── param() ────────────────────────────────────────────────────────────────

describe("param()", () => {
  it("returns the string value when passed a plain string", () => {
    expect(param("app-001")).toBe("app-001");
  });

  it("returns the first element when passed an array", () => {
    expect(param(["app-001", "app-002"])).toBe("app-001");
  });

  it("returns empty string when passed undefined", () => {
    expect(param(undefined)).toBe("");
  });

  it("returns empty string when passed an empty string", () => {
    expect(param("")).toBe("");
  });

  it("returns the single element when array has one item", () => {
    expect(param(["only-one"])).toBe("only-one");
  });
});
