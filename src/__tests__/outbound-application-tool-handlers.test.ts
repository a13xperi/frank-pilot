/**
 * Tool-handler tests for src/modules/outbound-application/tool-handlers.ts
 * (Frank core C3, "Jacqueline"). DB through the mockQuery shape router;
 * encryption is mocked to a deterministic stub so we can assert what gets
 * written without depending on a real key.
 *
 * These handlers run inside the signed/deduped voice tool-callback pipeline, so
 * they're fully testable WITHOUT any live telephony — that's why C3's tool half
 * is BUILT while the live dial is DEFERRED.
 */

const mockQuery = jest.fn();
jest.mock("../config/database", () => ({
  query: (...args: unknown[]) => mockQuery(...args),
}));

jest.mock("../utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.mock("../utils/encryption", () => ({
  encrypt: (s: string) => `enc(${s})`,
  hashSSN: (s: string) => `hash(${s})`,
}));

import {
  saveApplicationFieldHandler,
  submitApplicationHandler,
} from "../modules/outbound-application/tool-handlers";
import type { ToolCallbackContext } from "../modules/voice-intake/tool-callbacks";

const CTX: ToolCallbackContext = {
  agentId: "agent_jacqueline",
  conversationId: "conv_c3",
  toolCallId: "tc_1",
  toolName: "save_application_field",
};

const calls: Array<{ sql: string; params: unknown[] }> = [];
function routeDraft(status: string | null): void {
  calls.length = 0;
  mockQuery.mockImplementation((sql: string, params: unknown[]) => {
    calls.push({ sql, params: params as unknown[] });
    if (sql.includes("SELECT status FROM applications")) {
      return Promise.resolve({ rows: status ? [{ status }] : [] });
    }
    return Promise.resolve({ rows: [] });
  });
}

beforeEach(() => mockQuery.mockReset());

describe("saveApplicationFieldHandler", () => {
  it("encrypts SSN and sets the hash", async () => {
    routeDraft("draft");
    const r = await saveApplicationFieldHandler(
      { application_id: "app-1", field: "ssn", value: "123-45-6789" },
      CTX
    );
    expect(r.ok).toBe(true);
    const update = calls.find((c) => c.sql.includes("UPDATE applications SET"))!;
    expect(update.sql).toContain("ssn_encrypted = $2");
    expect(update.sql).toContain("ssn_hash = $3");
    expect(update.params).toEqual(["app-1", "enc(123456789)", "hash(123456789)"]);
  });

  it("rejects an incomplete SSN softly", async () => {
    routeDraft("draft");
    const r = await saveApplicationFieldHandler(
      { application_id: "app-1", field: "ssn", value: "123" },
      CTX
    );
    expect(r.ok).toBe(false);
    expect(calls.some((c) => c.sql.includes("UPDATE applications"))).toBe(false);
  });

  it("normalizes + encrypts a US-format DOB", async () => {
    routeDraft("draft");
    const r = await saveApplicationFieldHandler(
      { application_id: "app-1", field: "date_of_birth", value: "1/2/1990" },
      CTX
    );
    expect(r.ok).toBe(true);
    const update = calls.find((c) => c.sql.includes("UPDATE applications SET"))!;
    expect(update.params).toEqual(["app-1", "enc(1990-01-02)"]);
  });

  it("coerces a money field, stripping $ and commas", async () => {
    routeDraft("draft");
    await saveApplicationFieldHandler(
      { application_id: "app-1", field: "annual_income", value: "$52,000" },
      CTX
    );
    const update = calls.find((c) => c.sql.includes("UPDATE applications SET"))!;
    expect(update.sql).toContain("annual_income = $2");
    expect(update.params).toEqual(["app-1", 52000]);
  });

  it("rejects a non-whitelisted field", async () => {
    routeDraft("draft");
    const r = await saveApplicationFieldHandler(
      { application_id: "app-1", field: "status", value: "approved" },
      CTX
    );
    expect(r.ok).toBe(false);
    // Never even queried the draft — field gate is before the DB read.
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("refuses to mutate a submitted application", async () => {
    routeDraft("submitted");
    const r = await saveApplicationFieldHandler(
      { application_id: "app-1", field: "current_city", value: "Reno" },
      CTX
    );
    expect(r.ok).toBe(false);
    expect(calls.some((c) => c.sql.includes("UPDATE applications SET"))).toBe(false);
  });

  it("soft-fails on a missing application", async () => {
    routeDraft(null);
    const r = await saveApplicationFieldHandler(
      { application_id: "ghost", field: "current_city", value: "Reno" },
      CTX
    );
    expect(r.ok).toBe(false);
  });

  it("soft-fails when parameters are missing", async () => {
    const r = await saveApplicationFieldHandler({ application_id: "app-1" }, CTX);
    expect(r.ok).toBe(false);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

describe("submitApplicationHandler", () => {
  function routeSubmit(row: Record<string, unknown> | null): void {
    calls.length = 0;
    mockQuery.mockImplementation((sql: string, params: unknown[]) => {
      calls.push({ sql, params: params as unknown[] });
      if (sql.includes("SELECT status, first_name")) {
        return Promise.resolve({ rows: row ? [row] : [] });
      }
      return Promise.resolve({ rows: [], rowCount: 1 });
    });
  }

  it("submits a complete draft and completes the call row", async () => {
    routeSubmit({
      status: "draft",
      first_name: "Jane",
      last_name: "Doe",
      ssn_encrypted: "enc",
      date_of_birth_encrypted: "enc",
    });
    const r = await submitApplicationHandler({ application_id: "app-1" }, CTX);
    expect(r.ok).toBe(true);
    expect(r.result).toMatchObject({ submitted: true });
    expect(calls.some((c) => c.sql.includes("status = 'submitted'"))).toBe(true);
    expect(
      calls.some((c) => c.sql.includes("UPDATE outbound_application_calls"))
    ).toBe(true);
  });

  it("blocks submission and names the missing required fields", async () => {
    routeSubmit({
      status: "draft",
      first_name: "Jane",
      last_name: null,
      ssn_encrypted: null,
      date_of_birth_encrypted: "enc",
    });
    const r = await submitApplicationHandler({ application_id: "app-1" }, CTX);
    expect(r.ok).toBe(false);
    expect(r.result?.missing).toEqual(["last name", "Social Security number"]);
    expect(calls.some((c) => c.sql.includes("status = 'submitted'"))).toBe(false);
  });

  it("is idempotent on an already-submitted application", async () => {
    routeSubmit({ status: "submitted" });
    const r = await submitApplicationHandler({ application_id: "app-1" }, CTX);
    expect(r.ok).toBe(true);
    expect(r.result).toMatchObject({ alreadySubmitted: true });
    expect(calls.some((c) => c.sql.includes("status = 'submitted'"))).toBe(false);
  });

  it("soft-fails on a missing application", async () => {
    routeSubmit(null);
    const r = await submitApplicationHandler({ application_id: "ghost" }, CTX);
    expect(r.ok).toBe(false);
  });
});
