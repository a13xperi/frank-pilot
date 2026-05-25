import { Router, Request, Response } from "express";
import { z } from "zod";
import jwt from "jsonwebtoken";
import { query } from "../../config/database";
import { logger } from "../../utils/logger";
import { shouldReturnDevLink } from "../../utils/demo-link";
import {
  GUEST_COOKIE_NAME,
  DEFAULT_LIST_NAME,
  Owner,
  hashGuestToken,
  resolveOrCreateGuestSession,
  saveProperty,
  unsaveProperty,
  getShortlist,
  setAlert,
  getCompare,
  resolvePropertyIdBySlug,
} from "./service";

// ────────────────────────────────────────────────────────────────────────────
// Saved-property shortlist routes (public — guests AND authed users).
//
// Owner resolution per request:
//   - Authorization: Bearer <jwt> present + valid → user owner.
//   - Else → guest owner, tracked by the httpOnly `uh_guest` cookie. The cookie
//     is parsed from the raw Cookie header (no cookie-parser dependency) and
//     set on the response (Set-Cookie) only when a NEW guest session is minted.
//
// Discover renders from slugs, so the API speaks slugs and resolves them to the
// property UUID server-side. Reads never create a guest session (so a bot GET
// can't spam guest rows); only a save (POST) mints one.
// ────────────────────────────────────────────────────────────────────────────

const router: Router = Router();

const COOKIE_MAX_AGE_DAYS = 90;

/** Parse a single cookie value out of the raw Cookie header. */
function readCookie(req: Request, name: string): string | null {
  const raw = req.headers.cookie;
  if (!raw) return null;
  for (const part of raw.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const k = part.slice(0, eq).trim();
    if (k === name) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return null;
}

/** Set the guest cookie. httpOnly + SameSite=Lax; Secure in production. */
function setGuestCookie(res: Response, token: string): void {
  const parts = [
    `${GUEST_COOKIE_NAME}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${COOKIE_MAX_AGE_DAYS * 24 * 60 * 60}`,
  ];
  if (process.env.NODE_ENV === "production") parts.push("Secure");
  res.append("Set-Cookie", parts.join("; "));
}

/**
 * Resolve the caller as a user (from a valid Bearer JWT) without paying the
 * full authenticate() tax (which 401s on miss — we want graceful guest
 * fallback). Mirrors the optional-auth pattern in applicants/routes.ts
 * (waitlist-summary). Returns the user id or null.
 */
async function resolveOptionalUser(req: Request): Promise<string | null> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) return null;
  try {
    const decoded = jwt.verify(
      authHeader.substring(7),
      process.env.JWT_SECRET || "dev-secret-change-me"
    ) as { id?: string };
    if (!decoded?.id) return null;
    const u = await query("SELECT id FROM users WHERE id = $1 AND is_active = TRUE", [
      decoded.id,
    ]);
    return u.rows.length > 0 ? u.rows[0].id : null;
  } catch {
    return null;
  }
}

/**
 * Resolve the owner for a WRITE request. A user takes precedence; otherwise we
 * resolve (or create) a guest session and, when a new token was minted, set the
 * cookie on the response. Demo guests are tagged with the run id the same way
 * applicants/register tags users.demo_run_id.
 */
async function resolveOwnerForWrite(req: Request, res: Response): Promise<Owner> {
  const userId = await resolveOptionalUser(req);
  if (userId) return { kind: "user", userId };

  const demoRunId = shouldReturnDevLink(req) ? req.header("x-demo-run") ?? null : null;
  const rawToken = readCookie(req, GUEST_COOKIE_NAME);
  const { guestSessionId, newToken } = await resolveOrCreateGuestSession(
    rawToken,
    demoRunId
  );
  if (newToken) setGuestCookie(res, newToken);
  return { kind: "guest", guestSessionId };
}

/**
 * Resolve the owner for a READ request. A user takes precedence; otherwise, if
 * an existing guest cookie maps to a session, use it. We never CREATE a guest
 * session on a read — returns null when there's no owner yet (empty shortlist).
 */
async function resolveOwnerForRead(req: Request): Promise<Owner | null> {
  const userId = await resolveOptionalUser(req);
  if (userId) return { kind: "user", userId };

  const rawToken = readCookie(req, GUEST_COOKIE_NAME);
  if (!rawToken) return null;
  const res = await query(
    `UPDATE guest_sessions SET last_seen_at = NOW() WHERE token_hash = $1 RETURNING id`,
    [hashGuestToken(rawToken)]
  );
  if (res.rows.length === 0) return null;
  return { kind: "guest", guestSessionId: res.rows[0].id };
}

const saveSchema = z.object({
  propertyId: z.string().min(1).max(200), // slug or UUID — resolved below
  listName: z.string().min(1).max(120).optional(),
});

