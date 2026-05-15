import { Router, Request, Response } from "express";
import { z } from "zod";
import rateLimit from "express-rate-limit";
import { query, transaction } from "../../config/database";
import { authenticate, AuthRequest } from "../../middleware/auth";
import { requireEmailVerified } from "../../middleware/scope";
import { createMagicLink, logMagicLink } from "../auth/magic-link-service";
import { ApplicationService } from "../application/service";
import { createApplicationSchema } from "../application/validation";
import { logger } from "../../utils/logger";

const router: Router = Router();
const applicationService = new ApplicationService();

const registerSchema = z.object({
  email: z.string().email(),
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  phone: z.string().max(20).optional(),
});

const registerLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  keyGenerator: (req) => `${req.ip}:${(req.body?.email ?? "").toLowerCase()}`,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, try again in a minute" },
});

// Per-user limiters for the authenticated unit-claim flow (B3). Keyed by the
// authenticated user id (populated by `authenticate`); falls back to a shared
// "anon" bucket if the limiter ever runs before auth (should not happen given
// the middleware chain below, but is defensively safe).
const userKey = (req: Request): string => (req as AuthRequest).user?.id ?? "anon";

// Browsing the catalog — looser ceiling to allow legitimate window-shopping.
const unitBrowseLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  keyGenerator: userKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, slow down" },
});

// Shared bucket across the three write actions (intent / claim / release) —
// tighter ceiling to mitigate claim-spam and intent-spam from a single user.
const unitWriteLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  keyGenerator: userKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, slow down" },
});

// Public: register as an applicant. Idempotent — if the email already exists as
// an applicant, we reissue a magic link instead of erroring (no email enumeration).
router.post("/register", registerLimiter, async (req: Request, res: Response): Promise<void> => {
  try {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation failed", details: parsed.error.errors });
      return;
    }

    const { email, firstName, lastName, phone } = parsed.data;

    const existing = await query("SELECT id, role, is_active FROM users WHERE email = $1", [email]);
    let userId: string;
    let isNew = false;

    if (existing.rows.length > 0) {
      const u = existing.rows[0];
      // If existing account is staff, don't allow applicant registration on that email.
      if (!["applicant", "tenant"].includes(u.role)) {
        // Don't leak — return the same normalized response as any other case.
        res.status(202).json({
          ok: true,
          message: "If this email is registered, a verification link has been sent.",
        });
        return;
      }
      userId = u.id;
    } else {
      const insertRes = await query(
        `INSERT INTO users (email, first_name, last_name, phone, role, is_active, password_hash)
         VALUES ($1, $2, $3, $4, 'applicant', true, NULL)
         RETURNING id`,
        [email, firstName, lastName, phone || null]
      );
      userId = insertRes.rows[0].id;
      isNew = true;
    }

    const link = await createMagicLink(email);
    if (link) logMagicLink(email, link.link);

    logger.info("Applicant registered", { userId, email, isNew });

    // W6: uniform response for all paths — no token or user ever returned from
    // /register. The client must wait for the magic-link click; token+user are
    // issued only by POST /auth/magic-link/verify.
    const payload: Record<string, unknown> = {
      ok: true,
      message: "If this email is registered, a verification link has been sent.",
    };
    if (link && process.env.NODE_ENV === "development") {
      payload.devLink = link.link;
    }
    res.status(202).json(payload);
  } catch (err) {
    logger.error("Applicant register failed", { error: (err as Error).message });
    res.status(500).json({ error: "Registration failed" });
  }
});

// Authenticated as applicant with a verified email: submit the application
// form. requireEmailVerified gates this — see WARN #2.
router.post("/apply", authenticate, requireEmailVerified, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user || !["applicant", "tenant"].includes(req.user.role)) {
      res.status(403).json({ error: "Applicant role required" });
      return;
    }

    const input = createApplicationSchema.parse(req.body);

    // Default email on the application to the authenticated user if not provided.
    if (!input.email) input.email = req.user.email;

    const created = await applicationService.create(input, req.user.id, req.user.role);

    // Link this user to the application as the primary applicant.
    await query(
      `INSERT INTO user_applications (user_id, application_id, relationship)
       VALUES ($1, $2, 'primary')
       ON CONFLICT (user_id, application_id) DO NOTHING`,
      [req.user.id, created.id]
    );

    res.status(201).json(created);
  } catch (err: any) {
    if (err.name === "ZodError") {
      res.status(400).json({ error: "Validation failed", details: err.errors });
      return;
    }
    logger.error("Applicant apply failed", { error: (err as Error).message });
    res.status(500).json({ error: "Failed to submit application" });
  }
});

