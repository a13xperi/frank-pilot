import crypto from "crypto";
import { query } from "../../config/database";

/**
 * Voice verification + caller-history service (Phase 2).
 *
 * Pure-ish business logic behind the two in-call ElevenLabs server tools
 * (send_verification, get_caller_history). The tool-handlers wrap this and
 * own the ToolCallbackResult shaping; this module owns:
 *   - minting + storing a short numeric code (hashed, TTL'd, attempt-counted)
 *   - verifying a read-back code (defense-in-depth verified flag)
 *   - resolving a caller (phone / applicant_id / email) to an applications row
 *   - summarizing + redacting prior voice_intake_calls into one or two sentences
 *
 * Code storage mirrors magic_link_tokens: only the SHA-256 hash is persisted,
 * never the raw digits. The raw code is returned UP the call stack exactly once
 * (so the agent can read it back to the caller — intentional, per product
 * design) and is never logged.
 */

const CODE_TTL_MINUTES = 10;
const MAX_VERIFY_ATTEMPTS = 5;

function hashCode(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

/** Mint a 4-digit numeric code as a zero-padded string ("0042" is valid). */
export function mintCode(): string {
  // crypto.randomInt is uniform over [0, 10000); pad to a fixed 4-char width.
  const n = crypto.randomInt(0, 10000);
  return String(n).padStart(4, "0");
}

/** Last-4 masked phone for return payloads + logs. Never echo the full E.164. */
export function maskPhone(phone: string | null): string {
  if (!phone) return "****";
  const trimmed = phone.trim();
  if (trimmed.length <= 4) return "****";
  return `***${trimmed.slice(-4)}`;
}

export interface IssuedCode {
  code: string; // raw — for read-back only, never persisted/logged
  id: string;
}

/**
 * Mint a code for this conversation, store its hash with a TTL, and return the
 * raw code to the caller. Each call inserts a fresh row; the latest live row
 * for a conversation is the one verifyCode checks.
 */
export async function issueCode(args: {
  conversationId: string;
  phone: string | null;
  applicantId: string | null;
}): Promise<IssuedCode> {
  const code = mintCode();
  const codeHash = hashCode(code);
  const expiresAt = new Date(Date.now() + CODE_TTL_MINUTES * 60 * 1000);

  const inserted = await query(
    `INSERT INTO voice_verification_codes
       (conversation_id, code_hash, phone, applicant_id, expires_at)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [args.conversationId, codeHash, args.phone, args.applicantId, expiresAt]
  );

  return { code, id: inserted.rows[0].id as string };
}

export type VerifyOutcome =
  | "verified"
  | "mismatch"
  | "expired"
  | "no_code"
  | "too_many_attempts";

/**
 * Verify a read-back code against the latest live code for a conversation.
 * Bumps the attempts counter on every attempt; marks used_at + verified_at on
 * the first match. Idempotent on an already-verified row (returns "verified").
 */
export async function verifyCode(
  conversationId: string,
  submitted: string
): Promise<VerifyOutcome> {
  const normalized = submitted.replace(/\D/g, "");
  const latest = await query(
    `SELECT id, code_hash, expires_at, used_at, verified_at, attempts
       FROM voice_verification_codes
      WHERE conversation_id = $1
      ORDER BY created_at DESC
      LIMIT 1`,
    [conversationId]
  );
  if (latest.rows.length === 0) return "no_code";

  const row = latest.rows[0];

  // Already verified — idempotent success (caller re-confirms, agent proceeds).
  if (row.verified_at) return "verified";

  if (row.attempts >= MAX_VERIFY_ATTEMPTS) return "too_many_attempts";

  // Always count the attempt, even on expiry/mismatch.
  await query(
    `UPDATE voice_verification_codes SET attempts = attempts + 1 WHERE id = $1`,
    [row.id]
  );

  if (new Date(row.expires_at) < new Date()) return "expired";
  if (row.used_at) return "verified";

  if (!normalized || hashCode(normalized) !== row.code_hash) return "mismatch";

  await query(
    `UPDATE voice_verification_codes
        SET used_at = NOW(), verified_at = NOW()
      WHERE id = $1`,
    [row.id]
  );
  return "verified";
}

/**
 * Defense-in-depth: has THIS conversation been verified server-side? The
 * primary identity gate is the agent prompt; this lets get_caller_history
 * reflect a `verified` flag without trusting the agent to track it.
 */
export async function isConversationVerified(
  conversationId: string
): Promise<boolean> {
  const res = await query(
    `SELECT 1
       FROM voice_verification_codes
      WHERE conversation_id = $1
        AND verified_at IS NOT NULL
      LIMIT 1`,
    [conversationId]
  );
  return res.rows.length > 0;
}

export interface ResolvedApplicant {
  id: string;
  status: string | null;
  email: string | null;
}

/**
 * Resolve a caller to an applications row by, in priority order:
 *   1. applicant_id (a direct applications.id)
 *   2. email
 *   3. phone (normalized E.164)
 * Returns the most-recently-updated match. NULL when nothing resolves.
 * Includes the applicant email so the caller can mint a portal magic-link via
 * the existing createMagicLink(email) service.
 */
export async function resolveApplicant(args: {
  applicantId?: string | null;
  email?: string | null;
  phone?: string | null;
}): Promise<ResolvedApplicant | null> {
  if (args.applicantId) {
    const res = await query(
      `SELECT id, status, email FROM applications WHERE id = $1 LIMIT 1`,
      [args.applicantId]
    );
    if (res.rows.length > 0) return toResolved(res.rows[0]);
  }

  if (args.email) {
    const res = await query(
      `SELECT id, status, email FROM applications
        WHERE LOWER(email) = LOWER($1)
        ORDER BY updated_at DESC NULLS LAST
        LIMIT 1`,
      [args.email]
    );
    if (res.rows.length > 0) return toResolved(res.rows[0]);
  }

  if (args.phone) {
    const res = await query(
      `SELECT id, status, email FROM applications
        WHERE phone = $1
        ORDER BY updated_at DESC NULLS LAST
        LIMIT 1`,
      [args.phone]
    );
    if (res.rows.length > 0) return toResolved(res.rows[0]);
  }

  return null;
}

function toResolved(row: Record<string, unknown>): ResolvedApplicant {
  return {
    id: row.id as string,
    status: rowStatus(row),
    email: typeof row.email === "string" && row.email ? row.email : null,
  };
}

function rowStatus(row: Record<string, unknown>): string | null {
  const s = row.status;
  return typeof s === "string" && s ? s : null;
}

export interface CallerHistory {
  found: boolean;
  lastContact: string | null; // YYYY-MM-DD
  summary: string;
}

const RECENT_CALL_LIMIT = 3;

/**
 * Summarize the last few voice_intake_calls for a resolved applicant into one
 * or two plain sentences the agent can speak. REDACTION: only call dates and a
 * short, non-sensitive topic phrase derived from data_collection_results keys
 * leave this function — never raw field VALUES (which can carry PII like
 * income, SSN fragments, addresses). Application status is appended when known.
 */
export async function summarizeHistory(
  applicantId: string,
  status: string | null
): Promise<CallerHistory> {
  const res = await query(
    `SELECT started_at, data_collection_results
       FROM voice_intake_calls
      WHERE applicant_id = $1
      ORDER BY started_at DESC
      LIMIT $2`,
    [applicantId, RECENT_CALL_LIMIT]
  );

  if (res.rows.length === 0) {
    // Resolved the applicant but no prior calls on record.
    const statusSentence = status ? ` Your application is currently ${humanizeStatus(status)}.` : "";
    return {
      found: Boolean(status),
      lastContact: null,
      summary: status
        ? `I don't have a prior call on record yet, but I can see your application.${statusSentence}`.trim()
        : "I don't have any prior calls on record for you yet.",
    };
  }

  const dates = res.rows.map((r) => toDateString(r.started_at)).filter(Boolean) as string[];
  const lastContact = dates[0] ?? null;

  const topics = collectTopics(res.rows.map((r) => r.data_collection_results));
  const callWord = res.rows.length === 1 ? "call" : "calls";

  let summary = lastContact
    ? `I see ${res.rows.length} prior ${callWord}; we last spoke on ${lastContact}.`
    : `I see ${res.rows.length} prior ${callWord} on record.`;

  if (topics.length > 0) {
    summary += ` We talked about ${joinTopics(topics)}.`;
  }
  if (status) {
    summary += ` Your application is currently ${humanizeStatus(status)}.`;
  }

  return { found: true, lastContact, summary };
}

