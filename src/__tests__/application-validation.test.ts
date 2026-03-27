/**
 * Tests for src/modules/application/validation.ts
 *
 * Validates Zod schema constraints for tenant application intake.
 * Pure schema tests — no mocks required.
 *
 * Compliance notes:
 * - FCRA §604: SSN must be collected and validated; format must be enforced.
 * - PCI-DSS: SSN treated as sensitive; no storage of raw values tested here.
 * - HUD/LIHTC: Income field (annualIncome) must accept $0 (edge case for
 *   households reporting no income — common in LIHTC programs).
 */

import {
  createApplicationSchema,
  submitApplicationSchema,
  updateApplicationSchema,
} from "../modules/application/validation";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Minimal valid payload — only required fields. */
function minimalValid() {
  return {
    propertyId: "550e8400-e29b-41d4-a716-446655440000",
    firstName: "Jane",
    lastName: "Doe",
    ssn: "123-45-6789",
    dateOfBirth: "1990-06-15",
  };
}

/** Full valid payload with all optional fields populated. */
function fullValid() {
  return {
    ...minimalValid(),
    unitNumber: "4B",
    email: "jane.doe@example.com",
    phone: "555-867-5309",
    currentAddressLine1: "123 Main St",
    currentAddressLine2: "Apt 2",
    currentCity: "Boston",
    currentState: "MA",
    currentZip: "02134",
    employerName: "Acme Corp",
    employerPhone: "555-000-0001",
    employmentStartDate: "2020-01-01",
    annualIncome: 35000,
    previousLandlordName: "Bob Smith",
    previousLandlordPhone: "555-000-0002",
    previousRentalAddress: "456 Elm St, Boston MA",
    previousRentalDurationMonths: 24,
    emergencyContactName: "John Doe",
    emergencyContactPhone: "555-000-0003",
    emergencyContactRelationship: "Spouse",
    requestedLeaseTermMonths: 12,
    requestedRentAmount: 1200,
    requestedMoveInDate: "2026-05-01",
  };
}

// ── createApplicationSchema ───────────────────────────────────────────────────

