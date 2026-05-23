import bcrypt from "bcrypt";
import { query } from "../../config/database";
import { writeAuditLog } from "../../middleware/audit";
import { logger } from "../../utils/logger";

const VALID_ROLES = [
  "leasing_agent",
  "senior_manager",
  "regional_manager",
  "asset_manager",
  "system_admin",
] as const;

export type UserRole = (typeof VALID_ROLES)[number];

export interface UserRecord {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  propertyIds: string[];
  isActive: boolean;
  lastLogin: Date | null;
  createdAt: Date;
}

export interface CreateUserInput {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  propertyIds?: string[];
}

export class UserService {
  /**
   * List all users, optionally filtered by role and/or active status.
   */
  async list(filters: { role?: string; isActive?: boolean } = {}): Promise<UserRecord[]> {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filters.role !== undefined) {
      params.push(filters.role);
      conditions.push(`role = $${params.length}`);
    }

    if (filters.isActive !== undefined) {
      params.push(filters.isActive);
      conditions.push(`is_active = $${params.length}`);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const result = await query(
      `SELECT id, email, first_name, last_name, role, property_ids,
              is_active, last_login, created_at
       FROM users ${where}
       ORDER BY role, last_name, first_name`,
      params
    );

    return result.rows.map(this.rowToRecord);
  }

  /**
   * Get a single user by ID. Returns null if not found.
   */
  async getById(userId: string): Promise<UserRecord | null> {
    const result = await query(
      `SELECT id, email, first_name, last_name, role, property_ids,
              is_active, last_login, created_at
       FROM users WHERE id = $1`,
      [userId]
    );

    if (result.rows.length === 0) return null;
    return this.rowToRecord(result.rows[0]);
  }

  /**
   * Create a new staff user. Password is bcrypt-hashed before storage.
   * PCI-DSS: plaintext password is never written to DB or logs.
   *
   * Throws if email is already in use.
   */
  async create(
    input: CreateUserInput,
    actorId: string,
    actorRole: string
  ): Promise<UserRecord> {
    if (!VALID_ROLES.includes(input.role)) {
      throw new Error(
        `Invalid role: ${input.role}. Must be one of: ${VALID_ROLES.join(", ")}`
      );
    }

    const passwordHash = await bcrypt.hash(input.password, 10);

    const result = await query(
      `INSERT INTO users (email, password_hash, first_name, last_name, role, property_ids)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, email, first_name, last_name, role, property_ids,
                 is_active, last_login, created_at`,
      [
        input.email,
        passwordHash,
        input.firstName,
        input.lastName,
        input.role,
        input.propertyIds || [],
      ]
    );

    const created = this.rowToRecord(result.rows[0]);

    await writeAuditLog({
      action: "permission_change",
      actorId,
      actorRole,
      resourceType: "user",
      resourceId: created.id,
      details: {
        action: "user_created",
        email: created.email,
        role: created.role,
      },
    });

    logger.info("User created", { userId: created.id, email: created.email, role: created.role });

    return created;
  }

  /**
   * Activate or deactivate a user account.
   * Deactivated users cannot login (authenticate() checks is_active).
   *
   * Throws if user not found.
   */
  async setActive(
    userId: string,
    isActive: boolean,
    actorId: string,
    actorRole: string
  ): Promise<UserRecord> {
    const result = await query(
      `UPDATE users SET is_active = $2
       WHERE id = $1
       RETURNING id, email, first_name, last_name, role, property_ids,
                 is_active, last_login, created_at`,
      [userId, isActive]
    );

    if (result.rows.length === 0) {
      throw new Error(`User not found: ${userId}`);
    }

    const updated = this.rowToRecord(result.rows[0]);

    await writeAuditLog({
      action: "permission_change",
      actorId,
      actorRole,
      resourceType: "user",
      resourceId: userId,
      details: {
        action: isActive ? "user_activated" : "user_deactivated",
        targetEmail: updated.email,
        targetRole: updated.role,
      },
    });

    logger.info(isActive ? "User activated" : "User deactivated", {
      userId,
      email: updated.email,
    });

    return updated;
  }

  /**
   * Reset a user's password. Old password is NOT required (admin operation).
   * PCI-DSS: plaintext password is never logged.
   *
   * Throws if user not found.
   */
  async resetPassword(
    userId: string,
    newPassword: string,
    actorId: string,
    actorRole: string
  ): Promise<void> {
    const passwordHash = await bcrypt.hash(newPassword, 10);

    const result = await query(
      "UPDATE users SET password_hash = $2 WHERE id = $1 RETURNING id, email",
      [userId, passwordHash]
    );

    if (result.rows.length === 0) {
      throw new Error(`User not found: ${userId}`);
    }

    await writeAuditLog({
      action: "permission_change",
      actorId,
      actorRole,
      resourceType: "user",
      resourceId: userId,
      details: {
        action: "password_reset",
        targetEmail: result.rows[0].email,
      },
    });

    logger.info("Password reset", { userId, actorId });
  }

  /**
   * Top-of-funnel signup counts from the tenant onboarding app.
   * `registered` = everyone who entered via the funnel (applicant or tenant
   * role); `verified` = the subset who have proven their email
   * (email_verified_at stamped). Staff roles are excluded by the role filter.
   * Demo/usability-test accounts (demo_run_id set) are excluded so a testing
   * round never inflates the real signup metric.
   */
  async signupStats(): Promise<{ registered: number; verified: number }> {
    const result = await query(
      `SELECT
         COUNT(*)::int AS registered,
         COUNT(*) FILTER (WHERE email_verified_at IS NOT NULL)::int AS verified
       FROM users
       WHERE role IN ('applicant', 'tenant')
         AND demo_run_id IS NULL`
    );
    const row = result.rows[0];
    return { registered: row?.registered ?? 0, verified: row?.verified ?? 0 };
  }

  private rowToRecord(row: any): UserRecord {
    return {
      id: row.id,
      email: row.email,
      firstName: row.first_name,
      lastName: row.last_name,
      role: row.role,
      propertyIds: row.property_ids || [],
      isActive: row.is_active,
      lastLogin: row.last_login || null,
      createdAt: row.created_at,
    };
  }
}
