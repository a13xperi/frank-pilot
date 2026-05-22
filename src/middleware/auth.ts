import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { query } from "../config/database";
import { logger } from "../utils/logger";

// CRIT-1: pre-computed bcrypt hash of an arbitrary string at cost 10. Used to
// equalize timing on the four login-failure paths (unknown user / inactive /
// null password_hash / wrong password) so all paths spend ~80ms in bcrypt
// rather than exposing a fast-fail oracle on the first three.
const BCRYPT_DUMMY_HASH =
  "$2b$10$GfTcKuu5Qsz6BxIEt2A1neJ9XZin6d0TnhZ6NRu36HlW2Ahr5jI52";

const JWT_SECRET = (() => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("JWT_SECRET is required in production");
    }
    return "dev-secret-change-me";
  }
  return secret;
})();

export interface AuthUser {
  id: string;
  email: string;
  role: string;
  firstName: string;
  lastName: string;
  propertyIds: string[];
  // WARN #2: two-tier scope. False on freshly-registered accounts until the
  // user clicks the magic link sent to their email; persisted on users.email_verified_at.
  emailVerified: boolean;
}

export interface AuthRequest extends Request {
  user?: AuthUser;
}

/**
 * Issue a JWT for the given user. `emailVerified` may be overridden — callers
 * that just issued a magic link pass `false`, callers that just verified one
 * (or completed a password login) pass `true`. If omitted, falls back to
 * `authUser.emailVerified ?? false` — never assume verified.
 */
export function generateToken(
  user: AuthUser,
  opts: { emailVerified?: boolean } = {}
): string {
  const emailVerified = opts.emailVerified ?? user.emailVerified ?? false;
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      role: user.role,
      firstName: user.firstName,
      lastName: user.lastName,
      propertyIds: user.propertyIds,
      emailVerified,
    },
    JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRY || "8h" } as jwt.SignOptions
  );
}

export async function authenticate(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const token = authHeader.substring(7);

  try {
    jwt.verify(token, JWT_SECRET);

    // Decode the (now-verified) payload so we can re-read the user from DB.
    // The token's emailVerified claim is advisory — the DB value wins below,
    // so a forged or stale token can never claim verification the user lacks,
    // and the moment a user verifies, every previously-issued unverified token
    // is upgraded on its next request.
    const decoded = jwt.decode(token) as { id?: string } | null;
    if (!decoded?.id) {
      res.status(401).json({ error: "Invalid token" });
      return;
    }

    const result = await query(
      "SELECT id, email, role, first_name, last_name, property_ids, is_active, email_verified_at FROM users WHERE id = $1",
      [decoded.id]
    );

    if (result.rows.length === 0 || !result.rows[0].is_active) {
      res.status(401).json({ error: "User account is inactive or not found" });
      return;
    }

    const row = result.rows[0];
    req.user = {
      id: row.id,
      email: row.email,
      role: row.role,
      firstName: row.first_name,
      lastName: row.last_name,
      propertyIds: row.property_ids || [],
      emailVerified: !!row.email_verified_at,
    };

    next();
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      res.status(401).json({ error: "Token expired" });
      return;
    }
    logger.warn("Invalid token attempt", { error: (err as Error).message });
    res.status(401).json({ error: "Invalid token" });
  }
}

export async function login(email: string, password: string): Promise<{ token: string; user: AuthUser } | null> {
  const bcrypt = await import("bcrypt");

  const result = await query(
    "SELECT id, email, password_hash, role, first_name, last_name, property_ids, is_active, email_verified_at FROM users WHERE email = $1",
    [email]
  );

  // CRIT-1: close the timing + 500-vs-401 oracle on /api/auth/login. Run a
  // dummy bcrypt.compare on every failure path so unknown user / inactive
  // user / applicant with NULL password_hash all spend ~80ms like a real
  // wrong-password attempt would. The catch block also falls back to the
  // dummy compare so a thrown bcrypt error can't surface as a 500 either.
  if (result.rows.length === 0) {
    await bcrypt.compare(password, BCRYPT_DUMMY_HASH);
    return null;
  }

  const user = result.rows[0];
  if (!user.is_active) {
    await bcrypt.compare(password, BCRYPT_DUMMY_HASH);
    return null;
  }

  if (user.password_hash == null) {
    await bcrypt.compare(password, BCRYPT_DUMMY_HASH);
    return null;
  }

  let valid = false;
  try {
    valid = await bcrypt.compare(password, user.password_hash);
  } catch {
    await bcrypt.compare(password, BCRYPT_DUMMY_HASH);
    return null;
  }
  if (!valid) return null;

  // Update last login
  await query("UPDATE users SET last_login = NOW() WHERE id = $1", [user.id]);

  const authUser: AuthUser = {
    id: user.id,
    email: user.email,
    role: user.role,
    firstName: user.first_name,
    lastName: user.last_name,
    propertyIds: user.property_ids || [],
    emailVerified: !!user.email_verified_at,
  };

  return { token: generateToken(authUser), user: authUser };
}