// Public: list of properties an applicant can apply to. Returns minimal
// public-safe fields only (no compliance metadata, no internal IDs).
router.get("/properties", async (_req: Request, res: Response): Promise<void> => {
  try {
    const result = await query(
      `SELECT id, name, address_line1, city, state, zip, unit_count, property_type,
              waiting_list_enabled
       FROM properties
       ORDER BY name ASC`
    );
    res.json({ properties: result.rows });
  } catch (err) {
    logger.error("Failed to list public properties", { error: (err as Error).message });
    res.status(500).json({ error: "Failed to list properties" });
  }
});

const intentSchema = z.object({
  bedrooms: z.number().int().min(0).max(6),
  budget_min: z.number().min(0).max(20000).optional(),
  budget_max: z.number().min(0).max(20000),
  move_in_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  household_size: z.number().int().min(1).max(12),
  property_id: z.string().uuid().optional(),
});

// Save the 5-question intent quiz onto the user's draft application.
// Creates a draft if none exists. Returns the application id so the next
// step (unit picker) can attach the claim to it.
router.post(
  "/intent",
  authenticate,
  requireEmailVerified,
  unitWriteLimiter,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      if (!req.user || !["applicant", "tenant"].includes(req.user.role)) {
        res.status(403).json({ error: "Applicant role required" });
        return;
      }

      const parsed = intentSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "Validation failed", details: parsed.error.errors });
        return;
      }
      const intent = parsed.data;

      const result = await transaction(async (client) => {
        const draft = await client.query(
          `SELECT a.id
             FROM user_applications ua
             JOIN applications a ON a.id = ua.application_id
            WHERE ua.user_id = $1 AND a.status = 'draft'
            ORDER BY a.created_at DESC
            LIMIT 1`,
          [req.user!.id]
        );

        let applicationId: string;
        if (draft.rows.length > 0) {
          applicationId = draft.rows[0].id;
          await client.query(
            `UPDATE applications
                SET intent_bedrooms = $2,
                    intent_budget_min = $3,
                    intent_budget_max = $4,
                    intent_move_in_date = $5,
                    intent_household_size = $6,
                    property_id = COALESCE($7, property_id),
                    updated_at = NOW()
              WHERE id = $1`,
            [
              applicationId,
              intent.bedrooms,
              intent.budget_min ?? null,
              intent.budget_max,
              intent.move_in_date,
              intent.household_size,
              intent.property_id ?? null,
            ]
          );
        } else {
          // Pick a property for the draft FK if the applicant didn't choose one.
          // Any active property works — they'll narrow via the unit picker.
          let propertyId = intent.property_id ?? null;
          if (!propertyId) {
            const fallback = await client.query(
              `SELECT id FROM properties ORDER BY name ASC LIMIT 1`
            );
            if (fallback.rows.length === 0) {
              throw new Error("NO_PROPERTIES_AVAILABLE");
            }
            propertyId = fallback.rows[0].id;
          }

          const insert = await client.query(
            `INSERT INTO applications (
                property_id, first_name, last_name, email, status,
                intent_bedrooms, intent_budget_min, intent_budget_max,
                intent_move_in_date, intent_household_size
             ) VALUES ($1, $2, $3, $4, 'draft', $5, $6, $7, $8, $9)
             RETURNING id`,
            [
              propertyId,
              req.user!.firstName ?? "",
              req.user!.lastName ?? "",
              req.user!.email,
              intent.bedrooms,
              intent.budget_min ?? null,
              intent.budget_max,
              intent.move_in_date,
              intent.household_size,
            ]
          );
          applicationId = insert.rows[0].id;

          await client.query(
            `INSERT INTO user_applications (user_id, application_id, relationship)
             VALUES ($1, $2, 'primary')
             ON CONFLICT (user_id, application_id) DO NOTHING`,
            [req.user!.id, applicationId]
          );
        }

        return applicationId;
      });

      res.json({ ok: true, application_id: result });
    } catch (err) {
      const msg = (err as Error).message;
      if (msg === "NO_PROPERTIES_AVAILABLE") {
        res.status(503).json({ error: "No properties available", code: "NO_PROPERTIES" });
        return;
      }
      logger.error("Applicant intent failed", { error: msg });
      res.status(500).json({ error: "Failed to save intent" });
    }
  }
);

