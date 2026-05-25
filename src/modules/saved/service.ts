import crypto from "crypto";
import { query, transaction } from "../../config/database";

// ────────────────────────────────────────────────────────────────────────────
// Saved-property shortlist service.
//
// An owner is EITHER an authenticated user (user_id) OR an anonymous guest
// session (guest_session_id), never both. The route layer resolves which one
// the caller is (JWT → user; uh_guest cookie → guest) and hands us an `Owner`.
// Every write/read here is scoped by that owner so a guest can only see/mutate
// their own shortlist, and likewise for a user.
// ────────────────────────────────────────────────────────────────────────────

export const GUEST_COOKIE_NAME = "uh_guest";
export const DEFAULT_LIST_NAME = "My list";

export type Owner =
  | { kind: "user"; userId: string }
  | { kind: "guest"; guestSessionId: string };

export function hashGuestToken(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

/** Opaque, URL-safe random cookie token (32 bytes → 43 base64url chars). */
export function generateGuestToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

/**
 * Resolve an existing guest session by its raw cookie token, or create a fresh
 * one. Returns the session id plus a `newToken` when a session was created (the
 * route sets the cookie only in that case). `demoRunId` tags demo-walkthrough
 * guests the same way users.demo_run_id tags demo signups.
 *
 * `last_seen_at` is bumped on every resolve so stale guests can be reaped later.
 */
export async function resolveOrCreateGuestSession(
  rawToken: string | null,
  demoRunId: string | null
): Promise<{ guestSessionId: string; newToken: string | null }> {
  if (rawToken) {
    const tokenHash = hashGuestToken(rawToken);
    const existing = await query(
      `UPDATE guest_sessions SET last_seen_at = NOW()
        WHERE token_hash = $1
        RETURNING id`,
      [tokenHash]
    );
    if (existing.rows.length > 0) {
      return { guestSessionId: existing.rows[0].id, newToken: null };
    }
    // Cookie present but unknown (purged session / forged value) — fall through
    // and mint a fresh session + token so the caller still gets a shortlist.
  }

  const newToken = generateGuestToken();
  const tokenHash = hashGuestToken(newToken);
  const created = await query(
    `INSERT INTO guest_sessions (token_hash, demo_run_id)
     VALUES ($1, $2)
     RETURNING id`,
    [tokenHash, demoRunId]
  );
  return { guestSessionId: created.rows[0].id, newToken };
}

/** Owner predicate + param for parameterized WHERE clauses. */
function ownerClause(owner: Owner, paramIndex: number): { sql: string; value: string } {
  return owner.kind === "user"
    ? { sql: `user_id = $${paramIndex}`, value: owner.userId }
    : { sql: `guest_session_id = $${paramIndex}`, value: owner.guestSessionId };
}

export interface SavedItem {
  id: string;
  propertyId: string;
  propertySlug: string;
  listName: string;
  alertEnabled: boolean;
  createdAt: string;
}

/**
 * Slug ↔ property lookup, identical normalization to
 * applicants/routes.ts:resolvePropertyIdBySlug (LOWER → non-alnum→'-' → trim).
 * Discover renders from slugs, so the save API speaks slugs and stores the
 * resolved UUID. Returns null when the slug matches no property.
 */
export async function resolvePropertyIdBySlug(slug: string): Promise<string | null> {
  const result = await query(
    `SELECT id
       FROM properties
      WHERE trim(BOTH '-' FROM regexp_replace(LOWER(name), '[^a-z0-9]+', '-', 'g')) = $1
      LIMIT 1`,
    [slug]
  );
  return result.rows[0]?.id ?? null;
}

/** Derive the canonical slug for a property id (for response shapes). */
function slugExpr(alias: string): string {
  return `trim(BOTH '-' FROM regexp_replace(LOWER(${alias}.name), '[^a-z0-9]+', '-', 'g'))`;
}

/**
 * Upsert a save for (owner, property, list). Idempotent: re-saving the same
 * property to the same list is a no-op that returns the existing row (the
 * partial-unique index backs the ON CONFLICT). Returns the saved item.
 */
export async function saveProperty(
  owner: Owner,
  propertyId: string,
  listName: string
): Promise<SavedItem> {
  // The unique guards are PARTIAL indexes (one per owner kind), so ON CONFLICT
  // must use index inference (columns + matching WHERE predicate) — naming the
  // index as a constraint fails ("constraint ... does not exist").
  const ownerCols =
    owner.kind === "user"
      ? { col: "user_id", val: owner.userId }
      : { col: "guest_session_id", val: owner.guestSessionId };

  const inserted = await query(
    `INSERT INTO saved_properties (${ownerCols.col}, property_id, list_name)
     VALUES ($1, $2, $3)
     ON CONFLICT (${ownerCols.col}, property_id, list_name)
       WHERE ${ownerCols.col} IS NOT NULL DO UPDATE
        SET list_name = EXCLUDED.list_name
     RETURNING id, property_id, list_name, alert_enabled, created_at`,
    [ownerCols.val, propertyId, listName]
  );

  const row = inserted.rows[0];
  const slugRes = await resolveSlug(row.property_id);
  return rowToItem(row, slugRes);
}

async function resolveSlug(propertyId: string): Promise<string> {
  const r = await query(
    `SELECT ${slugExpr("p")} AS slug FROM properties p WHERE p.id = $1`,
    [propertyId]
  );
  return r.rows[0]?.slug ?? "";
}

function rowToItem(row: Record<string, unknown>, slug: string): SavedItem {
  return {
    id: String(row.id),
    propertyId: String(row.property_id),
    propertySlug: slug,
    listName: String(row.list_name),
    alertEnabled: Boolean(row.alert_enabled),
    createdAt: new Date(row.created_at as string).toISOString(),
  };
}

/** Unsave a property for an owner. `listName` optional — when omitted, removes
 *  the property from every list the owner has it in. Idempotent (no error if
 *  nothing matched). Returns the number of rows removed. */
export async function unsaveProperty(
  owner: Owner,
  propertyId: string,
  listName: string | null
): Promise<number> {
  const o = ownerClause(owner, 1);
  const params: unknown[] = [o.value, propertyId];
  let sql = `DELETE FROM saved_properties WHERE ${o.sql} AND property_id = $2`;
  if (listName) {
    params.push(listName);
    sql += ` AND list_name = $3`;
  }
  const res = await query(sql, params);
  return res.rowCount ?? 0;
}

export interface SavedListGroup {
  listName: string;
  items: Array<
    SavedItem & {
      name: string;
      rentMin: number | null;
      rentMax: number | null;
      amiTier: string | null;
      availableCount: number;
      walkScore: number | null;
    }
  >;
}

/**
 * The owner's full shortlist, grouped by list_name, with a joined property
 * summary (name, slug, rent range, AMI tier, live availability, walk score if
 * present). `available_count` mirrors applicants/units (status='available' OR a
 * stale hold). walk_score isn't a column on properties today → always null
 * (kept in the shape so the compare table is forward-compatible).
 */
export async function getShortlist(owner: Owner): Promise<SavedListGroup[]> {
  const o = ownerClause(owner, 1);
  const result = await query(
    `SELECT sp.id, sp.property_id, sp.list_name, sp.alert_enabled, sp.created_at,
            p.name AS name,
            ${slugExpr("p")} AS slug,
            p.ami_set_aside AS ami_set_aside,
            COALESCE(av.available_count, 0) AS available_count,
            rr.rent_min AS rent_min,
            rr.rent_max AS rent_max
       FROM saved_properties sp
       JOIN properties p ON p.id = sp.property_id
       LEFT JOIN LATERAL (
         SELECT COUNT(*)::int AS available_count
           FROM units u
          WHERE u.property_id = p.id
            AND (u.status = 'available'
                 OR (u.status = 'held' AND u.claim_expires_at < NOW()))
       ) av ON true
       LEFT JOIN LATERAL (
         SELECT MIN(u.monthly_rent)::int AS rent_min,
                MAX(u.monthly_rent)::int AS rent_max
           FROM units u
          WHERE u.property_id = p.id
       ) rr ON true
      WHERE ${o.sql}
      ORDER BY sp.list_name ASC, sp.created_at ASC`,
    [o.value]
  );

  const groups = new Map<string, SavedListGroup>();
  for (const row of result.rows) {
    const listName = String(row.list_name);
    if (!groups.has(listName)) {
      groups.set(listName, { listName, items: [] });
    }
    groups.get(listName)!.items.push({
      ...rowToItem(row, String(row.slug ?? "")),
      name: String(row.name),
      rentMin: row.rent_min === null ? null : Number(row.rent_min),
      rentMax: row.rent_max === null ? null : Number(row.rent_max),
      amiTier: normalizeAmiTier(row.ami_set_aside as string | null),
      availableCount: Number(row.available_count ?? 0),
      walkScore: null,
    });
  }
  return Array.from(groups.values());
}

/** "60% AMI" → "60"; null/market-rate → null. Mirrors properties/service. */
function normalizeAmiTier(setAside: string | null): string | null {
  if (!setAside) return null;
  const digits = setAside.match(/^\d+/)?.[0];
  return digits ?? null;
}

/** Toggle the per-item vacancy alert for a saved property. Returns the updated
 *  item, or null if the owner has no save for that property. */
export async function setAlert(
  owner: Owner,
  propertyId: string,
  enabled: boolean
): Promise<SavedItem | null> {
  const o = ownerClause(owner, 1);
  const res = await query(
    `UPDATE saved_properties
        SET alert_enabled = $2
      WHERE ${o.sql} AND property_id = $3
      RETURNING id, property_id, list_name, alert_enabled, created_at`,
    [o.value, enabled, propertyId]
  );
  if (res.rows.length === 0) return null;
  const slug = await resolveSlug(res.rows[0].property_id);
  return rowToItem(res.rows[0], slug);
}

export interface CompareRow {
  propertyId: string;
  slug: string;
  name: string;
  city: string;
  rentMin: number | null;
  rentMax: number | null;
  amiTier: string | null;
  availableCount: number;
  walkScore: number | null;
}

/**
 * Compare-table data for a set of saved property ids, scoped to the owner so a
 * caller can only compare what they've actually saved. Returns rows in the same
 * order as the input ids (de-duped).
 */
export async function getCompare(
  owner: Owner,
  propertyIds: string[]
): Promise<CompareRow[]> {
  if (propertyIds.length === 0) return [];
  const o = ownerClause(owner, 1);
  const result = await query(
    `SELECT DISTINCT p.id AS property_id,
            ${slugExpr("p")} AS slug,
            p.name AS name,
            p.city AS city,
            p.ami_set_aside AS ami_set_aside,
            COALESCE(av.available_count, 0) AS available_count,
            rr.rent_min AS rent_min,
            rr.rent_max AS rent_max
       FROM saved_properties sp
       JOIN properties p ON p.id = sp.property_id
       LEFT JOIN LATERAL (
         SELECT COUNT(*)::int AS available_count
           FROM units u
          WHERE u.property_id = p.id
            AND (u.status = 'available'
                 OR (u.status = 'held' AND u.claim_expires_at < NOW()))
       ) av ON true
       LEFT JOIN LATERAL (
         SELECT MIN(u.monthly_rent)::int AS rent_min,
                MAX(u.monthly_rent)::int AS rent_max
           FROM units u
          WHERE u.property_id = p.id
       ) rr ON true
      WHERE ${o.sql} AND sp.property_id = ANY($2::uuid[])`,
    [o.value, propertyIds]
  );

  const byId = new Map<string, CompareRow>();
  for (const row of result.rows) {
    byId.set(String(row.property_id), {
      propertyId: String(row.property_id),
      slug: String(row.slug ?? ""),
      name: String(row.name),
      city: String(row.city),
      rentMin: row.rent_min === null ? null : Number(row.rent_min),
      rentMax: row.rent_max === null ? null : Number(row.rent_max),
      amiTier: normalizeAmiTier(row.ami_set_aside as string | null),
      availableCount: Number(row.available_count ?? 0),
      walkScore: null,
    });
  }
  // Preserve request order; drop ids the owner doesn't actually own.
  const seen = new Set<string>();
  const out: CompareRow[] = [];
  for (const id of propertyIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    const row = byId.get(id);
    if (row) out.push(row);
  }
  return out;
}

/**
 * Conversion hook — migrate a guest's shortlist onto a freshly-verified user.
 *
 * Called from the magic-link verify path with the raw uh_guest cookie token (if
 * the registering browser carried one). Idempotent and safe to call on every
 * verify:
 *   - No cookie / unknown token / already-converted session → no-op.
 *   - Re-points saved_properties.guest_session_id → the user, flipping the
 *     owner columns so the rows migrate in place (no re-insert).
 *   - Skips any property the user already saved to the same list (the user-side
 *     partial-unique index would otherwise reject the flip) — dropping the
 *     redundant guest row instead.
 *   - Stamps guest_sessions.converted_user_id.
 *
 * Returns the number of saved rows migrated.
 */
export async function migrateGuestSavesToUser(
  rawGuestToken: string | null,
  userId: string
): Promise<number> {
  if (!rawGuestToken) return 0;
  const tokenHash = hashGuestToken(rawGuestToken);

  return transaction(async (client) => {
    const sessionRes = await client.query(
      `SELECT id, converted_user_id FROM guest_sessions
        WHERE token_hash = $1
        FOR UPDATE`,
      [tokenHash]
    );
    if (sessionRes.rows.length === 0) return 0;
    const session = sessionRes.rows[0];
    // Already converted (idempotent re-verify, or a shared cookie) → no-op.
    if (session.converted_user_id) return 0;
    const guestSessionId = session.id;

    // Re-point only guest rows that DON'T collide with an existing user save
    // for the same (property, list). The NOT EXISTS guard is evaluated by the
    // UPDATE itself, so it also covers a user save that lands concurrently
    // between this migration's start and the re-point (the prior approach —
    // a separate DELETE-then-blanket-UPDATE — left a window where such a save
    // would make the UPDATE violate uq_saved_properties_user and abort the
    // whole best-effort migration, silently dropping the guest's list).
    const migrated = await client.query(
      `UPDATE saved_properties g
          SET user_id = $2, guest_session_id = NULL
        WHERE g.guest_session_id = $1
          AND NOT EXISTS (
            SELECT 1 FROM saved_properties u
             WHERE u.user_id = $2
               AND u.property_id = g.property_id
               AND u.list_name = g.list_name
          )`,
      [guestSessionId, userId]
    );

    // Whatever's still owned by the guest session collided with a user row the
    // user already has — drop the redundant guest copies so the session is
    // fully drained before it's marked converted.
    await client.query(
      `DELETE FROM saved_properties WHERE guest_session_id = $1`,
      [guestSessionId]
    );

    await client.query(
      `UPDATE guest_sessions SET converted_user_id = $2, last_seen_at = NOW()
        WHERE id = $1`,
      [guestSessionId, userId]
    );

    return migrated.rowCount ?? 0;
  });
}
