/**
 * Tests for the wedge #13 per-IP rate limit on POST /auth/magic-link/request.
 *
 * The existing per-(ip, email) limit caps a single IP to 5 requests/min for
 * the same email. But because the key includes the email, a botnet from one
 * IP cycling through fresh email addresses defeats it (every key is fresh).
 * This test mounts the auth router and proves that the per-IP limiter (30/min)
 * trips on the 31st request even when each request uses a different email.
 *
 * The same supertest agent is used across all requests so express-rate-limit
 * sees a single IP. Each request uses a unique email so the per-(ip,email)
 * limiter's bucket is always fresh — isolating the per-IP limiter under test.
 */
import express from "express";
import request from "supertest";

jest.mock("../modules/auth/magic-link-service", () => ({
  // createMagicLink returns null → the route still 200s but skips
  // logMagicLink / Resend. Keeps the test fast and deterministic.
  createMagicLink: jest.fn().mockResolvedValue(null),
  verifyMagicLink: jest.fn(),
  logMagicLink: jest.fn(),
}));
jest.mock("../config/database", () => ({ query: jest.fn(), transaction: jest.fn() }));
jest.mock("../utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import authRouter from "../modules/auth/routes";

const ORIGINAL_SECRET = process.env.TURNSTILE_SECRET_KEY;

beforeAll(() => {
  // Ensure verify-turnstile bypasses — we're isolating the rate-limit behaviour.
  delete process.env.TURNSTILE_SECRET_KEY;
});
afterAll(() => {
  if (ORIGINAL_SECRET !== undefined) {
    process.env.TURNSTILE_SECRET_KEY = ORIGINAL_SECRET;
  }
});

const app = express();
app.use(express.json());
app.use("/auth", authRouter);

describe("wedge #13: per-IP rate limit on POST /auth/magic-link/request", () => {
  it("trips 429 on the 31st request from one IP even when the email rotates", async () => {
    // 30 fresh emails → per-(ip,email) bucket never fills (each is unused).
    // The per-IP limiter caps at 30/min, so the 31st request must 429.
    const agent = request.agent(app);

    for (let i = 0; i < 30; i++) {
      const res = await agent
        .post("/auth/magic-link/request")
        .send({ email: `bot+${Date.now()}-${i}@example.com` });
      // Each call is expected to land at 200 (route always responds ok regardless
      // of whether the email exists, per the no-enumeration policy).
      expect(res.status).toBe(200);
    }

    const limited = await agent
      .post("/auth/magic-link/request")
      .send({ email: `bot+${Date.now()}-final@example.com` });

    expect(limited.status).toBe(429);
    expect(limited.body.error).toMatch(/too many requests/i);
  }, 30_000);
});
