/**
 * FCRA consumer-report authorization capture (§1681b).
 *
 * Before Frank — the END USER procuring the report — pulls a Checkr background
 * or TransUnion ShareAble credit report on an applicant (dark behind
 * CONSUMER_REPORT_ENABLED, see application/service.ts submit()), the applicant
 * must be shown a clear-and-conspicuous disclosure and must authorize the pull.
 * The CRA hosts its own KBA + completion flow, but the FCRA permissible-purpose
 * authorization is Frank's obligation, so we capture and durably record it here.
 *
 * This is the SERVER-SIDE capture. The in-app consent checkbox UX lives in the
 * apply wizard (a separate, focused change behind the frozen tenant-e2e Step
 * union — see docs/screening/background-credit-cra-adapter.md §8); the wizard
 * posts the affirmation to /me/applications/submit-draft, which calls
 * recordAuthorization() before any report order is created.
 *
 * The evidentiary record (who / when / which disclosure version / the exact
 * disclosure text shown AND its SHA-256 hash / capture method / IP / UA) mirrors
 * the ESIGN/UETA `lease_signatures` record. The exact text is retained on the
 * row — not merely referenced by version — so the recorded hash stays verifiable
 * against immutable text forever, even after FCRA_DISCLOSURE_VERSION is bumped
 * and the source constant below changes (see verifyStoredAuthorization).
 * One authorization per application — first wins,
 * re-submits idempotent (consumer_report_authorizations.application_id UNIQUE,
 * written ON CONFLICT DO NOTHING).
 *
 * Nothing here runs unless CONSUMER_REPORT_ENABLED is on (the caller gates it).
 */

import { createHash } from "crypto";
import { query } from "../../config/database";
import { writeAuditLog } from "../../middleware/audit";

/**
 * Version of the disclosure text below. Bump this string whenever the wording
 * changes — an authorization captured against a superseded version no longer
 * satisfies §1681b for a fresh pull (see hasValidAuthorization). The applicant
 * must re-review and re-authorize against the current version.
 */
export const FCRA_DISCLOSURE_VERSION = "2026-06-01";

/**
 * Clear-and-conspicuous disclosure shown to the applicant before they authorize
 * the consumer-report pull. Kept as a frozen constant so its SHA-256 hash is
 * stable and reproducible — the hash is the tamper-evidence that this exact text
 * was presented. Do not reformat without bumping FCRA_DISCLOSURE_VERSION.
 */
export const FCRA_DISCLOSURE_TEXT = [
  "CONSUMER REPORT AUTHORIZATION — TENANT SCREENING",
  "",
  "As part of your rental application, the property and the consumer reporting",
  "agencies it uses (a background-screening agency and a credit-reporting",
  "agency) will obtain consumer reports about you for the purpose of evaluating",
  "your application for housing. These reports may include criminal-history,",
  "eviction-history, and credit information.",
  "",
  "These reports will be used solely to evaluate your tenancy application — a",
  "permissible purpose under the Fair Credit Reporting Act (FCRA), 15 U.S.C.",
  "§ 1681 et seq. You have rights under the FCRA, including the right to obtain a",
  "copy of any report procured about you and the right to dispute information you",
  "believe is inaccurate or incomplete. A Summary of Your Rights Under the FCRA",
  "is available to you.",
  "",
  "By authorizing below, you (1) acknowledge that you have read and understood",
  "this disclosure and (2) authorize the property and its consumer reporting",
  "agencies to obtain the consumer reports described above in connection with",
  "your rental application. This authorization remains valid for the duration of",
  "your application.",
].join("\n");

/** SHA-256 of the disclosure text actually shown — the tamper-evidence anchor. */
export function fcraDisclosureHash(text: string = FCRA_DISCLOSURE_TEXT): string {
  return createHash("sha256").update(text).digest("hex");
}

/** The disclosure payload served to the client so it can render + hash-match. */
export function getDisclosure(): { version: string; text: string; hash: string } {
  return {
    version: FCRA_DISCLOSURE_VERSION,
    text: FCRA_DISCLOSURE_TEXT,
    hash: fcraDisclosureHash(),
  };
}

export interface StoredAuthorization {
  applicationId: string;
  applicantId: string | null;
  disclosureVersion: string;
  disclosureHash: string;
  disclosureText: string;
  method: string;
  authorizedAt: string; // ISO-8601
}

