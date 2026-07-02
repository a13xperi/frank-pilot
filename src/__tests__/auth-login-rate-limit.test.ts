/**
 * Tests for src/middleware/login-rate-limit.ts — the staff /api/auth/login
 * limiters (audit #7b, carried-over P0 from SECURITY-AUDIT-2026-05-21).
 *
 * These are the REAL limiter instances index.ts mounts (extracted to a
 * module precisely so this suite doesn't test a copy). The stub route always
 * 401s, simulating a password-guessing stream; the backlog row's contract is
 * "N+1th attempt → 429".
 *
 * NODE_ENV is flipped to "production" only INSIDE a test body (the limiters'
 * `skip` reads it per request) and restored in finally/afterEach — nothing
 * loads modules mid-test, so nothing can capture the temporary value.
 */

import express from "express";
import request from "supertest";
import { loginLimiter, loginIpLimiter } from "../middleware/login-rate-limit";

function buildApp(): express.Express {
  const app = express();
  app.use(express.json());
  // Same middleware order as src/index.ts. The stub stands in for login():
  // every attempt is a failed guess.
  app.post("/api/auth/login", loginIpLimiter, loginLimiter, (_req, res) => {
    res.status(401).json({ error: "Invalid credentials" });
  });
  return app;
}

const SAVED_NODE_ENV = process.env.NODE_ENV;

afterEach(() => {
  process.env.NODE_ENV = SAVED_NODE_ENV;
});

describe("staff login rate limit (audit #7b)", () => {
  it("429s the 6th attempt for the same (IP, email) in production; other emails unaffected", async () => {
    process.env.NODE_ENV = "production";
    try {
      const app = buildApp();
      const attempt = (email: string, password: string) =>
        request(app).post("/api/auth/login").send({ email, password });

      for (let i = 1; i <= 5; i++) {
        const res = await attempt("pm@example.com", `guess-${i}`);
        expect(res.status).toBe(401); // within budget — reaches the handler
      }

      const blocked = await attempt("pm@example.com", "guess-6");
      expect(blocked.status).toBe(429);
      expect(blocked.body.error).toMatch(/too many login attempts/i);

      // Per-(IP,email) keying: a different account from the same IP is not
      // collaterally locked (the wider per-IP bucket, max 30, still has room).
      const other = await attempt("other-pm@example.com", "guess-1");
      expect(other.status).toBe(401);
    } finally {
      process.env.NODE_ENV = SAVED_NODE_ENV;
    }
  });

  it("does not throttle outside production (dev/CI bypass — Playwright logs in repeatedly)", async () => {
    const app = buildApp();
    for (let i = 1; i <= 8; i++) {
      const res = await request(app)
        .post("/api/auth/login")
        .send({ email: "pm@example.com", password: "guess" });
      expect(res.status).toBe(401); // never 429 while skip() is true
    }
  });
});
