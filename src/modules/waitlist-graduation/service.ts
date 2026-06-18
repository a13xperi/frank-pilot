import { query, transaction } from "../../config/database";
import { logger } from "../../utils/logger";
import { stampTape } from "../tape";
import { deriveIdentityKey, type IdentityKey } from "./identity";

/**
 * Waitlist → application graduation + global relationship-ID dedup (Frank core C5).
 *
 * Two capabilities, both keyed off the cross-property identity (phone + DOB):
 *
 *   1. resolveRelationshipId — find-or-create a person_identities row for a
 *      (phone, DOB) pair and return its relationship_id. This is the dedup
 *      primitive: any island row (application, waitlist entry) can call it to
 *      learn "which human is this".
 *
 *   2. graduateWaitlistEntry — promote a waitlist_entries row into an
 *      `applications` draft, carrying the applicant's user profile + the
 *      resolved relationship_id across. Idempotent: a second call returns the
 *      already-produced application instead of minting a duplicate draft.
 *
 * Everything is fail-safe on the identity side: a row we can't key (missing or
 * unparseable phone/DOB) still graduates, just with relationship_id = NULL.
 */

export interface ResolveIdentityInput {
  phone: string | null | undefined;
  dob: string | Date | null | undefined;
  displayName?: string | null;
}

export interface ResolvedIdentity {
  relationshipId: string;
  identityHash: string;
  dobHash: string;
  /** True when this call created the identity (first time we've seen the person). */
  created: boolean;
}

/**
 * Find-or-create the person_identities row for a (phone, DOB) pair.
 *
 * Returns null when the pair can't be keyed (caller leaves relationship_id
 * NULL). On a hit, refreshes the denormalized display fields + last_seen_at and
 * bumps linked_count. The UNIQUE(identity_hash) makes this a single race-safe
 * upsert.
 */
export async function resolveRelationshipId(
  input: ResolveIdentityInput
): Promise<ResolvedIdentity | null> {
  const key = deriveIdentityKey(input.phone, input.dob);
  if (!key) return null;
  return upsertIdentity(key, input.displayName ?? null);
}

async function upsertIdentity(
  key: IdentityKey,
  displayName: string | null
): Promise<ResolvedIdentity> {
  const result = await query(
    `INSERT INTO person_identities
       (identity_hash, display_name, phone_last4, linked_count, last_seen_at)
     VALUES ($1, $2, $3, 1, NOW())
     ON CONFLICT (identity_hash) DO UPDATE SET
       display_name = COALESCE(EXCLUDED.display_name, person_identities.display_name),
       phone_last4  = COALESCE(EXCLUDED.phone_last4, person_identities.phone_last4),
       linked_count = person_identities.linked_count + 1,
       last_seen_at = NOW()
     RETURNING id, (xmax = 0) AS created`,
    [key.identityHash, displayName, key.phoneLast4]
  );
  const row = result.rows[0];
  return {
    relationshipId: row.id as string,
    identityHash: key.identityHash,
    dobHash: key.dobHash,
    created: Boolean(row.created),
  };
}

export interface GraduateInput {
  waitlistEntryId: string;
  actorId: string | null;
  /** Optional override for the application's requested move-in date. */
  requestedMoveInDate?: string | null;
}

export interface GraduateResult {
  applicationId: string;
  relationshipId: string | null;
  /** True when this call created the application; false on an idempotent re-run. */
  created: boolean;
}

interface WaitlistRow {
  id: string;
  property_id: string;
  bedroom_count: number;
  applicant_user_id: string;
  graduated_application_id: string | null;
  // joined from users
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  // joined from the user's most recent application (for the DOB component)
  dob_encrypted: string | null;
  dob_hint: string | null;
}

/**
 * Promote one waitlist_entries row into an `applications` draft.
 *
 * Idempotency: the waitlist row records graduated_application_id; if it's
 * already set we short-circuit and return it (created:false). The promotion +
 * the back-reference write happen in one transaction so a crash can't leave a
 * draft without its waitlist back-link.
 *
 * Identity: we derive the relationship_id from the applicant's phone + DOB.
 * DOB is not on the users table — it lives encrypted on applications — so we
 * read the DOB *hash component* from the most recent prior application for this
 * user (if any). If the user has no prior application with a DOB, the draft is
 * created with relationship_id NULL (and dob_hash NULL); a later step that
 * collects DOB can re-link via resolveRelationshipId.
 *
 * Throws {code:'WAITLIST_ENTRY_NOT_FOUND'} for an unknown id.
 */
