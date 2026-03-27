/**
 * Tests for src/modules/users/service.ts
 *
 * Key invariants:
 *   - Plaintext password is never logged or stored (bcrypt hash only)
 *   - Invalid role → throws before any DB write
 *   - User not found → throws for setActive and resetPassword
 *   - Audit log written for all mutating operations
 *   - list() filters by role and isActive correctly
 */

import { UserService } from "../modules/users/service";

// ── Mocks ─────────────────────────────────────────────────────────────────

jest.mock("../config/database", () => ({ query: jest.fn(), transaction: jest.fn() }));
jest.mock("../utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock("../middleware/audit", () => ({
  writeAuditLog: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("bcrypt", () => ({
  hash: jest.fn().mockResolvedValue("$2b$10$hashedpassword"),
  compare: jest.fn(),
}));

import { query } from "../config/database";
import { writeAuditLog } from "../middleware/audit";

const mockQuery = query as jest.MockedFunction<typeof query>;
const mockWriteAuditLog = writeAuditLog as jest.MockedFunction<typeof writeAuditLog>;
const bcrypt = require("bcrypt");

const ACTOR_ID = "user-admin-001";
const ACTOR_ROLE = "system_admin";
const USER_ID = "user-target-001";

const sampleRow = {
  id: USER_ID,
  email: "target@example.com",
  first_name: "Alice",
  last_name: "Target",
  role: "leasing_agent",
  property_ids: ["prop-001"],
  is_active: true,
  last_login: null,
  created_at: new Date("2026-01-01T00:00:00Z"),
};

// ── list() ─────────────────────────────────────────────────────────────────

describe("UserService.list()", () => {
  let service: UserService;
  beforeEach(() => { jest.clearAllMocks(); service = new UserService(); });

  it("returns all users when no filters provided", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [sampleRow] } as any);

    const result = await service.list();

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(USER_ID);
    expect(result[0].firstName).toBe("Alice");
    expect(result[0].propertyIds).toEqual(["prop-001"]);
  });

  it("applies role filter via WHERE clause", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as any);

    await service.list({ role: "senior_manager" });

    const call = mockQuery.mock.calls[0]!;
    expect(call[0]).toMatch(/WHERE/i);
    expect(call[0]).toMatch(/role = \$1/);
    expect(call[1]).toContain("senior_manager");
  });

  it("applies isActive filter via WHERE clause", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as any);

    await service.list({ isActive: false });

    const call = mockQuery.mock.calls[0]!;
    expect(call[0]).toMatch(/is_active = \$1/);
    expect(call[1]).toContain(false);
  });

  it("combines role and isActive filters with AND", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as any);

    await service.list({ role: "leasing_agent", isActive: true });

    const call = mockQuery.mock.calls[0]!;
    expect(call[0]).toMatch(/role = \$1/);
    expect(call[0]).toMatch(/is_active = \$2/);
  });

  it("maps null last_login to null in result", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ ...sampleRow, last_login: null }] } as any);

    const result = await service.list();
    expect(result[0].lastLogin).toBeNull();
  });
});

// ── getById() ─────────────────────────────────────────────────────────────

describe("UserService.getById()", () => {
  let service: UserService;
  beforeEach(() => { jest.clearAllMocks(); service = new UserService(); });

  it("returns null when user not found", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as any);
    const result = await service.getById("nonexistent");
    expect(result).toBeNull();
  });

  it("returns mapped user record when found", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [sampleRow] } as any);

    const result = await service.getById(USER_ID);

    expect(result).not.toBeNull();
    expect(result!.id).toBe(USER_ID);
    expect(result!.lastName).toBe("Target");
    expect(result!.isActive).toBe(true);
  });

  it("queries by user ID", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [sampleRow] } as any);
    await service.getById(USER_ID);

    expect(mockQuery.mock.calls[0]![1]).toEqual([USER_ID]);
  });
});

// ── create() ──────────────────────────────────────────────────────────────

