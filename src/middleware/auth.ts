import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { query } from "../config/database";
import { logger } from "../utils/logger";

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
}

export interface AuthRequest extends Request {
  user?: AuthUser;
}

export function generateToken(user: AuthUser): string {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      role: user.role,
      firstName: user.firstName,
      lastName: user.lastName,
      propertyIds: user.propertyIds,
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
    const decoded = jwt.verify(token, JWT_SECRET) as AuthUser;

    // Verify user still exists and is active
    const result = await query(
      "SELECT id, email, role, first_name, last_name, property_ids, is_active FROM users WHERE id = $1",
      [decoded.id]
    );

    if (result.rows.length === 0 || !result.rows[0].is_active) {
      res.status(401).json({ error: "User account is inactive or not found" });
      return;
    }

    req.user = {
      id: result.rows[0].id,
      email: result.rows[0].email,
      role: result.rows[0].role,
      firstName: result.rows[0].first_name,
      lastName: result.rows[0].last_name,
      propertyIds: result.rows[0].property_ids || [],
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
    "SELECT id, email, password_hash, role, first_name, last_name, property_ids, is_active FROM users WHERE email = $1",
    [email]
  );

  if (result.rows.length === 0) return null;

  const user = result.rows[0];
  if (!user.is_active) return null;

  const valid = await bcrypt.compare(password, user.password_hash);
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
  };

  return { token: generateToken(authUser), user: authUser };
}
