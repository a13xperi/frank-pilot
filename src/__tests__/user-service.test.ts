/**
 * Tests for src/modules/users/service.ts
 *
 * Coverage focus:
 *   - list() and getById() lookup behavior with optional filters
 *   - create() validates and assigns roles while hashing passwords
 *   - administrative updates via setActive() and resetPassword()
 */

import { UserService } from "../modules/users/service";

jest.mock("../config/database", () => ({
  query: jest.fn(),
  transaction: jest.fn(),
}));

jest.mock("../middleware/audit", () => ({
  writeAuditLog: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.mock("bcrypt", () => ({
  __esModule: true,
  default: {
    hash: jest.fn().mockResolvedValue("$2b$10$hashedpassword"),
    compare: jest.fn(),
  },
}));

import bcrypt from "bcrypt";
import { query } from "../config/database";
import { writeAuditLog } from "../middleware/audit";

const mockBcryptHash = bcrypt.hash as jest.MockedFunction<typeof bcrypt.hash>;
const mockQuery = query as jest.MockedFunction<typeof query>;
const mockWriteAuditLog = writeAuditLog as jest.MockedFunction<typeof writeAuditLog>;

const ACTOR_ID = "user-admin-001";
const ACTOR_ROLE = "system_admin";
const USER_ID = "user-target-001";

function makeUserRow(
  overrides: Partial<Record<string, unknown>> = {}
): Record<string, unknown> {
  return {
    id: USER_ID,
    email: "target@example.com",
    first_name: "Alice",
    last_name: "Target",
    role: "leasing_agent",
    property_ids: ["prop-001"],
    is_active: true,
    last_login: null,
    created_at: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

describe("UserService", () => {
  let service: UserService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new UserService();
  });

  describe("list", () => {
    it("returns all users when no filters are provided", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [makeUserRow()],
      } as any);

      const result = await service.list();

      expect(result).toEqual([
        expect.objectContaining({
          id: USER_ID,
          email: "target@example.com",
          firstName: "Alice",
          propertyIds: ["prop-001"],
          lastLogin: null,
        }),
      ]);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("ORDER BY role, last_name, first_name"),
        []
      );
    });

    it("applies role and active filters together", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] } as any);

      await service.list({ role: "senior_manager", isActive: false });

      const sql = mockQuery.mock.calls[0]?.[0] as string;
      const params = mockQuery.mock.calls[0]?.[1] as unknown[];

      expect(sql).toMatch(/WHERE role = \$1 AND is_active = \$2/);
      expect(params).toEqual(["senior_manager", false]);
    });

    it("maps a missing property_ids column to an empty array", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [makeUserRow({ property_ids: null })],
      } as any);

      const result = await service.list();

      expect(result[0]?.propertyIds).toEqual([]);
    });
  });

  describe("getById", () => {
    it("returns null when the user does not exist", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] } as any);

      await expect(service.getById("missing-user")).resolves.toBeNull();
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("WHERE id = $1"),
        ["missing-user"]
      );
    });

    it("returns the mapped user when found", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [makeUserRow({ last_login: new Date("2026-02-01T10:00:00.000Z") })],
      } as any);

      const result = await service.getById(USER_ID);

      expect(result).toEqual(
        expect.objectContaining({
          id: USER_ID,
          lastName: "Target",
          role: "leasing_agent",
          isActive: true,
        })
      );
      expect(result?.lastLogin).toEqual(new Date("2026-02-01T10:00:00.000Z"));
    });
  });

  describe("create", () => {
    it("throws for an invalid role before hashing or writing", async () => {
      await expect(
        service.create(
          {
            email: "invalid@example.com",
            password: "password123",
            firstName: "Invalid",
            lastName: "Role",
            role: "invalid_role" as any,
          },
          ACTOR_ID,
          ACTOR_ROLE
        )
      ).rejects.toThrow(/invalid role/i);

      expect(mockBcryptHash).not.toHaveBeenCalled();
      expect(mockQuery).not.toHaveBeenCalled();
      expect(mockWriteAuditLog).not.toHaveBeenCalled();
    });

    it("hashes the password, persists the assigned role, and returns the created user", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [makeUserRow({ role: "regional_manager", property_ids: ["prop-001", "prop-002"] })],
      } as any);

      const result = await service.create(
        {
          email: "new@example.com",
          password: "plaintext-password",
          firstName: "New",
          lastName: "User",
          role: "regional_manager",
          propertyIds: ["prop-001", "prop-002"],
        },
        ACTOR_ID,
        ACTOR_ROLE
      );

      expect(mockBcryptHash).toHaveBeenCalledWith("plaintext-password", 10);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO users"),
        [
          "new@example.com",
          "$2b$10$hashedpassword",
          "New",
          "User",
          "regional_manager",
          ["prop-001", "prop-002"],
        ]
      );
      expect(result).toEqual(
        expect.objectContaining({
          id: USER_ID,
          role: "regional_manager",
          propertyIds: ["prop-001", "prop-002"],
        })
      );
      expect(mockWriteAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "permission_change",
          actorId: ACTOR_ID,
          actorRole: ACTOR_ROLE,
          resourceType: "user",
          resourceId: USER_ID,
          details: expect.objectContaining({
            action: "user_created",
            role: "regional_manager",
          }),
        })
      );
    });

    it("defaults propertyIds to an empty array when omitted", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [makeUserRow({ property_ids: null })],
      } as any);

      const result = await service.create(
        {
          email: "new@example.com",
          password: "password123",
          firstName: "No",
          lastName: "Assignments",
          role: "leasing_agent",
        },
        ACTOR_ID,
        ACTOR_ROLE
      );

      expect(mockQuery.mock.calls[0]?.[1]?.[5]).toEqual([]);
      expect(result.propertyIds).toEqual([]);
    });
  });

  describe("setActive", () => {
    it("throws when the target user does not exist", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] } as any);

      await expect(
        service.setActive(USER_ID, false, ACTOR_ID, ACTOR_ROLE)
      ).rejects.toThrow(`User not found: ${USER_ID}`);
    });

    it("updates the active flag and writes a deactivation audit log", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [makeUserRow({ is_active: false })],
      } as any);

      const result = await service.setActive(
        USER_ID,
        false,
        ACTOR_ID,
        ACTOR_ROLE
      );

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE users SET is_active = $2"),
        [USER_ID, false]
      );
      expect(result.isActive).toBe(false);
      expect(mockWriteAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "permission_change",
          resourceId: USER_ID,
          details: expect.objectContaining({ action: "user_deactivated" }),
        })
      );
    });

    it("writes an activation audit log when re-enabling a user", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [makeUserRow({ is_active: true })],
      } as any);

      await service.setActive(USER_ID, true, ACTOR_ID, ACTOR_ROLE);

      expect(mockWriteAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          details: expect.objectContaining({ action: "user_activated" }),
        })
      );
    });
  });

  describe("resetPassword", () => {
    it("throws when the target user does not exist", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] } as any);

      await expect(
        service.resetPassword(USER_ID, "new-password-123", ACTOR_ID, ACTOR_ROLE)
      ).rejects.toThrow(`User not found: ${USER_ID}`);
    });

    it("hashes the new password, never stores plaintext, and writes an audit log", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: USER_ID, email: "target@example.com" }],
      } as any);

      const result = await service.resetPassword(
        USER_ID,
        "new-password-123",
        ACTOR_ID,
        ACTOR_ROLE
      );

      expect(mockBcryptHash).toHaveBeenCalledWith("new-password-123", 10);
      expect(mockQuery).toHaveBeenCalledWith(
        "UPDATE users SET password_hash = $2 WHERE id = $1 RETURNING id, email",
        [USER_ID, "$2b$10$hashedpassword"]
      );
      expect(mockWriteAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "permission_change",
          actorId: ACTOR_ID,
          actorRole: ACTOR_ROLE,
          resourceType: "user",
          resourceId: USER_ID,
          details: expect.objectContaining({ action: "password_reset" }),
        })
      );
      expect(result).toBeUndefined();
    });
  });
});
