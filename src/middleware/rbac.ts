import { Response, NextFunction } from "express";
import { AuthRequest } from "./auth";
import { logger } from "../utils/logger";

/**
 * Role hierarchy — higher index = more permissions.
 * No single person should have end-to-end control.
 */
const ROLE_HIERARCHY: Record<string, number> = {
  leasing_agent: 1,
  senior_manager: 2,
  regional_manager: 3,
  asset_manager: 4,
  system_admin: 5,
};

/**
 * Permission matrix — maps actions to minimum required roles.
 */
const PERMISSIONS: Record<string, string[]> = {
  // Application management
  "application:create": ["leasing_agent", "senior_manager", "regional_manager", "asset_manager", "system_admin"],
  "application:read": ["leasing_agent", "senior_manager", "regional_manager", "asset_manager", "system_admin"],
  "application:submit": ["leasing_agent", "senior_manager", "regional_manager", "asset_manager", "system_admin"],

  // Screening — no leasing agents
  "screening:initiate": ["senior_manager", "regional_manager", "asset_manager", "system_admin"],
  "screening:view": ["senior_manager", "regional_manager", "asset_manager", "system_admin"],

  // Approval tiers
  "approval:tier1": ["senior_manager", "regional_manager", "asset_manager", "system_admin"],
  "approval:tier2": ["regional_manager", "asset_manager", "system_admin"],
  "approval:tier3": ["asset_manager", "system_admin"],

  // Lease operations
  "lease:generate": ["senior_manager", "regional_manager", "asset_manager", "system_admin"],
  "lease:modify": ["senior_manager", "regional_manager", "asset_manager", "system_admin"],

  // Payment
  "payment:setup": ["senior_manager", "regional_manager", "asset_manager", "system_admin"],
  "payment:view": ["leasing_agent", "senior_manager", "regional_manager", "asset_manager", "system_admin"],

  // Fraud flags
  "fraud:view": ["senior_manager", "regional_manager", "asset_manager", "system_admin"],
  "fraud:resolve": ["regional_manager", "asset_manager", "system_admin"],

  // Decision matrix
  "modification:request": ["leasing_agent", "senior_manager", "regional_manager", "asset_manager", "system_admin"],
  "modification:approve_senior": ["senior_manager", "regional_manager", "asset_manager", "system_admin"],
  "modification:approve_regional": ["regional_manager", "asset_manager", "system_admin"],
  "modification:approve_asset": ["asset_manager", "system_admin"],

  // Inspections & Maintenance
  "inspection:view": ["leasing_agent", "senior_manager", "regional_manager", "asset_manager", "system_admin"],
  "inspection:manage": ["senior_manager", "regional_manager", "asset_manager", "system_admin"],
  "maintenance:view": ["leasing_agent", "senior_manager", "regional_manager", "asset_manager", "system_admin"],
  "maintenance:manage": ["leasing_agent", "senior_manager", "regional_manager", "asset_manager", "system_admin"],

  // Renewal & Move-Out
  "renewal:view": ["leasing_agent", "senior_manager", "regional_manager", "asset_manager", "system_admin"],
  "renewal:manage": ["senior_manager", "regional_manager", "asset_manager", "system_admin"],
  "moveout:view": ["leasing_agent", "senior_manager", "regional_manager", "asset_manager", "system_admin"],
  "moveout:manage": ["senior_manager", "regional_manager", "asset_manager", "system_admin"],

  // Eviction
  "eviction:view": ["senior_manager", "regional_manager", "asset_manager", "system_admin"],
  "eviction:manage": ["senior_manager", "regional_manager", "asset_manager", "system_admin"],

  // Ledger
  "ledger:view": ["leasing_agent", "senior_manager", "regional_manager", "asset_manager", "system_admin"],
  "ledger:manage": ["senior_manager", "regional_manager", "asset_manager", "system_admin"],

  // Accounts Payable (DM-FRANK-024). Roles tier the capability; the per-person
  // segregation of duties (cutter ≠ reviewer ≠ signer) is enforced at runtime by
  // enforceSeparationOfDuties, not by the role matrix. ap:correct (void/reissue)
  // is elevated, distinct from ap:cut.
  "ap:view": ["senior_manager", "regional_manager", "asset_manager", "system_admin"],
  "ap:cut": ["senior_manager", "regional_manager", "asset_manager", "system_admin"],
  "ap:review": ["regional_manager", "asset_manager", "system_admin"],
  "ap:sign": ["asset_manager", "system_admin"],
  "ap:correct": ["asset_manager", "system_admin"],
  "ap:manage": ["asset_manager", "system_admin"],

  // Recertification
  "recertification:view": ["leasing_agent", "senior_manager", "regional_manager", "asset_manager", "system_admin"],
  "recertification:manage": ["senior_manager", "regional_manager", "asset_manager", "system_admin"],
  "recertification:review": ["senior_manager", "regional_manager", "asset_manager", "system_admin"],

  // Audit
  "audit:view": ["regional_manager", "asset_manager", "system_admin"],

  // Housing-QA kill-switch — break-glass disable/enable of the PUBLIC grounded
  // chat endpoint (personal-token-backed in prod). Highest blast radius, so
  // system_admin only.
  "housing_qa:admin": ["system_admin"],

  // User management
  "user:manage": ["system_admin"],
  "user:view": ["senior_manager", "regional_manager", "asset_manager", "system_admin"],

  // Property management
  "property:manage": ["asset_manager", "system_admin"],
  "property:view": ["leasing_agent", "senior_manager", "regional_manager", "asset_manager", "system_admin"],

  // QAP acquisitions layer — credit-acquisition side (Demand-Evidence Engine,
  // project scoring, award). Asset managers and admins only.
  "acquisition:view": ["asset_manager", "system_admin"],
  "acquisition:manage": ["asset_manager", "system_admin"],

  // Voice intake review (ElevenLabs Conv. AI post-call). View is open to
  // leasing agents (they can triage callback queue); approve/reject gates the
  // promotion of an intake into an `applications` row, so it's senior+ only.
  "voice_intake:view": ["leasing_agent", "senior_manager", "regional_manager", "asset_manager", "system_admin"],
  "voice_intake:approve": ["senior_manager", "regional_manager", "asset_manager", "system_admin"],

  // Outbound waitlist-validation dialer (DM-FRANK-029). Firing real phone
  // calls to applicants is high blast radius — system_admin only; managers
  // can watch progress and pull the report.
  "outbound_validation:run": ["system_admin"],
  "outbound_validation:view": ["senior_manager", "regional_manager", "asset_manager", "system_admin"],

  // Manager briefing — the unified operations rollup (KPIs, attention list,
  // per-property snapshot). Senior+ surface; service scopes by property_ids.
  "manager_briefing:view": ["senior_manager", "regional_manager", "asset_manager", "system_admin"],
};

