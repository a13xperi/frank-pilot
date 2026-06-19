/**
 * Graduation + dedup tests for src/modules/waitlist-graduation/service.ts.
 *
 * The local Postgres goes through a mockQuery SQL-shape router; the transaction
 * helper is mocked to run its callback with a client backed by the same router.
 * We assert: idempotent re-run, the not-found error code, relationship reuse
 * from a prior application's dob_hash, and the unkeyed (NULL relationship) path.
 */

process.env.IDENTITY_HASH_SALT = "test-salt-fixed";

const mockQuery = jest.fn();
jest.mock("../config/database", () => ({
  query: (...args: unknown[]) => mockQuery(...args),
  transaction: async (fn: (client: { query: typeof mockQuery }) => Promise<unknown>) =>
    fn({ query: mockQuery }),
}));

jest.mock("../utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const mockStampTape = jest.fn().mockResolvedValue(null);
jest.mock("../modules/tape", () => ({
  stampTape: (...args: unknown[]) => mockStampTape(...args),
}));

import {
  graduateWaitlistEntry,
  resolveRelationshipId,
} from "../modules/waitlist-graduation/service";

interface EntryFixture {
  graduated_application_id?: string | null;
  dob_hint?: string | null;
  phone?: string | null;
}

function baseEntryRow(f: EntryFixture) {
  return {
    id: "wl-1",
    property_id: "prop-1",
    bedroom_count: 2,
    applicant_user_id: "user-1",
    graduated_application_id: f.graduated_application_id ?? null,
    first_name: "Jane",
    last_name: "Doe",
    email: "jane@example.com",
    phone: f.phone ?? "+17025551234",
    dob_encrypted: f.dob_hint ? "enc" : null,
    dob_hint: f.dob_hint ?? null,
  };
}

const calls: Array<{ sql: string; params: unknown[] }> = [];

function routeForGraduate(opts: {
  entry: EntryFixture;
  priorRelationshipId?: string | null;
}): void {
  calls.length = 0;
  mockQuery.mockImplementation((sql: string, params: unknown[]) => {
    calls.push({ sql, params: params as unknown[] });
    // Entry lookup join.
    if (sql.includes("FROM waitlist_entries w") && sql.includes("JOIN users u")) {
      return Promise.resolve({ rows: [baseEntryRow(opts.entry)] });
    }
    // Relationship lookup by dob_hash.
    if (sql.includes("SELECT relationship_id FROM applications")) {
      return Promise.resolve({
        rows: opts.priorRelationshipId
          ? [{ relationship_id: opts.priorRelationshipId }]
          : [],
      });
    }
    // person_identities bump.
    if (sql.includes("UPDATE person_identities")) {
      return Promise.resolve({ rows: [] });
    }
    // Application insert (inside the transaction).
    if (sql.includes("INSERT INTO applications")) {
      return Promise.resolve({ rows: [{ id: "app-new" }] });
    }
    // Waitlist back-reference update.
    if (sql.includes("UPDATE waitlist_entries")) {
      return Promise.resolve({ rows: [] });
    }
    return Promise.resolve({ rows: [] });
  });
}

beforeEach(() => {
  mockQuery.mockReset();
  mockStampTape.mockClear();
});

describe("graduateWaitlistEntry", () => {
  it("creates an application draft and links relationship from a prior app's dob_hash", async () => {
    routeForGraduate({
      entry: { dob_hint: "dobhash-abc" },
      priorRelationshipId: "rel-99",
    });
    const result = await graduateWaitlistEntry({
      waitlistEntryId: "wl-1",
      actorId: "agent-1",
    });
    expect(result).toEqual({
      applicationId: "app-new",
      relationshipId: "rel-99",
      created: true,
    });
    // The application insert carried relationship_id + dob_hash.
    const insert = calls.find((c) => c.sql.includes("INSERT INTO applications"));
    expect(insert).toBeTruthy();
    expect(insert!.params).toContain("rel-99");
    expect(insert!.params).toContain("dobhash-abc");
    // Tape stamped.
    expect(mockStampTape).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "WAITING_LIST_APP_CAPTURED" })
    );
  });

  it("is idempotent — returns the existing application without re-inserting", async () => {
    routeForGraduate({ entry: { graduated_application_id: "app-existing" } });
    const result = await graduateWaitlistEntry({
      waitlistEntryId: "wl-1",
      actorId: "agent-1",
    });
    expect(result).toEqual({
      applicationId: "app-existing",
      relationshipId: null,
      created: false,
    });
    expect(calls.some((c) => c.sql.includes("INSERT INTO applications"))).toBe(false);
    expect(mockStampTape).not.toHaveBeenCalled();
  });

  it("graduates with NULL relationship when the user has no prior DOB hash", async () => {
    routeForGraduate({ entry: { dob_hint: null } });
    const result = await graduateWaitlistEntry({
      waitlistEntryId: "wl-1",
      actorId: "agent-1",
    });
    expect(result.created).toBe(true);
    expect(result.relationshipId).toBeNull();
    const insert = calls.find((c) => c.sql.includes("INSERT INTO applications"))!;
    // INSERT param order: property_id, first_name, last_name, email, phone,
    // requested_move_in_date, relationship_id, dob_hash, submitted_by.
    expect(insert.params[6]).toBeNull(); // relationship_id
    expect(insert.params[7]).toBeNull(); // dob_hash
  });

  it("throws WAITLIST_ENTRY_NOT_FOUND for an unknown id", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await expect(
      graduateWaitlistEntry({ waitlistEntryId: "ghost", actorId: null })
    ).rejects.toMatchObject({ code: "WAITLIST_ENTRY_NOT_FOUND" });
  });
});

describe("resolveRelationshipId", () => {
  it("returns null when the (phone, DOB) pair can't be keyed", async () => {
    const r = await resolveRelationshipId({ phone: null, dob: "1990-01-02" });
    expect(r).toBeNull();
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("upserts person_identities and reports created from xmax", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: "rel-new", created: true }],
    });
    const r = await resolveRelationshipId({
      phone: "+17025551234",
      dob: "1990-01-02",
      displayName: "Jane Doe",
    });
    expect(r).toMatchObject({ relationshipId: "rel-new", created: true });
    expect(r!.identityHash).toMatch(/^[0-9a-f]{64}$/);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("INSERT INTO person_identities");
    expect(sql).toContain("ON CONFLICT (identity_hash)");
    expect(params[2]).toBe("1234"); // phone_last4
  });

  it("reports created:false on an existing identity (xmax<>0)", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: "rel-old", created: false }] });
    const r = await resolveRelationshipId({
      phone: "7025551234",
      dob: "1990-01-02",
    });
    expect(r).toMatchObject({ relationshipId: "rel-old", created: false });
  });
});