describe("createApplicationSchema", () => {
  // ── Valid inputs ──────────────────────────────────────────────────────────

  it("accepts a minimal valid payload (required fields only)", () => {
    const result = createApplicationSchema.safeParse(minimalValid());
    expect(result.success).toBe(true);
  });

  it("accepts a fully populated valid payload", () => {
    const result = createApplicationSchema.safeParse(fullValid());
    expect(result.success).toBe(true);
  });

  it("defaults requestedLeaseTermMonths to 12 when omitted", () => {
    const result = createApplicationSchema.safeParse(minimalValid());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.requestedLeaseTermMonths).toBe(12);
    }
  });

  // ── Missing required fields ───────────────────────────────────────────────

  const requiredFields = ["propertyId", "firstName", "lastName", "ssn", "dateOfBirth"] as const;

  test.each(requiredFields)("fails when required field '%s' is missing", (field) => {
    const payload = { ...minimalValid(), [field]: undefined };
    const result = createApplicationSchema.safeParse(payload);
    expect(result.success).toBe(false);
  });

  it("fails when the entire payload is empty", () => {
    expect(createApplicationSchema.safeParse({}).success).toBe(false);
  });

  // ── propertyId — must be UUID ─────────────────────────────────────────────

  it("fails when propertyId is not a UUID", () => {
    const result = createApplicationSchema.safeParse({
      ...minimalValid(),
      propertyId: "not-a-uuid",
    });
    expect(result.success).toBe(false);
  });

  it("accepts a valid UUID v4 for propertyId", () => {
    expect(
      createApplicationSchema.safeParse({
        ...minimalValid(),
        propertyId: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
      }).success
    ).toBe(true);
  });

  // ── SSN format ────────────────────────────────────────────────────────────

  const validSSNs = ["123-45-6789", "123456789"]; // dashes optional per regex
  const invalidSSNs = [
    "123-45-678",   // too short
    "123-456-789",  // wrong grouping
    "abc-de-fghi",  // letters
    "123 45 6789",  // spaces instead of dashes
    "",             // empty
  ];

  test.each(validSSNs)("accepts valid SSN format: '%s'", (ssn) => {
    expect(createApplicationSchema.safeParse({ ...minimalValid(), ssn }).success).toBe(true);
  });

  test.each(invalidSSNs)("rejects invalid SSN: '%s'", (ssn) => {
    expect(createApplicationSchema.safeParse({ ...minimalValid(), ssn }).success).toBe(false);
  });

  // ── dateOfBirth format ────────────────────────────────────────────────────

  it("accepts YYYY-MM-DD date format", () => {
    expect(
      createApplicationSchema.safeParse({ ...minimalValid(), dateOfBirth: "1985-12-31" }).success
    ).toBe(true);
  });

  it("rejects MM/DD/YYYY date format", () => {
    expect(
      createApplicationSchema.safeParse({ ...minimalValid(), dateOfBirth: "12/31/1985" }).success
    ).toBe(false);
  });

  it("rejects freeform date string", () => {
    expect(
      createApplicationSchema.safeParse({ ...minimalValid(), dateOfBirth: "December 31, 1985" }).success
    ).toBe(false);
  });

  // ── annualIncome edge cases ───────────────────────────────────────────────

  it("accepts annualIncome of 0 (valid: zero-income household, common in LIHTC)", () => {
    expect(
      createApplicationSchema.safeParse({ ...minimalValid(), annualIncome: 0 }).success
    ).toBe(true);
  });

  it("accepts large annualIncome values", () => {
    expect(
      createApplicationSchema.safeParse({ ...minimalValid(), annualIncome: 999999 }).success
    ).toBe(true);
  });

  it("rejects negative annualIncome", () => {
    expect(
      createApplicationSchema.safeParse({ ...minimalValid(), annualIncome: -1 }).success
    ).toBe(false);
  });

  it("accepts omitted annualIncome (optional field)", () => {
    const { annualIncome: _, ...payload } = fullValid();
    expect(createApplicationSchema.safeParse(payload).success).toBe(true);
  });

  // ── requestedLeaseTermMonths constraints ──────────────────────────────────

  it("accepts lease term of 1 month (minimum)", () => {
    expect(
      createApplicationSchema.safeParse({ ...minimalValid(), requestedLeaseTermMonths: 1 }).success
    ).toBe(true);
  });

  it("accepts lease term of 60 months (maximum)", () => {
    expect(
      createApplicationSchema.safeParse({ ...minimalValid(), requestedLeaseTermMonths: 60 }).success
    ).toBe(true);
  });

  it("rejects lease term of 0", () => {
    expect(
      createApplicationSchema.safeParse({ ...minimalValid(), requestedLeaseTermMonths: 0 }).success
    ).toBe(false);
  });

  it("rejects lease term of 61", () => {
    expect(
      createApplicationSchema.safeParse({ ...minimalValid(), requestedLeaseTermMonths: 61 }).success
    ).toBe(false);
  });

  it("rejects non-integer lease term", () => {
    expect(
      createApplicationSchema.safeParse({ ...minimalValid(), requestedLeaseTermMonths: 12.5 }).success
    ).toBe(false);
  });

  // ── currentState must be exactly 2 characters ─────────────────────────────

  it("accepts 2-character state code", () => {
    expect(
      createApplicationSchema.safeParse({ ...minimalValid(), currentState: "CA" }).success
    ).toBe(true);
  });

  it("rejects state code longer than 2 characters", () => {
    expect(
      createApplicationSchema.safeParse({ ...minimalValid(), currentState: "CAL" }).success
    ).toBe(false);
  });

  it("rejects 1-character state code", () => {
    expect(
      createApplicationSchema.safeParse({ ...minimalValid(), currentState: "C" }).success
    ).toBe(false);
  });

  // ── Name field length limits ──────────────────────────────────────────────

  it("rejects firstName that is empty string", () => {
    expect(
      createApplicationSchema.safeParse({ ...minimalValid(), firstName: "" }).success
    ).toBe(false);
  });

  it("rejects firstName exceeding 100 characters", () => {
    expect(
      createApplicationSchema.safeParse({ ...minimalValid(), firstName: "A".repeat(101) }).success
    ).toBe(false);
  });

  // ── previousRentalDurationMonths ──────────────────────────────────────────

  it("accepts 0 months of previous rental (first-time renters)", () => {
    expect(
      createApplicationSchema.safeParse({ ...minimalValid(), previousRentalDurationMonths: 0 }).success
    ).toBe(true);
  });

  it("rejects negative rental duration", () => {
    expect(
      createApplicationSchema.safeParse({ ...minimalValid(), previousRentalDurationMonths: -1 }).success
    ).toBe(false);
  });
});

// ── submitApplicationSchema ───────────────────────────────────────────────────

describe("submitApplicationSchema", () => {
  it("accepts a valid UUID applicationId", () => {
    expect(
      submitApplicationSchema.safeParse({
        applicationId: "550e8400-e29b-41d4-a716-446655440000",
      }).success
    ).toBe(true);
  });

  it("fails when applicationId is not a UUID", () => {
    expect(
      submitApplicationSchema.safeParse({ applicationId: "app-12345" }).success
    ).toBe(false);
  });

  it("fails when applicationId is missing", () => {
    expect(submitApplicationSchema.safeParse({}).success).toBe(false);
  });
});

// ── updateApplicationSchema ───────────────────────────────────────────────────

describe("updateApplicationSchema", () => {
  it("accepts an empty object (all fields optional)", () => {
    expect(updateApplicationSchema.safeParse({}).success).toBe(true);
  });

  it("does NOT accept ssn field (immutable after creation)", () => {
    const result = updateApplicationSchema.safeParse({
      ssn: "123-45-6789",
    });
    // ssn is omitted from the schema, so the parsed result should strip/ignore it
    // With strict mode off (default), Zod strips unknown keys — but ssn is omitted
    // so it would be stripped. Test that parsed data does NOT contain ssn.
    if (result.success) {
      expect("ssn" in result.data).toBe(false);
    }
    // Either way (stripped or rejected), the schema enforces SSN immutability.
  });

  it("accepts valid partial update with only firstName", () => {
    expect(
      updateApplicationSchema.safeParse({ firstName: "Janet" }).success
    ).toBe(true);
  });

  it("still validates fields that are provided (invalid email still fails)", () => {
    expect(
      updateApplicationSchema.safeParse({ email: "not-an-email" }).success
    ).toBe(false);
  });

  it("still validates annualIncome min=0 when provided", () => {
    expect(
      updateApplicationSchema.safeParse({ annualIncome: -500 }).success
    ).toBe(false);
  });
});
