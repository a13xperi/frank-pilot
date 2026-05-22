import { Router, Request, Response } from "express";
import { z } from "zod";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { query, transaction } from "../../config/database";
import { authenticate, AuthRequest } from "../../middleware/auth";
import { requireEmailVerified } from "../../middleware/scope";
import { createMagicLink, logMagicLink, sendMagicLink } from "../auth/magic-link-service";
import { ApplicationService } from "../application/service";
import { createApplicationSchema } from "../application/validation";
import { stampTape, TAPE_STAMP_KINDS } from "../tape";
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
  keyGenerator: (req) => `${ipKeyGenerator(req.ip ?? "")}:${(req.body?.email ?? "").toLowerCase()}`,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, try again in a minute" },
});

// INFO-1 (W6 re-audit): the three /register branches do measurably different
// amounts of DB work (staff = 2 SELECT, existing applicant = 2 SELECT + 1
// INSERT, new applicant = 2 SELECT + 2 INSERT), so an attacker with enough
// timing probes can classify {staff, existing, new} for any given email. We
// floor the wall-clock response time at a constant so all three buckets are
// indistinguishable downstream. Default 250 ms is conservative for typical
// Postgres INSERT variance; raise via env if observed branch deltas exceed it.
// Tests opt in by setting REGISTER_RESPONSE_FLOOR_MS explicitly; default 0
// under NODE_ENV=test keeps the existing suite fast.
function getRegisterFloorMs(): number {
  const explicit = process.env.REGISTER_RESPONSE_FLOOR_MS;
  if (explicit !== undefined) return Math.max(0, Number(explicit) || 0);
  return process.env.NODE_ENV === "test" ? 0 : 250;
}

