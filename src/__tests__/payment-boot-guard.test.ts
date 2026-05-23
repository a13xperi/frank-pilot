/**
 * Unit tests for the BP-08 Stripe boot guard.
 *
 * Drives the pure helper directly — never lets the side-effecty
 * `assertStripeProdConfig` reach `process.exit`. The two cases that matter:
 *
 *   1. Flag off → no-op regardless of key state (dev/staging path).
 *   2. Flag on + any required key missing/placeholder → reports it.
 *
 * The §8.1 acceptance bar is "live mode crashes loud on misconfig," so the
 * explicit cases below are the bar.
 */

import { checkStripeProdConfig } from "../modules/payment/boot-guard";

describe("checkStripeProdConfig", () => {
  it("returns enabled=false when STRIPE_LIVE_ENABLED is unset", () => {
    const result = checkStripeProdConfig({});
    expect(result.enabled).toBe(false);
    expect(result.missing).toEqual([]);
  });

  it("returns enabled=false when STRIPE_LIVE_ENABLED is the string 'false'", () => {
    const result = checkStripeProdConfig({ STRIPE_LIVE_ENABLED: "false" });
    expect(result.enabled).toBe(false);
    expect(result.missing).toEqual([]);
  });

  it("returns enabled=false when STRIPE_LIVE_ENABLED is any non-'true' string", () => {
    const result = checkStripeProdConfig({
      STRIPE_LIVE_ENABLED: "1",
      STRIPE_SECRET_KEY: "",
      STRIPE_WEBHOOK_SECRET: "",
      STRIPE_PUBLISHABLE_KEY: "",
    });
    // "1" !== "true" → guard stays off, missing list stays empty.
    expect(result.enabled).toBe(false);
    expect(result.missing).toEqual([]);
  });

  it("reports all three keys as missing when flag is on and env is empty", () => {
    const result = checkStripeProdConfig({ STRIPE_LIVE_ENABLED: "true" });
    expect(result.enabled).toBe(true);
    expect(result.missing.sort()).toEqual(
      ["STRIPE_PUBLISHABLE_KEY", "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"].sort()
    );
  });

  it("reports placeholder secret_key as missing", () => {
    const result = checkStripeProdConfig({
      STRIPE_LIVE_ENABLED: "true",
      STRIPE_SECRET_KEY: "sk_test_changeme",
      STRIPE_WEBHOOK_SECRET: "whsec_real",
      STRIPE_PUBLISHABLE_KEY: "pk_live_real",
    });
    expect(result.enabled).toBe(true);
    expect(result.missing).toEqual(["STRIPE_SECRET_KEY"]);
  });

  it("reports placeholder webhook_secret as missing", () => {
    const result = checkStripeProdConfig({
      STRIPE_LIVE_ENABLED: "true",
      STRIPE_SECRET_KEY: "sk_live_real",
      STRIPE_WEBHOOK_SECRET: "whsec_changeme",
      STRIPE_PUBLISHABLE_KEY: "pk_live_real",
    });
    expect(result.enabled).toBe(true);
    expect(result.missing).toEqual(["STRIPE_WEBHOOK_SECRET"]);
  });

  it("reports placeholder publishable_key as missing", () => {
    const result = checkStripeProdConfig({
      STRIPE_LIVE_ENABLED: "true",
      STRIPE_SECRET_KEY: "sk_live_real",
      STRIPE_WEBHOOK_SECRET: "whsec_real",
      STRIPE_PUBLISHABLE_KEY: "pk_test_changeme",
    });
    expect(result.enabled).toBe(true);
    expect(result.missing).toEqual(["STRIPE_PUBLISHABLE_KEY"]);
  });

  it("reports empty-string values as missing (not just absent keys)", () => {
    const result = checkStripeProdConfig({
      STRIPE_LIVE_ENABLED: "true",
      STRIPE_SECRET_KEY: "",
      STRIPE_WEBHOOK_SECRET: "",
      STRIPE_PUBLISHABLE_KEY: "",
    });
    expect(result.enabled).toBe(true);
    expect(result.missing.length).toBe(3);
  });

  it("returns empty missing list when all three keys are real values", () => {
    const result = checkStripeProdConfig({
      STRIPE_LIVE_ENABLED: "true",
      STRIPE_SECRET_KEY: "sk_live_abc123",
      STRIPE_WEBHOOK_SECRET: "whsec_xyz789",
      STRIPE_PUBLISHABLE_KEY: "pk_live_def456",
    });
    expect(result.enabled).toBe(true);
    expect(result.missing).toEqual([]);
  });
});
