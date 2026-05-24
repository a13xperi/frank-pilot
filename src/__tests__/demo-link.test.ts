/**
 * Unit tests for the demo-link gate (utils/demo-link.ts).
 *
 * The gate decides whether a magic-link is echoed in the HTTP response. It is
 * an auth bypass, so the matrix below is security-sensitive: the only path that
 * may open on a tenant-facing deploy is a matching x-demo-token under
 * DEMO_LINK_SECRET.
 */

import { shouldReturnDevLink, DEMO_TOKEN_HEADER } from "../utils/demo-link";

function reqWith(headers: Record<string, string> = {}) {
  const lower: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = v;
  return { header: (name: string) => lower[name.toLowerCase()] };
}

describe("shouldReturnDevLink", () => {
  const ORIG = { ...process.env };
  afterEach(() => {
    process.env = { ...ORIG };
  });

  it("opens in development regardless of headers/flags", () => {
    process.env.NODE_ENV = "development";
    delete process.env.DEMO_LINK_SECRET;
    delete process.env.DEMO_LINK_IN_RESPONSE;
    expect(shouldReturnDevLink(reqWith())).toBe(true);
  });

  it("opens when DEMO_LINK_SECRET is set and x-demo-token matches", () => {
    process.env.NODE_ENV = "production";
    process.env.DEMO_LINK_SECRET = "s3cret-demo";
    expect(
      shouldReturnDevLink(reqWith({ [DEMO_TOKEN_HEADER]: "s3cret-demo" }))
    ).toBe(true);
  });

  it("stays closed when the token is wrong", () => {
    process.env.NODE_ENV = "production";
    process.env.DEMO_LINK_SECRET = "s3cret-demo";
    expect(
      shouldReturnDevLink(reqWith({ [DEMO_TOKEN_HEADER]: "nope" }))
    ).toBe(false);
  });

  it("stays closed when the token is missing", () => {
    process.env.NODE_ENV = "production";
    process.env.DEMO_LINK_SECRET = "s3cret-demo";
    expect(shouldReturnDevLink(reqWith())).toBe(false);
  });

  it("ignores DEMO_LINK_IN_RESPONSE once a secret is configured (secret wins)", () => {
    process.env.NODE_ENV = "production";
    process.env.DEMO_LINK_SECRET = "s3cret-demo";
    process.env.DEMO_LINK_IN_RESPONSE = "true";
    // No matching token -> closed, even though the legacy flag is "true".
    expect(shouldReturnDevLink(reqWith())).toBe(false);
  });

  it("honors the legacy open flag only when no secret is set", () => {
    process.env.NODE_ENV = "production";
    delete process.env.DEMO_LINK_SECRET;
    process.env.DEMO_LINK_IN_RESPONSE = "true";
    expect(shouldReturnDevLink(reqWith())).toBe(true);
  });

  it("is fully closed by default in production (no secret, no flag)", () => {
    process.env.NODE_ENV = "production";
    delete process.env.DEMO_LINK_SECRET;
    delete process.env.DEMO_LINK_IN_RESPONSE;
    expect(shouldReturnDevLink(reqWith())).toBe(false);
  });
});
