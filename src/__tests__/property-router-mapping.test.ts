/**
 * Mapping-CRUD tests for src/modules/property-router/mapping.ts.
 *
 * Covers DID normalization on write, channel whitelisting, the upsert SQL
 * shape, and the soft-disable rowCount path.
 */

const mockQuery = jest.fn();
jest.mock("../config/database", () => ({
  query: (...args: unknown[]) => mockQuery(...args),
}));

jest.mock("../utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import {
  upsertMapping,
  deactivateMapping,
} from "../modules/property-router/mapping";

beforeEach(() => mockQuery.mockReset());

describe("upsertMapping", () => {
  it("normalizes the DID to +1E.164 and whitelists channels", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: "m1" }] });
    await upsertMapping({
      propertyId: "prop-1",
      agentId: "agent_a",
      agentLabel: "Care",
      inboundDid: "(702) 555-1234",
      channels: ["voice", "bogus", "sms"],
      priority: 5,
    });
    const [, params] = mockQuery.mock.calls[0];
    expect(params[0]).toBe("prop-1");
    expect(params[1]).toBe("agent_a");
    expect(params[3]).toBe("+17025551234"); // normalized DID
    expect(params[4]).toEqual(["voice", "sms"]); // bogus dropped
    expect(params[5]).toBe(5); // priority
    expect(params[6]).toBe(true); // active default
  });

  it("stores a null DID when none provided and defaults priority to 100", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: "m2" }] });
    await upsertMapping({ propertyId: "p", agentId: "a" });
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("ON CONFLICT (property_id, agent_id, priority)");
    expect(params[3]).toBeNull();
    expect(params[5]).toBe(100);
  });
});

describe("deactivateMapping", () => {
  it("returns true when a row was deactivated", async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 1 });
    expect(await deactivateMapping("m1")).toBe(true);
  });

  it("returns false when nothing changed", async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 0 });
    expect(await deactivateMapping("m1")).toBe(false);
  });
});