async function respondAtFloor(
  res: Response,
  startedAt: number,
  status: number,
  body: unknown
): Promise<void> {
  const floor = getRegisterFloorMs();
  const elapsed = Date.now() - startedAt;
  if (elapsed < floor) {
    await new Promise((resolve) => setTimeout(resolve, floor - elapsed));
  }
  res.status(status).json(body);
}

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
  const t0 = Date.now();
  try {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      // Request-shape rejection (malformed payload) — no DB work yet, so the
      // INFO-1 floor doesn't apply: this path doesn't disclose which branch
      // the email would have taken.
      res.status(400).json({ error: "Validation failed", details: parsed.error.errors });
      return;
    }

    const { email, firstName, lastName, phone } = parsed.data;

    const existing = await query("SELECT id, role, is_active FROM users WHERE email = $1", [email]);
    let userId: string | undefined;
    let isNew = false;
    let isStaffEmail = false;

    if (existing.rows.length > 0) {
      const u = existing.rows[0];
      if (!["applicant", "tenant"].includes(u.role)) {
        // Existing non-applicant role (staff). Don't onboard, don't issue a real
        // link — but DO fall through to createMagicLink below so wall-clock cost
        // matches the applicant/tenant branches (B2: timing-side-channel close).
        isStaffEmail = true;
      } else {
        userId = u.id;
      }
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

    // Always call createMagicLink. The service short-circuits for staff /
    // inactive / missing emails (returns null) but still pays the SELECT cost.
    // This narrows the timing gap between branches; respondAtFloor() below
    // closes the residual delta (INFO-1).
    const link = await createMagicLink(email);
    if (link) {
      logMagicLink(email, link.link);
      // Fire-and-forget Resend delivery. sendMagicLink() returns synchronously
      // after scheduling the send so per-branch latency stays constant. The
      // staff branch (link === null) skips this call but already pays the
      // createMagicLink SELECT cost, and respondAtFloor() below absorbs the
      // residual gap.
      sendMagicLink(email, link.link, { firstName });
    }

    // INFO-level payload is deliberately minimal: log-aggregation viewers
    // (Railway, Datadog, etc.) cannot pivot on userId/isNew/isStaffEmail to
    // distinguish which /register branch a given email took. Closes INFO-4
    // fingerprinting from the W6 re-audit (2026-05-14). Per-path detail is
    // still derivable via DB lookup on `email` for legitimate operator use.
    logger.info("Register attempt", { email });

    // W6: uniform response for all paths — no token or user ever returned from
    // /register. The client must wait for the magic-link click; token+user are
    // issued only by POST /auth/magic-link/verify.
    // DEMO_LINK_IN_RESPONSE: when RESEND_API_KEY is set in production, this
    // dev-only `devLink` echo should be removed — see `email.ts`. The client
    // should drive off the verification email exclusively in prod.
    const payload: Record<string, unknown> = {
      ok: true,
      message: "If this email is registered, a verification link has been sent.",
    };
    // In dev we always return the magic link so the post-register "check your
    // email" banner can surface it. In prod we keep that gate closed (INFO-3:
    // prevent devLink from leaking in production) UNLESS the operator has
    // explicitly opted-in via DEMO_LINK_IN_RESPONSE=true. The demo-mode flag
    // exists to let us walk a stakeholder through the funnel before real
    // email/SMS delivery is wired; never set it on a tenant-facing deploy.
    const includeDevLink =
      process.env.NODE_ENV === "development" ||
      process.env.DEMO_LINK_IN_RESPONSE === "true";
    if (link && includeDevLink) {
      payload.devLink = link.link;
    }
    await respondAtFloor(res, t0, 202, payload);
  } catch (err) {
    logger.error("Applicant register failed", { error: (err as Error).message });
    // Floor the 5xx path too: a branch-specific crash (e.g. INSERT-only
    // failure on the new-applicant path) would otherwise give away which
    // branch the email landed in.
    await respondAtFloor(res, t0, 500, { error: "Registration failed" });
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

    // If the user already has a draft from /intent or /claim-unit/:id, fill it
    // in place. Inserting a second row would orphan the unit claim sitting on
    // the first draft.
    const existingDraft = await query(
      `SELECT a.id FROM user_applications ua
         JOIN applications a ON a.id = ua.application_id
        WHERE ua.user_id = $1 AND a.status = 'draft'
        ORDER BY a.created_at DESC
        LIMIT 1`,
      [req.user.id]
    );

    let created;
    if (existingDraft.rows.length > 0) {
      created = await applicationService.fillDraft(
        existingDraft.rows[0].id,
        input,
        req.user.id,
        req.user.role
      );
    } else {
      created = await applicationService.create(input, req.user.id, req.user.role);
      await query(
        `INSERT INTO user_applications (user_id, application_id, relationship)
         VALUES ($1, $2, 'primary')
         ON CONFLICT (user_id, application_id) DO NOTHING`,
        [req.user.id, created.id]
      );
    }

    // BP-03b tape stamp: HUD-92006 supplement captured on final apply submit.
    void stampTape({
      kind: TAPE_STAMP_KINDS.HUD_92006_SUPPLEMENT_CAPTURED,
      actor: req.user.id,
      payload: { application_id: created.id, email: req.user.email },
    });

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

// Applicant self-submit: flip the user's draft application to `submitted`
// after the apply-wizard payment step completes. The staff endpoint at
// `/applications/:id/submit` is gated by RBAC (`application:submit`); this
// route is the applicant-scoped counterpart, gated by user_applications
// ownership rather than RBAC.
router.post(
  "/me/applications/submit-draft",
  authenticate,
  requireEmailVerified,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      if (!req.user || !["applicant", "tenant"].includes(req.user.role)) {
        res.status(403).json({ error: "Applicant role required" });
        return;
      }

      const draft = await query(
        `SELECT a.id FROM user_applications ua
           JOIN applications a ON a.id = ua.application_id
          WHERE ua.user_id = $1 AND a.status = 'draft'
          ORDER BY a.created_at DESC
          LIMIT 1`,
        [req.user.id]
      );

      if (draft.rows.length === 0) {
        res.status(404).json({ error: "No draft application to submit" });
        return;
      }

      const result = await applicationService.submit(
        draft.rows[0].id,
        req.user.id,
        req.user.role
      );

      res.json(result);
    } catch (err: any) {
      logger.error("Applicant submit-draft failed", { error: (err as Error).message });
      res.status(500).json({ error: "Failed to submit application" });
    }
  }
);

