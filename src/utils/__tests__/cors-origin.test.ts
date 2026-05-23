/**
 * Tests for resolveCorsOrigin (#99 follow-up).
 *
 * The original PR #99 fix threw unconditionally on missing CORS_ORIGIN —
 * crashing `npm start` in local dev. This helper restores dev ergonomics
 * while keeping production fail-closed.
 */

import { resolveCorsOrigin } from "../cors-origin";

describe("resolveCorsOrigin", () => {
  it("throws in production when CORS_ORIGIN is unset", () => {
    expect(() =>
      resolveCorsOrigin({ NODE_ENV: "production" } as NodeJS.ProcessEnv)
    ).toThrow(/CORS_ORIGIN is required in production/);
  });

  it("throws in production when CORS_ORIGIN is empty/whitespace", () => {
    expect(() =>
      resolveCorsOrigin({
        NODE_ENV: "production",
        CORS_ORIGIN: "   ",
      } as NodeJS.ProcessEnv)
    ).toThrow(/CORS_ORIGIN is required in production/);
  });

  it("returns localhost defaults in dev when CORS_ORIGIN is unset", () => {
    const result = resolveCorsOrigin({
      NODE_ENV: "development",
    } as NodeJS.ProcessEnv);
    expect(result).toEqual([
      "http://localhost:5174",
      "http://localhost:3000",
    ]);
  });

  it("returns localhost defaults in test when CORS_ORIGIN is unset", () => {
    const result = resolveCorsOrigin({
      NODE_ENV: "test",
    } as NodeJS.ProcessEnv);
    expect(result).toEqual([
      "http://localhost:5174",
      "http://localhost:3000",
    ]);
  });

  it("parses explicit single CORS_ORIGIN value", () => {
    const result = resolveCorsOrigin({
      NODE_ENV: "production",
      CORS_ORIGIN: "https://frank-pilot-tenant.vercel.app",
    } as NodeJS.ProcessEnv);
    expect(result).toEqual(["https://frank-pilot-tenant.vercel.app"]);
  });

  it("parses explicit comma-separated CORS_ORIGIN list", () => {
    const result = resolveCorsOrigin({
      NODE_ENV: "production",
      CORS_ORIGIN: "https://frank-pilot-tenant.vercel.app, https://staff.example.com",
    } as NodeJS.ProcessEnv);
    expect(result).toEqual([
      "https://frank-pilot-tenant.vercel.app",
      "https://staff.example.com",
    ]);
  });

  it("respects explicit CORS_ORIGIN even in dev", () => {
    const result = resolveCorsOrigin({
      NODE_ENV: "development",
      CORS_ORIGIN: "http://localhost:9999",
    } as NodeJS.ProcessEnv);
    expect(result).toEqual(["http://localhost:9999"]);
  });
});