// List up to 12 units matching the applicant's intent. Treats stale-held units
// (claim_expires_at < NOW()) as available so cron isn't required.
router.get(
  "/units",
  authenticate,
  requireEmailVerified,
  unitBrowseLimiter,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      if (!req.user || !["applicant", "tenant"].includes(req.user.role)) {
        res.status(403).json({ error: "Applicant role required" });
        return;
      }

      const bedrooms = req.query.bedrooms !== undefined ? Number(req.query.bedrooms) : undefined;
      const maxRent = req.query.maxRent !== undefined ? Number(req.query.maxRent) : undefined;
      const moveInBy = typeof req.query.moveInBy === "string" ? req.query.moveInBy : undefined;
      const propertyId = typeof req.query.propertyId === "string" ? req.query.propertyId : undefined;

      const conditions: string[] = [
        "(u.status = 'available' OR (u.status = 'held' AND u.claim_expires_at < NOW()))",
      ];
      const params: unknown[] = [];

      if (bedrooms !== undefined && Number.isFinite(bedrooms)) {
        params.push(bedrooms);
        conditions.push(`u.bedrooms = $${params.length}`);
      }
      if (maxRent !== undefined && Number.isFinite(maxRent)) {
        params.push(maxRent);
        conditions.push(`u.monthly_rent <= $${params.length}`);
      }
      if (moveInBy && /^\d{4}-\d{2}-\d{2}$/.test(moveInBy)) {
        params.push(moveInBy);
        conditions.push(`(u.available_from IS NULL OR u.available_from <= $${params.length})`);
      }
      if (propertyId && /^[0-9a-f-]{36}$/i.test(propertyId)) {
        params.push(propertyId);
        conditions.push(`u.property_id = $${params.length}`);
      }

      const result = await query(
        `SELECT u.id, u.property_id, u.unit_number, u.bedrooms, u.bathrooms,
                u.sqft, u.monthly_rent, u.photo_url, u.available_from,
                p.name AS property_name, p.city AS property_city, p.state AS property_state
           FROM units u
           JOIN properties p ON p.id = u.property_id
          WHERE ${conditions.join(" AND ")}
          ORDER BY u.monthly_rent ASC, u.unit_number ASC
          LIMIT 12`,
        params
      );

      res.json({ units: result.rows });
    } catch (err) {
      logger.error("Failed to list units", { error: (err as Error).message });
      res.status(500).json({ error: "Failed to list units" });
    }
  }
);

const CLAIM_DURATION_HOURS = 48;

// Atomically claim a unit. Releases any prior claim by the same user.
// 409 UNIT_UNAVAILABLE if the unit is held by someone else (and not stale).
router.post(
  "/claim-unit/:id",
  authenticate,
  requireEmailVerified,
  unitWriteLimiter,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      if (!req.user || !["applicant", "tenant"].includes(req.user.role)) {
        res.status(403).json({ error: "Applicant role required" });
        return;
      }
      const unitId = String(req.params.id ?? "");
      if (!/^[0-9a-f-]{36}$/i.test(unitId)) {
        res.status(400).json({ error: "Invalid unit id" });
        return;
      }

      const result = await transaction(async (client) => {
        const locked = await client.query(
          `SELECT id, property_id, status, claim_expires_at
             FROM units
            WHERE id = $1
            FOR UPDATE`,
          [unitId]
        );
        if (locked.rows.length === 0) {
          return { error: "NOT_FOUND" as const };
        }
        const unit = locked.rows[0];
        const isAvailable =
          unit.status === "available" ||
          (unit.status === "held" && unit.claim_expires_at && new Date(unit.claim_expires_at) < new Date());
        if (!isAvailable) {
          return { error: "UNIT_UNAVAILABLE" as const };
        }

        const draft = await client.query(
          `SELECT a.id, a.claimed_unit_id
             FROM user_applications ua
             JOIN applications a ON a.id = ua.application_id
            WHERE ua.user_id = $1 AND a.status = 'draft'
            ORDER BY a.created_at DESC
            LIMIT 1`,
          [req.user!.id]
        );

        let applicationId: string;
        let priorUnitId: string | null = null;
        if (draft.rows.length > 0) {
          applicationId = draft.rows[0].id;
          priorUnitId = draft.rows[0].claimed_unit_id;
        } else {
          const created = await client.query(
            `INSERT INTO applications (property_id, first_name, last_name, email, status)
             VALUES ($1, $2, $3, $4, 'draft')
             RETURNING id`,
            [
              unit.property_id,
              req.user!.firstName ?? "",
              req.user!.lastName ?? "",
              req.user!.email,
            ]
          );
          applicationId = created.rows[0].id;
          await client.query(
            `INSERT INTO user_applications (user_id, application_id, relationship)
             VALUES ($1, $2, 'primary')
             ON CONFLICT (user_id, application_id) DO NOTHING`,
            [req.user!.id, applicationId]
          );
        }

        if (priorUnitId && priorUnitId !== unitId) {
          await client.query(
            `UPDATE units
                SET status = 'available',
                    claim_expires_at = NULL,
                    updated_at = NOW()
              WHERE id = $1`,
            [priorUnitId]
          );
        }

        const expiresAt = new Date(Date.now() + CLAIM_DURATION_HOURS * 60 * 60 * 1000);

        await client.query(
          `UPDATE units
              SET status = 'held',
                  claim_expires_at = $2,
                  updated_at = NOW()
            WHERE id = $1`,
          [unitId, expiresAt]
        );

        await client.query(
          `UPDATE applications
              SET claimed_unit_id = $2,
                  claim_expires_at = $3,
                  property_id = $4,
                  updated_at = NOW()
            WHERE id = $1`,
          [applicationId, unitId, expiresAt, unit.property_id]
        );

        const enriched = await client.query(
          `SELECT u.id, u.property_id, u.unit_number, u.bedrooms, u.bathrooms,
                  u.sqft, u.monthly_rent, u.photo_url, u.available_from,
                  p.name AS property_name, p.city AS property_city, p.state AS property_state
             FROM units u
             JOIN properties p ON p.id = u.property_id
            WHERE u.id = $1`,
          [unitId]
        );
        return { ok: true as const, unit: enriched.rows[0], expires_at: expiresAt, application_id: applicationId };
      });

      if ("error" in result) {
        if (result.error === "NOT_FOUND") {
          res.status(404).json({ error: "Unit not found" });
          return;
        }
        if (result.error === "UNIT_UNAVAILABLE") {
          res.status(409).json({ error: "Unit is no longer available", code: "UNIT_UNAVAILABLE" });
          return;
        }
      }

      res.json(result);
    } catch (err) {
      logger.error("Failed to claim unit", { error: (err as Error).message });
      res.status(500).json({ error: "Failed to claim unit" });
    }
  }
);