// ────────────────────────────────────────────────────────────────────────────
// Wedge #5 — position-aware waitlist.
// gpmglv's /join-waitlist is submit-and-disappear. We expose real position
// math per (property, bedroom tier) so the applicant always knows where they
// stand: "#7 of 23, moved up 3 spots, est. 3–6 months". The position screen
// (client-tenant/src/pages/waitlist/Position.tsx) reads the GET summary; the
// banner and Apply funnel POST/DELETE to manage membership.

// Slug ↔ property lookup. The properties table has no slug column; seed
// derives the slug from `name` via lowercase + non-alnum-to-dash + trim. We
// reverse the mapping by normalizing both sides in SQL. Cheap on a 16-row
// table; if the catalog ever grows we can add a stored slug column.
async function resolvePropertyIdBySlug(slug: string): Promise<string | null> {
  // regex_replace mirrors the seed slugify: collapse runs of non-alnum to "-"
  // and strip leading/trailing dashes, all lowercase. The trim_both replaces
  // ltrim+rtrim to keep the SQL portable.
  const result = await query(
    `SELECT id
       FROM properties
      WHERE regexp_replace(
              trim(BOTH '-' FROM regexp_replace(LOWER(name), '[^a-z0-9]+', '-', 'g')),
              '^$', NULL
            ) = $1
      LIMIT 1`,
    [slug]
  );
  return result.rows[0]?.id ?? null;
}

// estimatedWindow heuristic: assumes ~12 moves/year (one open unit per
// bedroom-tier per month, very rough). Replace with property-level historical
// throughput when that signal is available.
function estimateWindow(totalQueue: number, positionAhead: number): string {
  // For unauth/non-enrolled callers we estimate by total queue depth; for
  // enrolled callers we estimate by spots ahead (positionAhead = position - 1).
  const ahead = positionAhead > 0 ? positionAhead : totalQueue;
  if (ahead < 3) return "1–3 months";
  if (ahead < 6) return "3–6 months";
  return "6+ months";
}

interface WaitlistSummaryPayload {
  slug: string;
  position?: number;
  totalQueue: number;
  movement: { spotsThisMonth: number; direction: "up" | "down" | "flat" } | null;
  estimatedWindow: string;
  enrolled: boolean;
}

async function buildWaitlistSummary(
  slug: string,
  propertyId: string,
  bedrooms: number,
  userId: string | null
): Promise<WaitlistSummaryPayload> {
  const totalRes = await query(
    `SELECT COUNT(*)::int AS n
       FROM waitlist_entries
      WHERE property_id = $1 AND bedroom_count = $2`,
    [propertyId, bedrooms]
  );
  const totalQueue: number = totalRes.rows[0]?.n ?? 0;

  if (!userId) {
    return {
      slug,
      totalQueue,
      movement: null,
      estimatedWindow: estimateWindow(totalQueue, 0),
      enrolled: false,
    };
  }

  // Position is 1 + the count of entries created strictly before this user's
  // entry in the same lane. Ties on created_at are vanishingly rare (uuid PK
  // insert is sub-millisecond) and harmless — they'd just share rank.
  const mineRes = await query(
    `SELECT created_at, notified_position_at, last_notified_position
       FROM waitlist_entries
      WHERE property_id = $1 AND bedroom_count = $2 AND applicant_user_id = $3
      LIMIT 1`,
    [propertyId, bedrooms, userId]
  );
  if (mineRes.rows.length === 0) {
    return {
      slug,
      totalQueue,
      movement: null,
      estimatedWindow: estimateWindow(totalQueue, 0),
      enrolled: false,
    };
  }
  const mine = mineRes.rows[0];

  const aheadRes = await query(
    `SELECT COUNT(*)::int AS n
       FROM waitlist_entries
      WHERE property_id = $1
        AND bedroom_count = $2
        AND created_at < $3`,
    [propertyId, bedrooms, mine.created_at]
  );
  const position: number = (aheadRes.rows[0]?.n ?? 0) + 1;

  // Movement requires a prior snapshot. If we haven't notified the applicant
  // about their position yet, return null (the UI hides the chip cleanly).
  let movement: WaitlistSummaryPayload["movement"] = null;
  if (mine.last_notified_position != null && mine.notified_position_at != null) {
    const delta = mine.last_notified_position - position;
    const direction: "up" | "down" | "flat" =
      delta > 0 ? "up" : delta < 0 ? "down" : "flat";
    movement = { spotsThisMonth: Math.abs(delta), direction };
  }

  return {
    slug,
    position,
    totalQueue,
    movement,
    estimatedWindow: estimateWindow(totalQueue, position - 1),
    enrolled: true,
  };
}

