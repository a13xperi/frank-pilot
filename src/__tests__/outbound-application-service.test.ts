/**
 * Queue-service tests for src/modules/outbound-application/service.ts (Frank
 * core C3 scaffolding). DB goes through the mockQuery shape router. Covers
 * computeNeededFields, the draft-only + not-found guards, idempotent enqueue,
 * and cancel.
 */

const mockQuery = jest.fn();
jest.mock("../config/database", () => ({
  query: (...args: unknown[]) => mockQuery(...args),
}));

jest.mock("../utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import {
  enqueueApplicationCall,
  cancelApplicationCall,
  computeNeededFields,
} from "../modules/outbound-application/service";

function draft(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "app-1",
    status: "draft",
    phone: "+17025551234",
    first_name: "Jane",
    date_of_birth_encrypted: null,
    ssn_encrypted: null,
    current_address_line1: null,
    current_city: null,
    current_state: null,
    current_zip: null,
    employer_name: null,
    annual_income: null,
    household_size: 1,
    ...over,
  };
}

beforeEach(() => mockQuery.mockReset());

describe("computeNeededFields", () => {
  it("flags every null collectible field", () => {
    const needed = computeNeededFields(draft());
    expect(needed).toContain("ssn_encrypted");
    expect(needed).toContain("date_of_birth_encrypted");
    expect(needed).toContain("current_city");
    // household_size is 1 (not null) → not needed.
    expect(needed).not.toContain("household_size");
  });

  it("returns [] when all collectible fields are present", () => {
    const full = draft({
      date_of_birth_encrypted: "enc",
      ssn_encrypted: "enc",
      current_address_line1: "1 Main",
      current_city: "Las Vegas",
      current_state: "NV",
      current_zip: "89101",
      employer_name: "Acme",
      annual_income: 50000,
      household_size: 2,
    });
    expect(computeNeededFields(full)).toEqual([]);
  });
});

describe("enqueueApplicationCall", () => {
  it("creates a queued row with computed needed fields for a draft", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [draft()] }) // SELECT application
      .mockResolvedValueOnce({ rows: [] }) // open-call check (none)
      .mockResolvedValueOnce({ rows: [{ id: "call-1", status: "queued" }] }); // INSERT
    const result = await enqueueApplicationCall({ applicationId: "app-1" });
    expect(result.created).toBe(true);
    expect(result.callId).toBe("call-1");
    expect(result.neededFields).toContain("ssn_encrypted");
    // INSERT carried last-4 + needed_fields jsonb.
    const insert = mockQuery.mock.calls[2];
    expect(insert[1][1]).toBe("1234"); // to_number_last4
    expect(insert[0]).toContain("INSERT INTO outbound_application_calls");
  });

  it("is idempotent — returns an existing open call without inserting", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [draft()] })
      .mockResolvedValueOnce({
        rows: [{ id: "call-existing", status: "queued", needed_fields: ["ssn_encrypted"] }],
      });
    const result = await enqueueApplicationCall({ applicationId: "app-1" });
    expect(result).toEqual({
      callId: "call-existing",
      status: "queued",
      neededFields: ["ssn_encrypted"],
      created: false,
    });
    // Only 2 queries — no INSERT.
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });

  it("throws APPLICATION_NOT_FOUND for an unknown application", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await expect(
      enqueueApplicationCall({ applicationId: "ghost" })
    ).rejects.toMatchObject({ code: "APPLICATION_NOT_FOUND" });
  });

  it("throws APPLICATION_NOT_DRAFT for a submitted application", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [draft({ status: "submitted" })] });
    await expect(
      enqueueApplicationCall({ applicationId: "app-1" })
    ).rejects.toMatchObject({ code: "APPLICATION_NOT_DRAFT" });
  });
});

describe("cancelApplicationCall", () => {
  it("returns true when an open call was canceled", async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 1 });
    expect(await cancelApplicationCall("app-1")).toBe(true);
  });
  it("returns false when there was nothing open", async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 0 });
    expect(await cancelApplicationCall("app-1")).toBe(false);
  });
});