describe("UserService.create()", () => {
  let service: UserService;
  beforeEach(() => { jest.clearAllMocks(); service = new UserService(); });

  it("throws for an invalid role", async () => {
    await expect(
      service.create(
        {
          email: "x@example.com",
          password: "password123",
          firstName: "X",
          lastName: "Y",
          role: "unknown_role" as any,
        },
        ACTOR_ID,
        ACTOR_ROLE
      )
    ).rejects.toThrow(/invalid role/i);

    // No DB write should occur
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("hashes the password before inserting — plaintext is never stored", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [sampleRow] } as any);

    await service.create(
      {
        email: "new@example.com",
        password: "plaintext-password",
        firstName: "New",
        lastName: "User",
        role: "leasing_agent",
      },
      ACTOR_ID,
      ACTOR_ROLE
    );

    expect(bcrypt.hash).toHaveBeenCalledWith("plaintext-password", 10);

    const insertCall = mockQuery.mock.calls[0]!;
    const params = insertCall[1] as any[];
    // index 1 = password_hash — should be the bcrypt output, not plaintext
    expect(params[1]).toBe("$2b$10$hashedpassword");
    expect(params).not.toContain("plaintext-password");
  });

  it("writes a permission_change audit log on creation", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [sampleRow] } as any);

    await service.create(
      {
        email: "new@example.com",
        password: "password123",
        firstName: "New",
        lastName: "User",
        role: "leasing_agent",
      },
      ACTOR_ID,
      ACTOR_ROLE
    );

    expect(mockWriteAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "permission_change",
        actorId: ACTOR_ID,
        actorRole: ACTOR_ROLE,
        details: expect.objectContaining({ action: "user_created" }),
      })
    );
  });

  it("returns the created user record", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [sampleRow] } as any);

    const result = await service.create(
      {
        email: "new@example.com",
        password: "password123",
        firstName: "New",
        lastName: "User",
        role: "leasing_agent",
      },
      ACTOR_ID,
      ACTOR_ROLE
    );

    expect(result.id).toBe(USER_ID);
    expect(result.email).toBe("target@example.com");
  });

  it("defaults propertyIds to empty array when not provided", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ ...sampleRow, property_ids: null }] } as any);

    const result = await service.create(
      {
        email: "new@example.com",
        password: "password123",
        firstName: "N",
        lastName: "U",
        role: "leasing_agent",
      },
      ACTOR_ID,
      ACTOR_ROLE
    );

    expect(result.propertyIds).toEqual([]);
  });
});

// ── setActive() ───────────────────────────────────────────────────────────

describe("UserService.setActive()", () => {
  let service: UserService;
  beforeEach(() => { jest.clearAllMocks(); service = new UserService(); });

  it("throws when user not found", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as any);

    await expect(
      service.setActive("nonexistent", false, ACTOR_ID, ACTOR_ROLE)
    ).rejects.toThrow(/user not found/i);
  });

  it("sets is_active=false on deactivate", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ ...sampleRow, is_active: false }] } as any);

    const result = await service.setActive(USER_ID, false, ACTOR_ID, ACTOR_ROLE);

    expect(result.isActive).toBe(false);
    const params = mockQuery.mock.calls[0]![1] as any[];
    expect(params).toContain(false);
  });

  it("sets is_active=true on activate", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [sampleRow] } as any);

    await service.setActive(USER_ID, true, ACTOR_ID, ACTOR_ROLE);

    const params = mockQuery.mock.calls[0]![1] as any[];
    expect(params).toContain(true);
  });

  it("writes user_deactivated audit log on deactivate", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [sampleRow] } as any);

    await service.setActive(USER_ID, false, ACTOR_ID, ACTOR_ROLE);

    expect(mockWriteAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "permission_change",
        details: expect.objectContaining({ action: "user_deactivated" }),
      })
    );
  });

  it("writes user_activated audit log on activate", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [sampleRow] } as any);

    await service.setActive(USER_ID, true, ACTOR_ID, ACTOR_ROLE);

    expect(mockWriteAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        details: expect.objectContaining({ action: "user_activated" }),
      })
    );
  });
});

// ── resetPassword() ───────────────────────────────────────────────────────

describe("UserService.resetPassword()", () => {
  let service: UserService;
  beforeEach(() => { jest.clearAllMocks(); service = new UserService(); });

  it("throws when user not found", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as any);

    await expect(
      service.resetPassword("nonexistent", "newpass123", ACTOR_ID, ACTOR_ROLE)
    ).rejects.toThrow(/user not found/i);
  });

  it("hashes the new password — plaintext is never stored", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: USER_ID, email: "target@example.com" }],
    } as any);

    await service.resetPassword(USER_ID, "plaintext-new-pw", ACTOR_ID, ACTOR_ROLE);

    expect(bcrypt.hash).toHaveBeenCalledWith("plaintext-new-pw", 10);

    const updateCall = mockQuery.mock.calls[0]!;
    const params = updateCall[1] as any[];
    expect(params[1]).toBe("$2b$10$hashedpassword");
    expect(params).not.toContain("plaintext-new-pw");
  });

  it("writes a password_reset audit log entry", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: USER_ID, email: "target@example.com" }],
    } as any);

    await service.resetPassword(USER_ID, "newpass123", ACTOR_ID, ACTOR_ROLE);

    expect(mockWriteAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "permission_change",
        actorId: ACTOR_ID,
        resourceId: USER_ID,
        details: expect.objectContaining({ action: "password_reset" }),
      })
    );
  });

  it("resolves without returning a value on success", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: USER_ID, email: "target@example.com" }],
    } as any);

    const result = await service.resetPassword(USER_ID, "newpass123", ACTOR_ID, ACTOR_ROLE);
    expect(result).toBeUndefined();
  });
});
