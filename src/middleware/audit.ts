import { Request, Response, NextFunction } from "express";
import { query } from "../config/database";
import { AuthRequest } from "./auth";
import { sanitizeObject } from "../utils/pii-filter";
import { logger } from "../utils/logger";

export interface AuditEntry {
  action: string;
  actorId?: string;
  actorRole?: string;
  applicationId?: string;
  resourceType?: string;
  resourceId?: string;
  details?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Write an immutable audit log entry.
 * All details are PII-filtered before storage.
 */
export async function writeAuditLog(entry: AuditEntry): Promise<void> {
  const sanitizedDetails = entry.details ? sanitizeObject(entry.details) : {};

  try {
    await query(
      `INSERT INTO audit_log (action, actor_id, actor_role, application_id, resource_type, resource_id, details, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        entry.action,
        entry.actorId || null,
        entry.actorRole || null,
        entry.applicationId || null,
        entry.resourceType || null,
        entry.resourceId || null,
        JSON.stringify(sanitizedDetails),
        entry.ipAddress || null,
        entry.userAgent || null,
      ]
    );
  } catch (err) {
    // Audit failures must not silently pass — log and re-throw
    logger.error("Failed to write audit log", {
      error: (err as Error).message,
      action: entry.action,
    });
    throw err;
  }
}

/**
 * Express middleware to auto-audit all mutating requests.
 */
export function auditMiddleware(action: string, resourceType?: string) {
  return async (req: AuthRequest, _res: Response, next: NextFunction): Promise<void> => {
    // Attach audit writer to request for later use
    (req as any).audit = async (details: Record<string, unknown>, applicationId?: string) => {
      await writeAuditLog({
        action,
        actorId: req.user?.id,
        actorRole: req.user?.role,
        applicationId: applicationId || (req.params.applicationId as string),
        resourceType: resourceType || req.baseUrl.split("/").pop(),
        resourceId: req.params.id as string | undefined,
        details,
        ipAddress: (req.ip || req.socket.remoteAddress) as string | undefined,
        userAgent: req.headers["user-agent"] as string | undefined,
      });
    };
    next();
  };
}

/**
 * Query audit log with filters.
 */
export async function queryAuditLog(filters: {
  applicationId?: string;
  actorId?: string;
  action?: string;
  startDate?: Date;
  endDate?: Date;
  limit?: number;
  offset?: number;
}) {
  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  if (filters.applicationId) {
    conditions.push(`application_id = $${paramIndex++}`);
    params.push(filters.applicationId);
  }
  if (filters.actorId) {
    conditions.push(`actor_id = $${paramIndex++}`);
    params.push(filters.actorId);
  }
  if (filters.action) {
    conditions.push(`action = $${paramIndex++}`);
    params.push(filters.action);
  }
  if (filters.startDate) {
    conditions.push(`created_at >= $${paramIndex++}`);
    params.push(filters.startDate);
  }
  if (filters.endDate) {
    conditions.push(`created_at <= $${paramIndex++}`);
    params.push(filters.endDate);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = filters.limit || 100;
  const offset = filters.offset || 0;

  const result = await query(
    `SELECT * FROM audit_log ${where} ORDER BY created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`,
    [...params, limit, offset]
  );

  return result.rows;
}
