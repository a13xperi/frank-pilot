import { query } from "../../config/database";
import { logger } from "../../utils/logger";
import {
  createMagicLink,
  logMagicLink,
  sendMagicLinkSms,
} from "../auth/magic-link-service";
import { normalizePhone } from "./service";
import {
  registerToolHandler,
  type ToolCallbackContext,
  type ToolCallbackResult,
} from "./tool-callbacks";

// Short link to the 90-second onboarding walkthrough (frank-go /onboard 302s to
// the hosted video). Env-configurable so it's swappable per env/property/cut
// without a code change.
const ONBOARDING_VIDEO_URL =
  process.env.ONBOARDING_VIDEO_URL || "https://frank-go.vercel.app/onboard";

/**
 * Phase B voice tool: `send_app_link`.
 *
 * Mid-call, Frank asks the caller "want me to text you a link to finish in
 * the app?" Yes → ElevenLabs fires this tool with `{phone, first_name?,
 * last_name?}` extracted from the conversation. We find-or-create an
 * applicant user keyed on phone, issue a magic-link with the conversation_id
 * threaded through the deep link, and SMS it. The wizard on the other side
 * reads `?intake=<conversation_id>` and calls the prefill endpoint to
 * hydrate the form from the data_collection captured in-call.
 *
 * Why find-or-create instead of bouncing off /applicants/register:
 *   - The register handler requires `email` and z-validates it. Voice
 *     callers rarely spell email reliably; phone is the channel we have.
 *   - We do NOT want a constant-time-budgeted public endpoint here — this
 *     runs INSIDE the signed-and-deduped tool-callback pipeline already, so
 *     a single deterministic path is fine.
 *
 * Returns ToolCallbackResult:
 *   - { ok: true,  message: "I just texted you the link..." }  → agent reads back
 *   - { ok: false, message: "I couldn't catch your phone..." } → agent retries
 *
 * Tape stamp: the parent dispatcher already emits VOICE_TOOL_INVOKED with
 * ok/handler outcome. We do NOT double-stamp.
 */

export async function sendAppLinkHandler(
  parameters: Record<string, unknown>,
  context: ToolCallbackContext
): Promise<ToolCallbackResult> {
  const phoneRaw = pickString(parameters, "phone");
  const firstName = pickString(parameters, "first_name") ?? pickString(parameters, "firstName");
  const lastName = pickString(parameters, "last_name") ?? pickString(parameters, "lastName");

  const phone = normalizePhone(phoneRaw);
  if (!phone) {
    logger.warn("send_app_link missing phone", {
      conversationId: context.conversationId,
    });
    return {
      ok: false,
      message:
        "I didn't catch your phone number. Can you say it once more, slowly?",
    };
  }

  const user = await findOrCreateApplicant({
    phone,
    firstName: firstName ?? null,
    lastName: lastName ?? null,
    conversationId: context.conversationId,
  });

  const magic = await createMagicLink(user.email);
  if (!magic) {
    logger.error("send_app_link createMagicLink returned null", {
      conversationId: context.conversationId,
      userId: user.id,
    });
    return {
      ok: false,
      message:
        "Sorry, I'm having trouble generating that link right now. Could you call back in a minute?",
    };
  }

  const link = appendIntakeQuery(magic.link, context.conversationId);
  logMagicLink(user.email, link);
  // One SMS: the resume link + a short line pointing at the onboarding
  // walkthrough video, so the caller can watch how it works before finishing.
  sendMagicLinkSms(
    magic.userId,
    link,
    `New here? Here's a 90-second walkthrough of how it works: ${ONBOARDING_VIDEO_URL}`
  );

  logger.info("send_app_link issued", {
    conversationId: context.conversationId,
    userId: magic.userId,
    phoneMasked: maskPhone(phone),
  });

  return {
    ok: true,
    result: { sent: true },
    message:
      "Great — I just texted you a link, plus a quick 90-second walkthrough of how it works. Tap the link and the app will pick up right where we left off.",
  };
}

function pickString(parameters: Record<string, unknown>, key: string): string | null {
  const value = parameters[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

/**
 * Append `&intake=<conversation_id>` to a magic-link URL. createMagicLink
 * always returns `?token=...`, so we always need `&`. Defensive: if the URL
 * already carries the intake param, leave it.
 */
function appendIntakeQuery(link: string, conversationId: string): string {
  if (link.includes("intake=")) return link;
  const sep = link.includes("?") ? "&" : "?";
  return `${link}${sep}intake=${encodeURIComponent(conversationId)}`;
}

/**
 * Last-4-digits masking for log lines. Never log the full E.164.
 */
function maskPhone(phone: string): string {
  if (phone.length <= 4) return "****";
  return `***${phone.slice(-4)}`;
}

interface FindOrCreateArgs {
  phone: string;
  firstName: string | null;
  lastName: string | null;
  conversationId: string;
}

/**
 * Find an existing applicant/tenant user by phone, or create a new applicant.
 *
 * No UNIQUE(phone) on the users table — we deduplicate by picking the most
 * recently updated applicant/tenant with this phone of record. Staff rows
 * are intentionally excluded so a leasing agent who happens to share a
 * household phone never receives an applicant link.
 *
 * New users get a deterministic synthesized email
 * `voice+<conversation_id>@voice-handoff.invalid` so the existing
 * createMagicLink → users-by-email lookup keeps working without a schema
 * change. The `.invalid` TLD is reserved (RFC 2606) and never delivers
 * mail, so a typo or stale reference can never reach a real inbox.
 */
async function findOrCreateApplicant(
  args: FindOrCreateArgs
): Promise<{ id: string; email: string }> {
  const existing = await query(
    `SELECT id, email
       FROM users
      WHERE phone = $1
        AND role IN ('applicant', 'tenant')
        AND is_active = TRUE
      ORDER BY last_login DESC NULLS LAST, created_at DESC
      LIMIT 1`,
    [args.phone]
  );
  if (existing.rows.length > 0) {
    const row = existing.rows[0];
    return { id: row.id as string, email: row.email as string };
  }

  const email = synthEmailFromConversation(args.conversationId);
  const inserted = await query(
    `INSERT INTO users (
       email, first_name, last_name, phone, role, is_active, password_hash
     )
     VALUES ($1, $2, $3, $4, 'applicant', TRUE, '')
     ON CONFLICT (email) DO UPDATE SET
       phone = EXCLUDED.phone,
       first_name = COALESCE(EXCLUDED.first_name, users.first_name),
       last_name  = COALESCE(EXCLUDED.last_name,  users.last_name)
     RETURNING id, email`,
    [email, args.firstName ?? "Voice", args.lastName ?? "Caller", args.phone]
  );

  const row = inserted.rows[0];
  return { id: row.id as string, email: row.email as string };
}

function synthEmailFromConversation(conversationId: string): string {
  const slug = conversationId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80) || "anon";
  return `voice+${slug}@voice-handoff.invalid`;
}

let registered = false;
/**
 * Idempotent registration helper. Boot calls this once; tests can also call
 * it after clearToolHandlersForTests() to re-wire.
 */
export function registerVoiceToolHandlers(): void {
  if (registered) return;
  registerToolHandler("send_app_link", sendAppLinkHandler);
  registered = true;
}

/** Test-only: reset the one-time gate so jest can re-register fresh. */
export function __resetRegistrationForTests(): void {
  registered = false;
}
