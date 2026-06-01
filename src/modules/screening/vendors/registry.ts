import { SandboxVendor } from "./sandbox-vendor";
import { PlaidVendor } from "./plaid-vendor";
import type { ScreeningVendor, ScreeningCheckDomain } from "./types";

/**
 * Vendor registry — resolves which ScreeningVendor backs a given check domain.
 *
 * Resolution precedence (most specific wins):
 *   1. SCREENING_VENDOR_<DOMAIN>   e.g. SCREENING_VENDOR_INCOME=plaid
 *   2. SCREENING_VENDOR            global override for all domains
 *   3. "sandbox"                   safe default (self-gating; HOLDs in keyless prod)
 *
 * Resolution happens PER CALL (no memoisation) on purpose: the contract test
 * suites flip env between cases, and a real deployment may set per-domain vendors
 * independently. Vendor constructors are side-effect-free (they read env lazily
 * inside their methods), so per-call construction is cheap and env-accurate.
 *
 * If a configured vendor does not support the requested domain, resolveVendor
 * THROWS. That throw surfaces inside the calling service's try block (or
 * propagates, for work-number) and becomes a fail-loud HOLD — never a pass.
 */

export const DEFAULT_SCREENING_VENDOR = "sandbox";

type VendorFactory = () => ScreeningVendor;

const VENDOR_FACTORIES: Record<string, VendorFactory> = {
  sandbox: () => new SandboxVendor(),
  plaid: () => new PlaidVendor(),
};

export function resolveVendorName(domain: ScreeningCheckDomain): string {
  const perDomain = process.env[`SCREENING_VENDOR_${domain.toUpperCase()}`];
  const name = (perDomain || process.env.SCREENING_VENDOR || DEFAULT_SCREENING_VENDOR).trim().toLowerCase();
  return name || DEFAULT_SCREENING_VENDOR;
}

export function resolveVendor(domain: ScreeningCheckDomain): ScreeningVendor {
  const name = resolveVendorName(domain);
  const factory = VENDOR_FACTORIES[name];
  if (!factory) {
    throw new Error(
      `Unknown screening vendor "${name}" configured for ${domain}. Known vendors: ${Object.keys(VENDOR_FACTORIES).join(", ")}.`
    );
  }
  const vendor = factory();
  if (!vendor.supports(domain)) {
    throw new Error(
      `Screening vendor "${name}" does not support the ${domain} check. ` +
        `Configure a vendor that does (e.g. SCREENING_VENDOR_${domain.toUpperCase()}=sandbox).`
    );
  }
  return vendor;
}
