/**
 * Tests for src/middleware/verify-turnstile.ts (gpmglv wedge #13 — anti-spam).
 *
 * Coverage:
 *   1. Bypass path: TURNSTILE_SECRET_KEY unset → next() called, no fetch
 *   2. Bypass path: TURNSTILE_SECRET_KEY === dev sentinel → next() called
 *   3. Verify path with real secret: missing token → 403
 *   4. Verify path with real secret: success from siteverify → next() called
 *   5. Verify path with real secret: failure from siteverify → 403
 *   6. Verify path with real secret: siteverify network throw → 403 (fail closed)
 *
 * Strategy: mount the middleware in a minimal Express app, stub global fetch
 * for the real-secret cases. Save/restore TURNSTILE_SECRET_KEY per-test so we
 * don't leak env across the suite.
 */
import express, { Request, Response } from "express";
import request from "supertest";
import { verifyTurnstile, isTurnstileBypassed } from "../middleware/verify-turnstile";

jest.mock("../utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

function buildApp(fetchImpl?: typeof fetch) {
  const app = express();
  app.use(express.json());
  app.post(
    "/probe",
    verifyTurnstile(fetchImpl ? { fetchImpl } : {}),
    (_req: Request, res: Response) => {
      res.status(200).json({ ok: true });
    }
  );
  return app;
}

describe("verify-turnstile middleware", () => {
  const ORIGINAL_SECRET = process.env.TURNSTILE_SECRET_KEY;

  afterEach(() => {
    if (ORIGINAL_SECRET === undefined) {
      delete process.env.TURNSTILE_SECRET_KEY;
    } else {
      process.env.TURNSTILE_SECRET_KEY = ORIGINAL_SECRET;
    }
    jest.clearAllMocks();
  });

  describe("bypass paths", () => {
    it("passes through with no token when TURNSTILE_SECRET_KEY is unset", async () => {
      delete process.env.TURNSTILE_SECRET_KEY;
      expect(isTurnstileBypassed()).toBe(true);
      const fetchStub = jest.fn() as unknown as typeof fetch;
      const app = buildApp(fetchStub);
      const res = await request(app).post("/probe").send({});
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      // Critical: bypass must NOT make any outbound siteverify call.
      expect(fetchStub).not.toHaveBeenCalled();
    });

    it("passes through with no token when TURNSTILE_SECRET_KEY equals the dev sentinel", async () => {
      process.env.TURNSTILE_SECRET_KEY = "1x0000000000000000000000000000000AA";
      expect(isTurnstileBypassed()).toBe(true);
      const fetchStub = jest.fn() as unknown as typeof fetch;
      const app = buildApp(fetchStub);
      const res = await request(app).post("/probe").send({});
      expect(res.status).toBe(200);
      expect(fetchStub).not.toHaveBeenCalled();
    });
  });

  describe("real-secret path", () => {
    beforeEach(() => {
      process.env.TURNSTILE_SECRET_KEY = "real-secret-xyz";
    });

    it("rejects with 403 when no token is supplied", async () => {
      const fetchStub = jest.fn() as unknown as typeof fetch;
      const app = buildApp(fetchStub);
      const res = await request(app).post("/probe").send({});
      expect(res.status).toBe(403);
      expect(res.body.error).toBe("turnstile_verification_failed");
      // Should fast-fail without making a siteverify call.
      expect(fetchStub).not.toHaveBeenCalled();
    });

    it("calls siteverify with the supplied token and allows on success", async () => {
      const fetchStub = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: true }),
      }) as unknown as typeof fetch;

      const app = buildApp(fetchStub);
      const res = await request(app)
        .post("/probe")
        .send({ turnstileToken: "client-issued-token" });

      expect(res.status).toBe(200);
      expect(fetchStub).toHaveBeenCalledTimes(1);
      const [url, init] = (fetchStub as jest.Mock).mock.calls[0];
      expect(url).toBe(
        "https://challenges.cloudflare.com/turnstile/v0/siteverify"
      );
      expect((init as RequestInit).method).toBe("POST");
      // Body is URLSearchParams stringified — assert the secret + response made it.
      const bodyStr = String((init as RequestInit).body);
      expect(bodyStr).toContain("secret=real-secret-xyz");
      expect(bodyStr).toContain("response=client-issued-token");
    });

    it("rejects with 403 when siteverify returns success: false", async () => {
      const fetchStub = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: false, "error-codes": ["invalid-input-response"] }),
      }) as unknown as typeof fetch;

      const app = buildApp(fetchStub);
      const res = await request(app)
        .post("/probe")
        .send({ turnstileToken: "bad-token" });

      expect(res.status).toBe(403);
      expect(res.body.error).toBe("turnstile_verification_failed");
    });

    it("rejects with 403 (fail-closed) when siteverify throws", async () => {
      const fetchStub = jest
        .fn()
        .mockRejectedValue(new Error("network down")) as unknown as typeof fetch;

      const app = buildApp(fetchStub);
      const res = await request(app)
        .post("/probe")
        .send({ turnstileToken: "any-token" });

      expect(res.status).toBe(403);
      expect(res.body.error).toBe("turnstile_verification_failed");
    });
  });
});
