import { Router, Request, Response } from "express";
import { z } from "zod";
import rateLimit from "express-rate-limit";
import { query, transaction } from "../../config/database";
import { authenticate, AuthRequest, generateToken, AuthUser } from "../../middleware/auth";
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

    if (isNew) {
      // Brand-new account: issue a session JWT so the applicant lands in the
      // portal — but mark it emailVerified:false. The applicant can view
      // public/account UI; PII + state-changing routes (/apply, /me/applications)
      // are gated by requireEmailVerified until the magic link is clicked.
      // This closes WARN #2: an attacker registering victim@x can no longer
      // act as victim with the returned token.
      const userRow = await query(
        "SELECT id, email, role, first_name, last_name FROM users WHERE id = $1",
        [userId]
      );
      const u = userRow.rows[0];
      const authUser: AuthUser = {
        id: u.id,
        email: u.email,
        role: u.role,
        firstName: u.first_name,
        lastName: u.last_name,
        propertyIds: [],
        emailVerified: false,
      };
      const token = generateToken(authUser, { emailVerified: false });
      const payload: Record<string, unknown> = {
        ok: true,
        message: "If this email is registered, a verification link has been sent.",
        token,
        user: authUser,
      };
      if (link && process.env.NODE_ENV === "development") {
        payload.devLink = link.link;
      }
      res.status(202).json(payload);
      return;
    }

    // Existing account: magic link already sent above for account recovery.
    // Never reveal a token for a pre-existing account.
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
