import crypto from "crypto";
import { query } from "../../config/database";
import { generateToken, AuthUser } from "../../middleware/auth";
import { logger } from "../../utils/logger";

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

  const authUser: AuthUser = {
    id: row.user_id,
    email: row.email,
    role: row.role,
    firstName: row.first_name,
    lastName: row.last_name,
    propertyIds: [],
  };

  return { token: generateToken(authUser), user: authUser };
}

export function logMagicLink(email: string, link: string): void {
  // Truncate the token portion of the link so the raw token is never in logs.
  const safeLink = link.replace(/([?&]token=)[^&]+/, (_m, prefix) => `${prefix}[REDACTED]`);
  logger.info("Magic link issued", { email, link: safeLink });
}