// Release the user's current claim (set unit back to available, clear app fields).
router.delete(
  "/claim-unit",
  authenticate,
  requireEmailVerified,
  unitWriteLimiter,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      if (!req.user || !["applicant", "tenant"].includes(req.user.role)) {
        res.status(403).json({ error: "Applicant role required" });
        return;
      }

      await transaction(async (client) => {
        const draft = await client.query(
          `SELECT a.id, a.claimed_unit_id
             FROM user_applications ua
             JOIN applications a ON a.id = ua.application_id
            WHERE ua.user_id = $1 AND a.status = 'draft' AND a.claimed_unit_id IS NOT NULL
            ORDER BY a.created_at DESC
            LIMIT 1`,
          [req.user!.id]
        );
        if (draft.rows.length === 0) return;
        const { id: applicationId, claimed_unit_id: unitId } = draft.rows[0];

        await client.query(
          `UPDATE units
              SET status = 'available',
                  claim_expires_at = NULL,
                  updated_at = NOW()
            WHERE id = $1`,
          [unitId]
        );
        await client.query(
          `UPDATE applications
              SET claimed_unit_id = NULL,
                  claim_expires_at = NULL,
                  updated_at = NOW()
            WHERE id = $1`,
          [applicationId]
        );
      });

      res.json({ ok: true });
    } catch (err) {
      logger.error("Failed to release claim", { error: (err as Error).message });
      res.status(500).json({ error: "Failed to release claim" });
    }
  }
);

// Authenticated as applicant with a verified email: list my applications.
// PII surface — requireEmailVerified prevents enumeration via stolen
// pre-verification token.
router.get("/me/applications", authenticate, requireEmailVerified, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user || !["applicant", "tenant"].includes(req.user.role)) {
      res.status(403).json({ error: "Applicant role required" });
      return;
    }
    const result = await query(
      `SELECT a.id, a.first_name, a.last_name, a.email, a.status, a.submitted_at,
              a.created_at, a.property_id, a.unit_number, a.overall_screening_result,
              a.requested_rent_amount, p.name AS property_name
       FROM user_applications ua
       JOIN applications a ON a.id = ua.application_id
       JOIN properties p ON p.id = a.property_id
       WHERE ua.user_id = $1
       ORDER BY a.created_at DESC`,
      [req.user.id]
    );
    res.json({ applications: result.rows });
  } catch (err) {
    logger.error("Failed to list my applications", { error: (err as Error).message });
    res.status(500).json({ error: "Failed to list applications" });
  }
});

export default router;