// GET /properties/:slug/waitlist-summary?bedrooms=N
// - Requires ?bedrooms (the queue is per bedroom-tier per property).
// - Unauthenticated callers get the public shape (totalQueue + window, no
//   position). Authenticated but not-enrolled callers get the same shape with
//   `enrolled: false`. Enrolled callers get position + movement.
const waitlistBedroomsSchema = z.object({
  bedrooms: z.coerce.number().int().min(0).max(6),
});

router.get(
  "/properties/:slug/waitlist-summary",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const slug = String(req.params.slug ?? "").trim();
      if (!slug) {
        res.status(400).json({ error: "Property slug required" });
        return;
      }

      const parsed = waitlistBedroomsSchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json({
          error: "bedrooms query param is required (0–6)",
          details: parsed.error.errors,
        });
        return;
      }
      const bedrooms = parsed.data.bedrooms;

      const propertyId = await resolvePropertyIdBySlug(slug);
      if (!propertyId) {
        res.status(404).json({ error: "Property not found" });
        return;
      }

      // Resolve the caller — optional. If a Bearer token is present and valid,
      // attribute the position to that user; otherwise fall back to the
      // public shape (no position, just queue depth + window).
      let userId: string | null = null;
      const authHeader = req.headers.authorization;
      if (authHeader?.startsWith("Bearer ")) {
        try {
          const jwt = await import("jsonwebtoken");
          const decoded = jwt.verify(
            authHeader.substring(7),
            // Must match middleware/auth.ts default — mismatch would silently
            // make every token "invalid" in dev/test and break enrolled GETs.
            process.env.JWT_SECRET || "dev-secret-change-me"
          ) as { id?: string };
          if (decoded?.id) {
            // Quick role + active check; not paying the full authenticate()
            // tax (which 401s on miss — we want graceful unauth fallback).
            const u = await query(
              "SELECT id FROM users WHERE id = $1 AND is_active = TRUE",
              [decoded.id]
            );
            if (u.rows.length > 0) userId = u.rows[0].id;
          }
        } catch {
          // Invalid/expired token → treat as anonymous. No 401: the summary
          // is informational and the unauth shape is intentional.
        }
      }

      const summary = await buildWaitlistSummary(slug, propertyId, bedrooms, userId);
      res.json(summary);
    } catch (err) {
      logger.error("Failed to fetch waitlist summary", { error: (err as Error).message });
      res.status(500).json({ error: "Failed to fetch waitlist summary" });
    }
  }
);

const waitlistJoinSchema = z.object({
  bedrooms: z.number().int().min(0).max(6),
});