/**
 * Pull a small set of human-friendly TOPIC phrases from the data_collection
 * field KEYS only — never the captured values. A curated label map keeps the
 * spoken summary clean ("their name and contact info") and PII-free.
 */
function collectTopics(blobs: unknown[]): string[] {
  const LABELS: Record<string, string> = {
    first_name: "your name",
    last_name: "your name",
    name: "your name",
    phone: "your contact info",
    email: "your contact info",
    move_in_date: "your move-in timing",
    requested_move_in_date: "your move-in timing",
    household_size: "your household",
    income: "income",
    annual_income: "income",
    maintenance: "a maintenance issue",
    work_order: "a maintenance issue",
    property: "a property you're interested in",
    unit: "a unit you're interested in",
    callback: "scheduling a callback",
  };

  const seen = new Set<string>();
  for (const blob of blobs) {
    if (!blob || typeof blob !== "object") continue;
    for (const key of Object.keys(blob as Record<string, unknown>)) {
      const label = LABELS[key.toLowerCase()];
      if (label) seen.add(label);
    }
  }
  // Cap at three topics so the spoken line stays short.
  return Array.from(seen).slice(0, 3);
}

function joinTopics(topics: string[]): string {
  if (topics.length === 1) return topics[0];
  if (topics.length === 2) return `${topics[0]} and ${topics[1]}`;
  return `${topics.slice(0, -1).join(", ")}, and ${topics[topics.length - 1]}`;
}

function toDateString(value: unknown): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function humanizeStatus(status: string): string {
  return status.replace(/_/g, " ");
}

/** Exposed for the test harness only — not part of the public surface. */
export const __test = {
  hashCode,
  CODE_TTL_MINUTES,
  MAX_VERIFY_ATTEMPTS,
  collectTopics,
  toDateString,
};