/** Resolve an incoming `propertyId` (slug OR raw UUID) to a property UUID. */
async function resolvePropertyRef(ref: string): Promise<string | null> {
  if (/^[0-9a-f-]{36}$/i.test(ref)) {
    const r = await query("SELECT id FROM properties WHERE id = $1", [ref]);
    return r.rows.length > 0 ? r.rows[0].id : null;
  }
  return resolvePropertyIdBySlug(ref);
}

// POST /saved { propertyId (slug|uuid), listName? } → upsert, returns the item.
// Sets uh_guest cookie if a new guest session was created.
router.post("/", async (req: Request, res: Response): Promise<void> => {
  try {
    const parsed = saveSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation failed", details: parsed.error.issues });
      return;
    }
    const propertyId = await resolvePropertyRef(parsed.data.propertyId);
    if (!propertyId) {
      res.status(404).json({ error: "Property not found" });
      return;
    }
    const listName = parsed.data.listName?.trim() || DEFAULT_LIST_NAME;
    const owner = await resolveOwnerForWrite(req, res);
    const item = await saveProperty(owner, propertyId, listName);
    res.status(201).json({ saved: item });
  } catch (err) {
    logger.error("Save property failed", { error: (err as Error).message });
    res.status(500).json({ error: "Failed to save property" });
  }
});

// DELETE /saved/:propertyId?listName= → unsave (idempotent).
router.delete("/:propertyId", async (req: Request, res: Response): Promise<void> => {
  try {
    const propertyId = await resolvePropertyRef(String(req.params.propertyId ?? ""));
    if (!propertyId) {
      // Nothing to unsave if the property doesn't resolve — treat as idempotent.
      res.json({ ok: true, removed: 0 });
      return;
    }
    const listName =
      typeof req.query.listName === "string" && req.query.listName.trim()
        ? req.query.listName.trim()
        : null;
    // A read-style owner: no save can exist without an owner already, so don't
    // mint a guest session on delete.
    const owner = await resolveOwnerForRead(req);
    if (!owner) {
      res.json({ ok: true, removed: 0 });
      return;
    }
    const removed = await unsaveProperty(owner, propertyId, listName);
    res.json({ ok: true, removed });
  } catch (err) {
    logger.error("Unsave property failed", { error: (err as Error).message });
    res.status(500).json({ error: "Failed to unsave property" });
  }
});

// GET /saved → the owner's shortlist grouped by list_name (empty when no owner).
router.get("/", async (req: Request, res: Response): Promise<void> => {
  try {
    const owner = await resolveOwnerForRead(req);
    if (!owner) {
      res.json({ lists: [], count: 0 });
      return;
    }
    const lists = await getShortlist(owner);
    const count = lists.reduce((n, l) => n + l.items.length, 0);
    res.json({ lists, count });
  } catch (err) {
    logger.error("List shortlist failed", { error: (err as Error).message });
    res.status(500).json({ error: "Failed to load shortlist" });
  }
});

const alertSchema = z.object({ enabled: z.boolean() });

// PATCH /saved/:propertyId/alert { enabled } → toggle vacancy alert.
router.patch("/:propertyId/alert", async (req: Request, res: Response): Promise<void> => {
  try {
    const parsed = alertSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation failed", details: parsed.error.issues });
      return;
    }
    const propertyId = await resolvePropertyRef(String(req.params.propertyId ?? ""));
    if (!propertyId) {
      res.status(404).json({ error: "Property not found" });
      return;
    }
    const owner = await resolveOwnerForRead(req);
    if (!owner) {
      res.status(404).json({ error: "Not saved" });
      return;
    }
    const item = await setAlert(owner, propertyId, parsed.data.enabled);
    if (!item) {
      res.status(404).json({ error: "Not saved" });
      return;
    }
    res.json({ saved: item });
  } catch (err) {
    logger.error("Toggle alert failed", { error: (err as Error).message });
    res.status(500).json({ error: "Failed to toggle alert" });
  }
});

// GET /saved/compare?ids=<slug|uuid>,<...> → side-by-side compare data.
router.get("/compare", async (req: Request, res: Response): Promise<void> => {
  try {
    const raw = typeof req.query.ids === "string" ? req.query.ids : "";
    const refs = raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (refs.length === 0) {
      res.status(400).json({ error: "ids query param is required" });
      return;
    }
    const owner = await resolveOwnerForRead(req);
    if (!owner) {
      res.json({ properties: [] });
      return;
    }
    const propertyIds: string[] = [];
    for (const ref of refs) {
      const id = await resolvePropertyRef(ref);
      if (id) propertyIds.push(id);
    }
    const properties = await getCompare(owner, propertyIds);
    res.json({ properties });
  } catch (err) {
    logger.error("Compare failed", { error: (err as Error).message });
    res.status(500).json({ error: "Failed to compare properties" });
  }
});

export default router;
