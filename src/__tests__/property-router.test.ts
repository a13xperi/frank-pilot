/**
 * Multi-property router tests for src/modules/property-router/service.ts.
 *
 * selectRoute is pure over candidate rows — the matrix covers priority
 * ordering, channel scoping, active filtering, and the no-match reasons.
 * routeInboundContact + resolvePropertyByDid go through the mockQuery router to
 * cover the propertyId path, the DID-resolution path, and the unknown-DID path.
 */

const mockQuery = jest.fn();
jest.mock("../config/database", () => ({
  query: (...args: unknown[]) => mockQuery(...args),
}));

jest.mock("../utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import {
  selectRoute,
  routeInboundContact,
  normalizeDid,
  type RoutingRow,
} from "../modules/property-router/service";

function row(over: Partial<RoutingRow> = {}): RoutingRow {
  return {
    id: over.id ?? "r1",
    property_id: over.property_id ?? "prop-1",
    agent_id: over.agent_id ?? "agent_a",
    agent_label: over.agent_label ?? "Agent A",
    inbound_did_e164: over.inbound_did_e164 ?? null,
    channels: over.channels ?? [],
    priority: over.priority ?? 100,
    active: over.active ?? true,
  };
}

describe("normalizeDid", () => {
  it("collapses +1 / 1-prefixed US numbers to a 10-digit core", () => {
    expect(normalizeDid("+1 (702) 555-1234")).toBe("7025551234");
    expect(normalizeDid("17025551234")).toBe("7025551234");
    expect(normalizeDid("7025551234")).toBe("7025551234");
  });
  it("returns null for too-short input", () => {
    expect(normalizeDid("12")).toBeNull();
    expect(normalizeDid(null)).toBeNull();
  });
});

describe("selectRoute (pure)", () => {
  it("returns no_active_agent when there are no rows", () => {
    expect(selectRoute([], "voice")).toEqual({ routed: false, reason: "no_active_agent" });
  });

  it("picks the lowest-priority active agent", () => {
    const d = selectRoute(
      [
        row({ id: "fallback", agent_id: "agent_fallback", priority: 200 }),
        row({ id: "primary", agent_id: "agent_primary", priority: 10 }),
      ],
      "voice"
    );
    expect(d.routed).toBe(true);
    expect(d.routingId).toBe("primary");
    expect(d.agentId).toBe("agent_primary");
  });

  it("ignores inactive rows", () => {
    const d = selectRoute(
      [row({ id: "off", priority: 1, active: false }), row({ id: "on", priority: 50 })],
      "voice"
    );
    expect(d.routingId).toBe("on");
  });

  it("honors channel scoping — empty channels serves all", () => {
    const d = selectRoute([row({ channels: [] })], "sms");
    expect(d.routed).toBe(true);
  });

  it("honors channel scoping — a voice-only row is skipped for sms", () => {
    const d = selectRoute([row({ channels: ["voice"] })], "sms");
    expect(d).toMatchObject({ routed: false, reason: "no_channel_match" });
  });

  it("matches a channel-scoped row when the channel fits", () => {
    const d = selectRoute([row({ channels: ["sms", "web"] })], "web");
    expect(d.routed).toBe(true);
  });

  it("breaks priority ties deterministically by agent_id", () => {
    const d = selectRoute(
      [
        row({ id: "z", agent_id: "agent_z", priority: 100 }),
        row({ id: "a", agent_id: "agent_a", priority: 100 }),
      ],
      "voice"
    );
    expect(d.agentId).toBe("agent_a");
  });
});

describe("routeInboundContact (DB-backed)", () => {
  beforeEach(() => mockQuery.mockReset());

  it("routes by explicit propertyId", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [row({ property_id: "prop-7", agent_id: "agent_7" })],
    });
    const d = await routeInboundContact({ propertyId: "prop-7", channel: "voice" });
    expect(d.routed).toBe(true);
    expect(d.propertyId).toBe("prop-7");
    expect(d.agentId).toBe("agent_7");
    // Only the listRoutesForProperty query ran (no DID resolution).
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockQuery.mock.calls[0][1]).toEqual(["prop-7"]);
  });

  it("resolves the property from a DID, then routes", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ property_id: "prop-did" }] }) // resolvePropertyByDid
      .mockResolvedValueOnce({ rows: [row({ property_id: "prop-did", agent_id: "agent_did" })] });
    const d = await routeInboundContact({ toDid: "+17025551234", channel: "voice" });
    expect(d.routed).toBe(true);
    expect(d.propertyId).toBe("prop-did");
    expect(d.agentId).toBe("agent_did");
    // First query is the DID lookup (digits param).
    expect(mockQuery.mock.calls[0][1]).toEqual(["7025551234"]);
  });

  it("returns unknown_did when the DID has no active mapping", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // resolvePropertyByDid miss
    const d = await routeInboundContact({ toDid: "+17025550000", channel: "voice" });
    expect(d).toEqual({ routed: false, reason: "unknown_did" });
  });

  it("returns no_property when neither propertyId nor DID is supplied", async () => {
    const d = await routeInboundContact({ channel: "voice" });
    expect(d).toEqual({ routed: false, reason: "no_property" });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("surfaces the propertyId even when no agent is mapped", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // listRoutesForProperty empty
    const d = await routeInboundContact({ propertyId: "prop-empty", channel: "voice" });
    expect(d.routed).toBe(false);
    expect(d.reason).toBe("no_active_agent");
    expect(d.propertyId).toBe("prop-empty");
  });
});