/** Read the single authorization for an application (null if none). */
export async function getAuthorization(
  applicationId: string
): Promise<StoredAuthorization | null> {
  const res = await query(
    `SELECT application_id, applicant_id, disclosure_version, disclosure_hash,
            disclosure_text, method, authorized_at
       FROM consumer_report_authorizations
      WHERE application_id = $1`,
    [applicationId]
  );
  if (res.rows.length === 0) return null;
  const r = res.rows[0] as Record<string, unknown>;
  return {
    applicationId: r.application_id as string,
    applicantId: (r.applicant_id as string) ?? null,
    disclosureVersion: r.disclosure_version as string,
    disclosureHash: r.disclosure_hash as string,
    disclosureText: r.disclosure_text as string,
    method: r.method as string,
    authorizedAt: new Date(r.authorized_at as string).toISOString(),
  };
}

/**
 * Re-derive the hash from the disclosure text RETAINED on the authorization row
 * and confirm it matches the hash recorded at authorization time. Because the
 * exact text is persisted per-row, this remains verifiable indefinitely — even
 * for a superseded disclosure version whose text no longer exists in source.
 * `intact: false` means the retained text and recorded hash disagree (tamper or
 * corruption); `found: false` means there is no authorization to verify.
 */
export async function verifyStoredAuthorization(
  applicationId: string
): Promise<{ found: boolean; intact: boolean }> {
  const a = await getAuthorization(applicationId);
  if (!a) return { found: false, intact: false };
  return { found: true, intact: fcraDisclosureHash(a.disclosureText) === a.disclosureHash };
}

/**
 * True only if a recorded authorization exists AND was captured against the
 * CURRENT disclosure version. An authorization against a superseded disclosure
 * does not satisfy §1681b for a fresh pull.
 */
export async function hasValidAuthorization(applicationId: string): Promise<boolean> {
  const a = await getAuthorization(applicationId);
  return !!a && a.disclosureVersion === FCRA_DISCLOSURE_VERSION;
}

/**
 * Record the applicant's authorization to procure consumer reports. Idempotent:
 * the FIRST authorization wins (application_id is UNIQUE, written ON CONFLICT DO
 * NOTHING) and the audit entry is written only on a genuinely-new capture. The
 * returned `authorizedAt` is the server-trusted timestamp of that first
 * authorization — the caller stamps it onto applications.screening_authorization_at
 * so the pull is provably tied to a real authorization rather than order-creation.
 *
 * Throws if the supplied disclosure version is stale (the applicant must
 * re-review the current disclosure and re-authorize) — fail-loud, never an
 * implicit authorization.
 */
export async function recordAuthorization(input: {
  applicationId: string;
  applicantId?: string | null;
  applicantRole?: string | null;
  disclosureVersion?: string;
  method?: string;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<{ authorizedAt: string; alreadyRecorded: boolean }> {
  const version = input.disclosureVersion ?? FCRA_DISCLOSURE_VERSION;
  if (version !== FCRA_DISCLOSURE_VERSION) {
    throw new Error(
      `Stale FCRA disclosure version '${version}' (current '${FCRA_DISCLOSURE_VERSION}'). ` +
        `The applicant must review the current disclosure and re-authorize.`
    );
  }
  const disclosureHash = fcraDisclosureHash();
  const method = input.method ?? "in_app_checkbox";

  // Retain the EXACT text whose hash we record, so the authorization stays
  // self-provably verifiable even after FCRA_DISCLOSURE_TEXT is later changed.
  const inserted = await query(
    `INSERT INTO consumer_report_authorizations
       (application_id, applicant_id, applicant_role, disclosure_version,
        disclosure_hash, disclosure_text, method, authorized_ip, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (application_id) DO NOTHING
     RETURNING authorized_at`,
    [
      input.applicationId,
      input.applicantId ?? null,
      input.applicantRole ?? null,
      version,
      disclosureHash,
      FCRA_DISCLOSURE_TEXT,
      method,
      input.ip ?? null,
      input.userAgent ?? null,
    ]
  );

  if (inserted.rows.length > 0) {
    await writeAuditLog({
      action: "consumer_report_authorized",
      actorId: input.applicantId ?? undefined,
      actorRole: input.applicantRole ?? undefined,
      applicationId: input.applicationId,
      resourceType: "consumer_report_authorization",
      resourceId: input.applicationId,
      details: { disclosureVersion: version, disclosureHash, method },
      ipAddress: input.ip ?? undefined,
      userAgent: input.userAgent ?? undefined,
    });
    return {
      authorizedAt: new Date(inserted.rows[0].authorized_at as string).toISOString(),
      alreadyRecorded: false,
    };
  }

  // Conflict — already authorized. Return the FIRST authorization's timestamp.
  const existing = await getAuthorization(input.applicationId);
  if (!existing) {
    // Conflict fired but the row is gone — never silently proceed.
    throw new Error(
      `Consumer-report authorization conflict for ${input.applicationId} but no record found`
    );
  }
  return { authorizedAt: existing.authorizedAt, alreadyRecorded: true };
}