export async function graduateWaitlistEntry(
  input: GraduateInput
): Promise<GraduateResult> {
  const entryRes = await query(
    `SELECT
        w.id, w.property_id, w.bedroom_count, w.applicant_user_id,
        w.graduated_application_id,
        u.first_name, u.last_name, u.email, u.phone,
        a.date_of_birth_encrypted AS dob_encrypted,
        a.dob_hash AS dob_hint
       FROM waitlist_entries w
       JOIN users u ON u.id = w.applicant_user_id
       LEFT JOIN LATERAL (
         SELECT date_of_birth_encrypted, dob_hash
           FROM applications
          WHERE phone = u.phone AND dob_hash IS NOT NULL
          ORDER BY created_at DESC
          LIMIT 1
       ) a ON TRUE
      WHERE w.id = $1
      LIMIT 1`,
    [input.waitlistEntryId]
  );
  if (entryRes.rows.length === 0) {
    throw Object.assign(new Error("waitlist entry not found"), {
      code: "WAITLIST_ENTRY_NOT_FOUND",
    });
  }
  const entry = entryRes.rows[0] as WaitlistRow;

  // Idempotent re-run.
  if (entry.graduated_application_id) {
    logger.info("Waitlist graduation: already graduated, returning existing", {
      waitlistEntryId: entry.id,
      applicationId: entry.graduated_application_id,
    });
    return {
      applicationId: entry.graduated_application_id,
      relationshipId: null,
      created: false,
    };
  }

  // Resolve identity. We only have a DOB *hash* available without decrypting,
  // so reuse it directly when present (the prior application already keyed this
  // person); otherwise leave the draft unlinked.
  let relationshipId: string | null = null;
  let dobHash: string | null = null;
  if (entry.dob_hint) {
    // The prior application already carries a relationship_id keyed on the same
    // (phone, DOB); reuse its identity by hash so we don't need the raw DOB.
    const link = await query(
      `SELECT relationship_id FROM applications
        WHERE dob_hash = $1 AND relationship_id IS NOT NULL
        ORDER BY created_at DESC LIMIT 1`,
      [entry.dob_hint]
    );
    relationshipId = (link.rows[0]?.relationship_id as string) ?? null;
    dobHash = entry.dob_hint;
    if (relationshipId) {
      await query(
        `UPDATE person_identities
            SET linked_count = linked_count + 1, last_seen_at = NOW()
          WHERE id = $1`,
        [relationshipId]
      );
    }
  }

  const fullName = `${entry.first_name ?? ""} ${entry.last_name ?? ""}`.trim() || null;

  const created = await transaction(async (client) => {
    const inserted = await client.query(
      `INSERT INTO applications (
         property_id, first_name, last_name, email, phone,
         household_size, status, requested_move_in_date,
         relationship_id, dob_hash, submitted_by
       )
       VALUES ($1, $2, $3, $4, $5, 1, 'draft', $6, $7, $8, $9)
       RETURNING id`,
      [
        entry.property_id,
        entry.first_name ?? "Unknown",
        entry.last_name ?? "—",
        entry.email,
        entry.phone,
        input.requestedMoveInDate ?? null,
        relationshipId,
        dobHash,
        input.actorId,
      ]
    );
    const applicationId = inserted.rows[0].id as string;

    // Stamp the relationship onto the waitlist row + record graduation so the
    // operation is idempotent and the footprint is linkable.
    await client.query(
      `UPDATE waitlist_entries
          SET graduated_application_id = $1,
              graduated_at = NOW(),
              relationship_id = COALESCE($2, relationship_id)
        WHERE id = $3`,
      [applicationId, relationshipId, entry.id]
    );

    return applicationId;
  });

  void stampTape({
    kind: "WAITING_LIST_APP_CAPTURED",
    actor: input.actorId,
    sessionId: `grad:${entry.id}`,
    payload: {
      waitlistEntryId: entry.id,
      applicationId: created,
      propertyId: entry.property_id,
      bedroomCount: entry.bedroom_count,
      relationshipId,
      hasName: Boolean(fullName),
    },
  });

  logger.info("Waitlist entry graduated to application draft", {
    waitlistEntryId: entry.id,
    applicationId: created,
    relationshipId,
  });

  return { applicationId: created, relationshipId, created: true };
}