export function requireRole(...roles: string[]) {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    if (!roles.includes(req.user.role)) {
      logger.warn("Unauthorized role access attempt", {
        userId: req.user.id,
        userRole: req.user.role,
        requiredRoles: roles,
        path: req.path,
      });
      res.status(403).json({ error: "Insufficient permissions" });
      return;
    }

    next();
  };
}

export function requirePermission(permission: string) {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const allowedRoles = PERMISSIONS[permission];
    if (!allowedRoles) {
      logger.error("Unknown permission requested", { permission });
      res.status(500).json({ error: "Unknown permission" });
      return;
    }

    if (!allowedRoles.includes(req.user.role)) {
      logger.warn("Unauthorized permission access attempt", {
        userId: req.user.id,
        userRole: req.user.role,
        permission,
        path: req.path,
      });
      res.status(403).json({ error: "Insufficient permissions" });
      return;
    }

    next();
  };
}

/**
 * Enforce separation of duties: the approver cannot be the same person
 * who submitted or previously approved the application.
 */
export function enforceSeparationOfDuties(
  actorId: string,
  previousActorIds: string[]
): boolean {
  return !previousActorIds.includes(actorId);
}

/**
 * Check if a role meets the minimum level required.
 */
export function meetsMinimumRole(userRole: string, minimumRole: string): boolean {
  return (ROLE_HIERARCHY[userRole] || 0) >= (ROLE_HIERARCHY[minimumRole] || 0);
}

export { PERMISSIONS, ROLE_HIERARCHY };
