import { Response, NextFunction } from "express";
import { query } from "../config/database";
import { AuthRequest } from "./auth";

export interface ScopedAuthRequest extends AuthRequest {
  scopedApplicationIds?: string[];
}

/**
 * Resolve the application ids accessible to an applicant/tenant user.
 *
 * Staff roles get an empty array — they go through the regular RBAC layer
 * (which scopes by property_ids), not this user_applications join.
 */
export async function getUserApplicationIds(userId: string): Promise<string[]> {
  const result = await query(
    "SELECT application_id FROM user_applications WHERE user_id = $1",
    [userId]
  );
  return result.rows.map((r: { application_id: string }) => r.application_id);
}

/**
 * Middleware: limits the request to the authenticated user's applications.
 *
 * Stamps req.scopedApplicationIds with the result. Only applies to
 * applicant/tenant roles — staff fall through untouched.
 */
export async function scopeToOwnApplications(
  req: ScopedAuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  if (!req.user) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  if (!["applicant", "tenant"].includes(req.user.role)) {
    next();
    return;
  }
  req.scopedApplicationIds = await getUserApplicationIds(req.user.id);
  next();
}

/**
 * Middleware: blocks applicants/tenants whose email hasn't been proven.
 * Staff roles bypass — they authenticate by password (already a proof of
 * account control). Returns 401 if unauthenticated, 403 with a stable
 * `code: "EMAIL_UNVERIFIED"` if the user exists but hasn't verified.
 *
 * The truth for "verified" is `req.user.emailVerified`, which is sourced
 * from `users.email_verified_at` in the DB by authenticate() — a stolen
 * pre-verification token never gains verification status on re-issue.
 */
export function requireEmailVerified(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): void {
  if (!req.user) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  // Staff bypass — non-applicant non-tenant roles authenticate via password,
  // which is itself proof of account control.
  if (!["applicant", "tenant"].includes(req.user.role)) {
    next();
    return;
  }
  if (!req.user.emailVerified) {
    res.status(403).json({
      error: "Email verification required",
      code: "EMAIL_UNVERIFIED",
    });
    return;
  }
  next();
}

/**
 * Middleware: requires applicant or tenant role. Use on portal-only routes.
 */
export function requireTenantRole(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): void {
  if (!req.user) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  if (!["applicant", "tenant"].includes(req.user.role)) {
    res.status(403).json({ error: "Tenant or applicant role required" });
    return;
  }
  next();
}

/**
 * Throws 403 if the given application is not linked to the authenticated user.
 * Returns true on success so callers can `if (!(await assert...)) return;`.
 */
export async function assertApplicationOwnership(
  req: AuthRequest,
  res: Response,
  applicationId: string
): Promise<boolean> {
  if (!req.user) {
    res.status(401).json({ error: "Authentication required" });
    return false;
  }
  // Staff bypass — handled elsewhere by RBAC.
  if (!["applicant", "tenant"].includes(req.user.role)) return true;

  const result = await query(
    "SELECT 1 FROM user_applications WHERE user_id = $1 AND application_id = $2 LIMIT 1",
    [req.user.id, applicationId]
  );
  if (result.rows.length === 0) {
    res.status(403).json({ error: "Application not accessible" });
    return false;
  }
  return true;
}