// POST /properties/:slug/waitlist-join — body { bedrooms }
// Idempotent: re-joining the same (property, bedroom_count) is a no-op and
// returns the existing position (does NOT shuffle the applicant to the back).
router.post(
  "/properties/:slug/waitlist-join",
  authenticate,
  requireEmailVerified,
  unitWriteLimiter,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      if (!req.user || !["applicant", "tenant"].includes(req.user.role)) {
        res.status(403).json({ error: "Applicant role required" });
        return;
      }
      const slug = String(req.params.slug ?? "").trim();
      if (!slug) {
        res.status(400).json({ error: "Property slug required" });
        return;
      }
      const parsed = waitlistJoinSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "Validation failed", details: parsed.error.errors });
        return;
      }
      const propertyId = await resolvePropertyIdBySlug(slug);
      if (!propertyId) {
        res.status(404).json({ error: "Property not found" });
        return;
      }
      // ON CONFLICT DO NOTHING: re-clicking "Join" preserves the original
      // created_at (and thus the original position).
      await query(
        `INSERT INTO waitlist_entries (property_id, bedroom_count, applicant_user_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (property_id, bedroom_count, applicant_user_id) DO NOTHING`,
        [propertyId, parsed.data.bedrooms, req.user.id]
      );

      const summary = await buildWaitlistSummary(
        slug,
        propertyId,
        parsed.data.bedrooms,
        req.user.id
      );
      res.status(201).json(summary);
    } catch (err) {
      logger.error("Failed to join waitlist", { error: (err as Error).message });
      res.status(500).json({ error: "Failed to join waitlist" });
    }
  }
);

// DELETE /properties/:slug/waitlist-leave?bedrooms=N — idempotent
router.delete(
  "/properties/:slug/waitlist-leave",
  authenticate,
  requireEmailVerified,
  unitWriteLimiter,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      if (!req.user || !["applicant", "tenant"].includes(req.user.role)) {
        res.status(403).json({ error: "Applicant role required" });
        return;
      }
      const slug = String(req.params.slug ?? "").trim();
      if (!slug) {
        res.status(400).json({ error: "Property slug required" });
        return;
      }
      const parsed = waitlistBedroomsSchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json({
          error: "bedrooms query param is required (0–6)",
          details: parsed.error.errors,
        });
        return;
      }
      const propertyId = await resolvePropertyIdBySlug(slug);
      if (!propertyId) {
        res.status(404).json({ error: "Property not found" });
        return;
      }
      await query(
        `DELETE FROM waitlist_entries
          WHERE property_id = $1 AND bedroom_count = $2 AND applicant_user_id = $3`,
        [propertyId, parsed.data.bedrooms, req.user.id]
      );
      res.json({ ok: true });
    } catch (err) {
      logger.error("Failed to leave waitlist", { error: (err as Error).message });
      res.status(500).json({ error: "Failed to leave waitlist" });
    }
  }
);

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

