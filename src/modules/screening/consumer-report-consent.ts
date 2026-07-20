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
import { redactSensitiveStrings } from "../../utils/pii-filter";

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

/**
 * Capture-method values for VOICE consent (audit C4). A voice tool call
 * carries only a caller-controlled `consent_acknowledged` boolean — a forged
 * or over-eager tool call can assert consent that was never given. So a
 * voice-minted authorization is recorded as UNVERIFIED, pending transcript
 * evidence: when the post-call webhook delivers the transcript, the recorded
 * turns are checked for the read disclosure + the caller's affirmative, and
 * the row is upgraded to VERIFIED with the matched snippets stamped on it
 * (see verifyVoiceAuthorizationForConversation). Rows that never verify stay
 * `voice_verbal_unverified` — the honest, reviewable state.
 */
export const METHOD_VOICE_VERBAL_UNVERIFIED = "voice_verbal_unverified";
export const METHOD_VOICE_VERBAL_VERIFIED = "voice_verbal_verified";

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
  /**
   * The ElevenLabs conversation that minted this authorization (voice methods
   * only, audit C4). This is the evidence anchor: the post-call transcript
   * verification finds the row by it, and a reviewer can pull the exact call
   * via voice_intake_calls.transcript_url.
   */
  conversationId?: string | null;
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
        disclosure_hash, disclosure_text, method, authorized_ip, user_agent,
        conversation_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
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
      input.conversationId ?? null,
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
      details: {
        disclosureVersion: version,
        disclosureHash,
        method,
        ...(input.conversationId ? { conversationId: input.conversationId } : {}),
      },
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

// ─── Voice consent transcript verification (audit C4) ────────────────────────

/** One turn of the ElevenLabs post-call transcript, as the webhook delivers it. */
export interface TranscriptTurn {
  role?: string;
  message?: string;
}

export interface DisclosureEvidence {
  found: boolean;
  /** Heuristic identifier stamped into verification_evidence for auditability. */
  matcher: "transcript-disclosure-v1";
  agentTurn?: number;
  userTurn?: number;
  agentSnippet?: string;
  userSnippet?: string;
}

// The spoken disclosure necessarily names the report types being pulled.
const DISCLOSURE_PATTERN = /(background.*credit|credit.*background|consumer report)/is;
const AFFIRMATIVE_PATTERN =
  /\b(yes|yeah|yep|yup|sure|correct|absolutely|of course|go ahead|sounds good|that'?s fine|okay|ok|i (do|agree|authorize|consent))\b/i;
const DECLINE_PATTERN = /\b(no|nope|don'?t|do not|decline|refuse|stop)\b/i;

// Evidence snippets are transcript text — pii-filter them (audit C1) before
// they land on the authorization row / audit log.
function snippet(s: string): string {
  const clean = redactSensitiveStrings(s);
  return clean.length > 240 ? `${clean.slice(0, 240)}…` : clean;
}

/**
 * Scan a post-call transcript for evidence the FCRA disclosure was actually
 * read and affirmed: an AGENT turn naming the reports (background + credit,
 * or "consumer report"), followed by a USER turn that affirms before any
 * user turn that declines. Pure + exported so the heuristic is unit-testable
 * and its verdict auditable (the matcher id + matched snippets are stamped
 * onto the authorization row).
 *
 * Deliberately conservative: no match → the authorization simply STAYS
 * `voice_verbal_unverified` for human review. It never downgrades or deletes.
 */
export function findDisclosureEvidence(
  transcript: ReadonlyArray<TranscriptTurn>
): DisclosureEvidence {
  const notFound: DisclosureEvidence = { found: false, matcher: "transcript-disclosure-v1" };
  for (let i = 0; i < transcript.length; i++) {
    const turn = transcript[i];
    if (turn.role !== "agent" || !turn.message) continue;
    if (!DISCLOSURE_PATTERN.test(turn.message)) continue;

    // Disclosure turn found — look for the caller's affirmative after it.
    for (let j = i + 1; j < transcript.length; j++) {
      const reply = transcript[j];
      if (reply.role !== "user" || !reply.message) continue;
      if (AFFIRMATIVE_PATTERN.test(reply.message)) {
        return {
          found: true,
          matcher: "transcript-disclosure-v1",
          agentTurn: i,
          userTurn: j,
          agentSnippet: snippet(turn.message),
          userSnippet: snippet(reply.message),
        };
      }
      if (DECLINE_PATTERN.test(reply.message)) break; // declined THIS disclosure — try a later one
    }
  }
  return notFound;
}

/**
 * Post-call upgrade for voice-minted authorizations (audit C4). The voice
 * tools record consent as `voice_verbal_unverified` (the tool's boolean is
 * caller-controlled); the post-call webhook calls this with the delivered
 * transcript. When the transcript shows the read disclosure + the caller's
 * affirmative, the row is upgraded to `voice_verbal_verified` with the
 * matched snippets stamped in `verification_evidence` and an audit entry.
 * No evidence → the row stays unverified for review; nothing is downgraded.
 * Idempotent: only rows still marked unverified are touched, so the second
 * webhook delivery (post_call_audio) is a no-op.
 */
export async function verifyVoiceAuthorizationForConversation(
  conversationId: string,
  transcript: ReadonlyArray<TranscriptTurn> | undefined | null
): Promise<{ checked: number; verified: number }> {
  const pending = await query(
    `SELECT application_id FROM consumer_report_authorizations
      WHERE conversation_id = $1 AND method = $2`,
    [conversationId, METHOD_VOICE_VERBAL_UNVERIFIED]
  );
  if (pending.rows.length === 0) return { checked: 0, verified: 0 };

  const evidence = findDisclosureEvidence(transcript ?? []);
  if (!evidence.found) {
    return { checked: pending.rows.length, verified: 0 };
  }

  const upgraded = await query(
    `UPDATE consumer_report_authorizations
        SET method = $3,
            verified_at = NOW(),
            verification_evidence = $4::jsonb
      WHERE conversation_id = $1 AND method = $2
      RETURNING application_id`,
    [
      conversationId,
      METHOD_VOICE_VERBAL_UNVERIFIED,
      METHOD_VOICE_VERBAL_VERIFIED,
      JSON.stringify(evidence),
    ]
  );

  for (const row of upgraded.rows as Array<{ application_id: string }>) {
    await writeAuditLog({
      action: "consumer_report_consent_verified",
      applicationId: row.application_id,
      resourceType: "consumer_report_authorization",
      resourceId: row.application_id,
      details: { conversationId, ...evidence },
    });
  }

  return { checked: pending.rows.length, verified: upgraded.rows.length };
}
