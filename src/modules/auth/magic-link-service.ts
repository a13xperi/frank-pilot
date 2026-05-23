import crypto from "crypto";
import { query } from "../../config/database";
import { generateToken, AuthUser } from "../../middleware/auth";
import { logger } from "../../utils/logger";
import { getEmailService } from "../integrations/email";
import { TwilioService } from "../integrations/twilio";

// Delivery channels for a magic link. Default stays 'email' so existing
// callers (and the /register contract) are unchanged; 'sms' / 'both' opt in
// to the Twilio transport added here.
export type MagicLinkChannel = "email" | "sms" | "both";

const UUID_RE = /^[0-9a-f-]{36}$/i;

// Single shared Twilio client — mirrors the email service's lazy singleton
// pattern. Construction is cheap (it only reads env), so this is just to keep
// one client across requests.
let twilioService: TwilioService | null = null;
function getTwilioService(): TwilioService {
  if (!twilioService) twilioService = new TwilioService();
  return twilioService;
}

const TOKEN_TTL_MINUTES = 15;

function hashToken(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

export async function createMagicLink(email: string): Promise<{ link: string; userId: string } | null> {
  const userRes = await query(
    "SELECT id, role, is_active FROM users WHERE email = $1",
    [email]
  );
  if (userRes.rows.length === 0) return null;

  const user = userRes.rows[0];
  if (!user.is_active) return null;
  if (!["applicant", "tenant"].includes(user.role)) return null;

  const rawToken = crypto.randomBytes(32).toString("base64url");
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MINUTES * 60 * 1000);

  await query(
    `INSERT INTO magic_link_tokens (token_hash, user_id, expires_at) VALUES ($1, $2, $3)`,
    [tokenHash, user.id, expiresAt]
  );

  const portalBase = process.env.TENANT_PORTAL_URL || "http://localhost:5174";
  const link = `${portalBase}/auth/callback?token=${rawToken}`;
  return { link, userId: user.id };
}

export async function verifyMagicLink(rawToken: string): Promise<{ token: string; user: AuthUser } | null> {
  const tokenHash = hashToken(rawToken);

  const result = await query(
    `SELECT mlt.id AS token_id, mlt.user_id, mlt.expires_at, mlt.used_at,
            u.email, u.role, u.first_name, u.last_name, u.is_active
     FROM magic_link_tokens mlt
     JOIN users u ON u.id = mlt.user_id
     WHERE mlt.token_hash = $1`,
    [tokenHash]
  );
  if (result.rows.length === 0) return null;

  const row = result.rows[0];
  if (row.used_at) return null;
  if (new Date(row.expires_at) < new Date()) return null;
  if (!row.is_active) return null;

  await query(
    `UPDATE magic_link_tokens SET used_at = NOW() WHERE id = $1`,
    [row.token_id]
  );
  await query(`UPDATE users SET last_login = NOW() WHERE id = $1`, [row.user_id]);

  // WARN #2: this is the moment email control is proven. Stamp it once —
  // subsequent magic-link logins don't bump the timestamp.
  await query(
    `UPDATE users SET email_verified_at = NOW()
     WHERE id = $1 AND email_verified_at IS NULL`,
    [row.user_id]
  );

  const authUser: AuthUser = {
    id: row.user_id,
    email: row.email,
    role: row.role,
    firstName: row.first_name,
    lastName: row.last_name,
    propertyIds: [],
    emailVerified: true,
  };

  return { token: generateToken(authUser, { emailVerified: true }), user: authUser };
}

export function logMagicLink(email: string, link: string): void {
  // Truncate the token portion of the link so the raw token is never in logs.
  const safeLink = link.replace(/([?&]token=)[^&]+/, (_m, prefix) => `${prefix}[REDACTED]`);
  logger.info("Magic link issued", { email, link: safeLink });
}

/**
 * Fire-and-forget magic-link email delivery via Resend.
 *
 * Returns synchronously after scheduling the send so the /register handler
 * stays constant-time across {staff, existing, new} branches (INFO-1 floor
 * still applies as the residual guard).
 *
 * Errors are swallowed and logged — a Resend outage must not crash the
 * server or surface a branch-specific failure mode to the caller.
 */
export function sendMagicLink(
  email: string,
  link: string,
  options?: { firstName?: string; channel?: MagicLinkChannel; userId?: string }
): void {
  const channel: MagicLinkChannel = options?.channel ?? "email";

  if (channel === "email" || channel === "both") {
    void getEmailService()
      .sendMagicLink(email, link, { firstName: options?.firstName })
      .catch((err: unknown) => {
        logger.error("magic-link send failed", {
          error: (err as Error)?.message ?? String(err),
        });
      });
  }

  if (channel === "sms" || channel === "both") {
    // Prefer userId (so we look up the phone of record); fall back to email
    // is meaningless for SMS, so without a userId we have nothing to send to.
    if (options?.userId) {
      sendMagicLinkSms(options.userId, link);
    } else {
      logger.warn("magic-link sms requested without userId — no phone to resolve");
    }
  }
}

/**
 * Fire-and-forget magic-link SMS delivery via Twilio.
 *
 * Accepts either a user id (UUID — phone is resolved from the users table) or
 * a raw phone number. Returns synchronously after scheduling the send so the
 * /register handler stays constant-time (mirrors sendMagicLink's contract and
 * lease/service.ts's non-blocking Twilio pattern).
 *
 * A missing phone, an unconfigured Twilio client, or a Twilio outage is
 * swallowed and logged — an SMS failure must never crash the server or change
 * the response. The raw token is never logged here.
 */
export function sendMagicLinkSms(userIdOrPhone: string, link: string): void {
  void resolvePhone(userIdOrPhone)
    .then((phone) => {
      if (!phone) {
        // No phone on file (or user not found). Nothing to send — not an error.
        logger.info("magic-link sms skipped — no phone on file");
        return;
      }
      const body = `Your sign-in link for CDPC Nevada: ${link} (expires in ${TOKEN_TTL_MINUTES} minutes). If you didn't request this, ignore this message.`;
      return getTwilioService()
        .sendSMS(phone, body)
        .then(() => undefined);
    })
    .catch((err: unknown) => {
      logger.error("magic-link sms send failed", {
        error: (err as Error)?.message ?? String(err),
      });
    });
}

// Resolve a phone number from either a UUID (look up users.phone) or a raw
// phone string passed directly. Returns null when nothing usable is found.
async function resolvePhone(userIdOrPhone: string): Promise<string | null> {
  if (UUID_RE.test(userIdOrPhone)) {
    const res = await query("SELECT phone FROM users WHERE id = $1", [userIdOrPhone]);
    const phone = res.rows[0]?.phone;
    return phone ? String(phone) : null;
  }
  // Not a UUID — treat as a literal phone number.
  const trimmed = userIdOrPhone.trim();
  return trimmed ? trimmed : null;
}
