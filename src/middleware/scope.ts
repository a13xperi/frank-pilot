import { Response, NextFunction } from "express";
import { query } from "../config/database";
import { AuthRequest } from "./auth";

export interface ScopedAuthRequest extends AuthRequest {
  scopedApplicationIds?: string[];
}

/**
 * Staff roles that bypass per-property scoping. Asset managers, regional
 * managers, and system admins have organisation-wide visibility; everyone
 * else (e.g. leasing_agent, senior_manager) must be constrained to the
 * property_ids assigned on their user record.
 *
 * Compliance-officer-like roles do not exist in the current enum — the
 * highest organisation-wide staff role is `regional_manager` and above.
 */
export const GLOBAL_PROPERTY_SCOPE_ROLES = new Set<string>([
  "system_admin",
  "asset_manager",
  "regional_manager",
]);

export interface PropertyScopeResult {
  /**
   * SQL fragment to AND into a query. Empty string means: no filter to apply
   * (caller is a global-scope role). Includes the `$N` parameter placeholder.
   */
  sql: string;
  /**
   * Parameter value to push. Null means: no parameter to add (global scope).
   */
  param: string[] | null;
  /**
   * Forces an empty result set. True when a scoped role has no property_ids
   * assigned. The caller MUST short-circuit and return an empty result.
   */
  denyAll: boolean;
}

/**
 * Build a property-scoping SQL fragment for the given request. The caller
 * passes the SQL column reference to filter on (e.g. `a.property_id`,
 * `w.property_id`, `p.id`) and the index of the next bind parameter — the
 * helper returns the fragment to AND in, plus the param to push.
 *
 *   const scope = buildPropertyScope(req, params.length + 1, "a.property_id");
 *   if (scope.denyAll) return { entries: [], total: 0 };
 *   if (scope.sql) { conditions.push(scope.sql); params.push(scope.param); }
 *
 * Global-scope roles (system_admin, asset_manager, regional_manager) get
 * `{ sql: "", param: null, denyAll: false }` — no filter applied.
 * Scoped roles with empty property_ids get `{ denyAll: true }` so the caller
 * returns an empty result set (NOT all rows).
 */
export function buildPropertyScope(
  req: AuthRequest,
  nextParamIndex: number,
  propertyColumn: string
): PropertyScopeResult {
  const role = req.user?.role || "";
  if (GLOBAL_PROPERTY_SCOPE_ROLES.has(role)) {
    return { sql: "", param: null, denyAll: false };
  }
  const ids = req.user?.propertyIds || [];
  if (!ids.length) {
    return { sql: "", param: null, denyAll: true };
  }
  return {
    sql: `${propertyColumn} = ANY($${nextParamIndex})`,
    param: ids,
    denyAll: false,
  };
}

/**
 * Returns true if the request's role bypasses per-property scoping.
 */
export function isGlobalPropertyScope(req: AuthRequest): boolean {
  return GLOBAL_PROPERTY_SCOPE_ROLES.has(req.user?.role || "");
}

/**
 * Returns true if the caller may access the given property. Global-scope
 * roles always pass; scoped roles must have the propertyId in their
 * property_ids array.
 */
export function callerCanAccessProperty(req: AuthRequest, propertyId: string): boolean {
  if (isGlobalPropertyScope(req)) return true;
  const ids = req.user?.propertyIds || [];
  return ids.includes(propertyId);
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
