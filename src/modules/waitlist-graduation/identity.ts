import crypto from "crypto";

/**
 * Global relationship-ID dedup key (Frank core C5).
 *
 * A person is matched across properties by (normalized phone + DOB). This
 * module owns the pure, deterministic derivation of the match key — no DB, no
 * I/O — so it's exhaustively unit-testable and the service layer just calls it.
 *
 * The key is a salted SHA-256 of "<phone_digits>|<dob_iso>". It is one-way:
 * we store the digest (person_identities.identity_hash / applications.dob_hash),
 * never the raw DOB (that stays in date_of_birth_encrypted). The salt is the
 * app's PII secret so the digest is useless without it — same trust boundary as
 * the rest of the encryption layer.
 */

/** Salt source — reuse the at-rest PII secret; never hash unsalted PII. */
function identitySalt(): string {
  return (
    process.env.IDENTITY_HASH_SALT ||
    process.env.ENCRYPTION_KEY ||
    // Last-resort dev fallback. Production sets ENCRYPTION_KEY (boot guard), so
    // this only bites local/test, where determinism matters more than secrecy.
    "frank-dev-identity-salt"
  );
}

/** Phone → digits only (drops +, spaces, punctuation, leading country 1). */
export function normalizePhoneDigits(phone: string | null | undefined): string | null {
  if (!phone) return null;
  let digits = String(phone).replace(/\D/g, "");
  // Treat a US 11-digit "1XXXXXXXXXX" as its 10-digit core so "+1 702…" and
  // "702…" collapse to the same person.
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
  return digits.length >= 7 ? digits : null;
}

/**
 * DOB → canonical ISO date (yyyy-mm-dd). Accepts a Date, an ISO string, or
 * common US "MM/DD/YYYY". Returns null if it can't be parsed to a real date.
 */
export function normalizeDob(dob: string | Date | null | undefined): string | null {
  if (!dob) return null;
  if (dob instanceof Date) {
    return Number.isNaN(dob.getTime()) ? null : dob.toISOString().slice(0, 10);
  }
  const s = String(dob).trim();
  // Already ISO-ish.
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  // US MM/DD/YYYY (or M/D/YYYY).
  const us = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (us) {
    const mm = us[1].padStart(2, "0");
    const dd = us[2].padStart(2, "0");
    return `${us[3]}-${mm}-${dd}`;
  }
  // Fall back to Date parsing for anything else (e.g. "Jan 2 1990").
  const parsed = new Date(s);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

/** Salted SHA-256 hex of a single normalized component (the DOB hash). */
export function hashComponent(value: string): string {
  return crypto
    .createHash("sha256")
    .update(`${identitySalt()}|${value}`)
    .digest("hex");
}

export interface IdentityKey {
  identityHash: string;
  dobHash: string;
  phoneLast4: string;
}

/**
 * Build the cross-property identity key from raw phone + DOB.
 *
 * Returns null when either component is missing/unparseable — a row we can't
 * key is simply left unlinked (relationship_id stays NULL) rather than forced
 * into a bogus identity.
 */
export function deriveIdentityKey(
  phone: string | null | undefined,
  dob: string | Date | null | undefined
): IdentityKey | null {
  const digits = normalizePhoneDigits(phone);
  const dobIso = normalizeDob(dob);
  if (!digits || !dobIso) return null;
  const identityHash = crypto
    .createHash("sha256")
    .update(`${identitySalt()}|${digits}|${dobIso}`)
    .digest("hex");
  return {
    identityHash,
    dobHash: hashComponent(dobIso),
    phoneLast4: digits.slice(-4),
  };
}