// Intent quiz captures applicant preferences only — property_id is not part
// of the quiz. The picker step (next) is what locks the applicant onto a
// specific unit (and therefore property) via /claim-unit/:id. Accepting
// property_id here would let a stale UI overwrite the claimed property.
const intentSchema = z.object({
  bedrooms: z.number().int().min(0).max(6),
  budget_min: z.number().min(0).max(20000).optional(),
  budget_max: z.number().min(0).max(20000),
  move_in_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  household_size: z.number().int().min(1).max(12),
  // W0 AMI pre-qualifier — both optional and nullable. Frontend sends
  // `gross_annual_income` whenever it has a value, and `qualifying_ami_tier`
  // is null when the applicant is over-income for the highest tier. When
  // `gross_annual_income` is null/absent the W0 columns are cleared on the
  // draft.
  gross_annual_income: z.number().min(0).max(500_000).nullable().optional(),
  qualifying_ami_tier: z.enum(["30", "50", "60", "80"]).nullable().optional(),
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

        // W0 — clear-or-set semantics: a numeric income means "applicant
        // submitted income this round, recompute tier/timestamp from it";
        // null/undefined means "clear" so a later submit without income
        // resets the columns. `qualifying_ami_tier` arrives null when the
        // applicant is over-income for the 80% tier.
        const hasW0Income = intent.gross_annual_income != null;
        const grossIncomeParam = intent.gross_annual_income ?? null;
        const amiTierParam = intent.qualifying_ami_tier ?? null;
        const qualHHParam = hasW0Income ? intent.household_size : null;
        const calculatedAtParam = hasW0Income ? new Date() : null;

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
                    gross_annual_income = $7,
                    qualifying_ami_tier = $8,
                    qualifying_household_size = $9,
                    qualifying_ami_calculated_at = $10,
                    updated_at = NOW()
              WHERE id = $1`,
            [
              applicationId,
              intent.bedrooms,
              intent.budget_min ?? null,
              intent.budget_max,
              intent.move_in_date,
              intent.household_size,
              grossIncomeParam,
              amiTierParam,
              qualHHParam,
              calculatedAtParam,
            ]
          );
        } else {
          // No draft yet — pick any active property for the FK. The applicant
          // narrows down via the unit picker, and /claim-unit/:id updates
          // applications.property_id to whichever unit they actually claim.
          const fallback = await client.query(
            `SELECT id FROM properties ORDER BY name ASC LIMIT 1`
          );
          if (fallback.rows.length === 0) {
            throw new Error("NO_PROPERTIES_AVAILABLE");
          }
          const propertyId = fallback.rows[0].id;

          const insert = await client.query(
            `INSERT INTO applications (
                property_id, first_name, last_name, email, status,
                intent_bedrooms, intent_budget_min, intent_budget_max,
                intent_move_in_date, intent_household_size,
                gross_annual_income, qualifying_ami_tier,
                qualifying_household_size, qualifying_ami_calculated_at
             ) VALUES ($1, $2, $3, $4, 'draft', $5, $6, $7, $8, $9, $10, $11, $12, $13)
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
              grossIncomeParam,
              amiTierParam,
              qualHHParam,
              calculatedAtParam,
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

      // BP-03b tape stamp: Waiting List App Form captured on /intent success.
      void stampTape({
        kind: TAPE_STAMP_KINDS.WAITING_LIST_APP_CAPTURED,
        actor: req.user!.id,
        payload: { application_id: result, intent },
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
      const bedroomsMin =
        req.query.bedroomsMin !== undefined ? Number(req.query.bedroomsMin) : undefined;
      const maxRent = req.query.maxRent !== undefined ? Number(req.query.maxRent) : undefined;
      const moveInBy = typeof req.query.moveInBy === "string" ? req.query.moveInBy : undefined;
      const propertyId = typeof req.query.propertyId === "string" ? req.query.propertyId : undefined;

      // W0 AMI filter — narrow to set-asides the applicant qualifies for.
      // Tier '50' qualifies for ['50','60','80']% units (and market-rate);
      // missing/invalid param → no filter (permissive default).
      const AMI_TIER_ORDER = ["30", "50", "60", "80"] as const;
      const amiTierRaw =
        typeof req.query.amiTier === "string" ? req.query.amiTier : undefined;
      const amiTier =
        amiTierRaw && (AMI_TIER_ORDER as readonly string[]).includes(amiTierRaw)
          ? (amiTierRaw as (typeof AMI_TIER_ORDER)[number])
          : undefined;

      const conditions: string[] = [
        "(u.status = 'available' OR (u.status = 'held' AND u.claim_expires_at < NOW()))",
      ];
      const params: unknown[] = [];

      // `bedroomsMin` is inclusive — used by the "N+ BR" filter option so the
      // user actually sees units at higher bedroom counts. Falls back to
      // `bedrooms` (exact match) when callers want a single bedroom count.
      // `bedroomsMin` wins if both are sent.
      if (bedroomsMin !== undefined && Number.isFinite(bedroomsMin)) {
        params.push(bedroomsMin);
        conditions.push(`u.bedrooms >= $${params.length}`);
      } else if (bedrooms !== undefined && Number.isFinite(bedrooms)) {
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
      if (amiTier) {
        // Match the property's set-aside text ("60% AMI", "80% AMI", …) to
        // the tiers at or above the applicant's lowest qualifying tier.
        // Market-rate properties (null/empty set_aside) stay visible.
        const idx = AMI_TIER_ORDER.indexOf(amiTier);
        const allowedSetAsides = AMI_TIER_ORDER.slice(idx).map(t => `${t}% AMI`);
        params.push(allowedSetAsides);
        conditions.push(
          `(p.ami_set_aside = ANY($${params.length}) OR p.ami_set_aside IS NULL OR p.ami_set_aside = '')`
        );
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
        // Serialize per-user so two tabs from the same user can't concurrently
        // claim different units and orphan one in 'held'. Row-level FOR UPDATE
        // on the unit is per-unit and doesn't protect the cross-unit invariant
        // "one draft holds at most one unit".
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
          `claim-unit:${req.user!.id}`,
        ]);

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

        // Issue #15 Bug 2 (concurrent same-user leak): the per-user advisory
        // lock above serializes claims from the same user, but we still need
        // FOR UPDATE on the draft row itself so the prior-unit pointer we
        // read is the one we'll mutate at the end of the txn. Without it, a
        // sibling txn that already advanced past the lock could have rewritten
        // claimed_unit_id between our read and our write.
        const draft = await client.query(
          `SELECT a.id, a.claimed_unit_id, a.claim_expires_at
             FROM user_applications ua
             JOIN applications a ON a.id = ua.application_id
            WHERE ua.user_id = $1 AND a.status = 'draft'
            ORDER BY a.created_at DESC
            LIMIT 1
            FOR UPDATE OF a`,
          [req.user!.id]
        );

        let applicationId: string;
        let priorUnitId: string | null = null;
        let priorExpiresAt: Date | string | null = null;
        if (draft.rows.length > 0) {
          applicationId = draft.rows[0].id;
          priorUnitId = draft.rows[0].claimed_unit_id;
          priorExpiresAt = draft.rows[0].claim_expires_at;
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
          // Issue #15 Bug 1 (cross-user clobber): the prior-unit release used
          // to be an unconditional UPDATE on the unit row, so if the user's
          // own hold had already expired and a different applicant had since
          // re-claimed that unit, this UPDATE would silently destroy the new
          // holder's claim. Gate the UPDATE on the expected (holder, expiry)
          // predicate — if the row no longer matches what we held, the UPDATE
          // is a no-op and the new holder is safe.
          await client.query(
            `UPDATE units
                SET status = 'available',
                    claim_expires_at = NULL,
                    updated_at = NOW()
              WHERE id = $1
                AND status = 'held'
                AND claim_expires_at IS NOT DISTINCT FROM $2`,
            [priorUnitId, priorExpiresAt]
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

      // BP-03b tape stamp: Position Letter sent on successful unit claim
      // (the carrot — claimed unit pulls applicant through to apply).
      if ("ok" in result) {
        void stampTape({
          kind: TAPE_STAMP_KINDS.POSITION_LETTER_SENT,
          actor: req.user!.id,
          payload: {
            application_id: result.application_id,
            unit_id: unitId,
            expires_at: result.expires_at,
          },
        });
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
        // Same per-user serialization as POST /claim-unit/:id — prevents a
        // release racing a claim from another tab (which could otherwise mark
        // the prior unit available after the new claim already replaced it).
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
          `claim-unit:${req.user!.id}`,
        ]);

        // Issue #15: lock the draft row so we read the (claimed_unit_id,
        // claim_expires_at) pair that we'll guard the release UPDATE with.
        const draft = await client.query(
          `SELECT a.id, a.claimed_unit_id, a.claim_expires_at
             FROM user_applications ua
             JOIN applications a ON a.id = ua.application_id
            WHERE ua.user_id = $1 AND a.status = 'draft' AND a.claimed_unit_id IS NOT NULL
            ORDER BY a.created_at DESC
            LIMIT 1
            FOR UPDATE OF a`,
          [req.user!.id]
        );
        if (draft.rows.length === 0) return;
        const {
          id: applicationId,
          claimed_unit_id: unitId,
          claim_expires_at: priorExpiresAt,
        } = draft.rows[0];

        // Issue #15 Bug 1: guard the release with holder+expiry so we can't
        // clobber a unit that has lazy-expired into a different user's hold.
        await client.query(
          `UPDATE units
              SET status = 'available',
                  claim_expires_at = NULL,
                  updated_at = NOW()
            WHERE id = $1
              AND status = 'held'
              AND claim_expires_at IS NOT DISTINCT FROM $2`,
          [unitId, priorExpiresAt]
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
              a.requested_rent_amount,
              a.intent_bedrooms, a.intent_budget_min, a.intent_budget_max,
              a.intent_move_in_date, a.intent_household_size,
              p.name AS property_name
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
