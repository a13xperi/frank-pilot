/**
 * Tests for get_property_details — free address + senior/family + amenities on the call.
 */
const mockQuery = jest.fn();
jest.mock("../config/database", () => ({ query: (...a: unknown[]) => mockQuery(...a) }));
jest.mock("../utils/logger", () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));

import {
  getPropertyDetailsHandler,
  registerGetPropertyDetailsHandler,
  __resetRegistrationForTests,
} from "../modules/voice-intake/get-property-details";
import { clearToolHandlersForTests, getRegisteredToolNames } from "../modules/voice-intake/tool-callbacks";

const CTX = { agentId: "a", conversationId: "c", toolCallId: "t", toolName: "get_property_details" as const };
beforeEach(() => jest.clearAllMocks());

describe("getPropertyDetailsHandler", () => {
  it("ok:false without a property name", async () => {
    const r = await getPropertyDetailsHandler({}, CTX);
    expect(r.ok).toBe(false);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("ok:false on no match", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const r = await getPropertyDetailsHandler({ property_name: "Nowhere" }, CTX);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/couldn't find/i);
  });

  it("returns full address, senior flag, and amenities", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        name: "Ethel Mae Robinson Senior Apartments",
        address_line1: "1327 H Street", address_line2: null, city: "Las Vegas", state: "NV", zip: "89106",
        property_type: "senior",
        amenities: ["Elevator access & ADA accommodations", "Community room", "Laundry on site"],
        pet_policy: "Cats and small dogs welcome", accessibility: ["ADA units"],
      }],
    });
    const r = await getPropertyDetailsHandler({ property_name: "Ethel Mae Robinson" }, CTX);
    expect(r.ok).toBe(true);
    expect(r.result?.is_senior).toBe(true);
    expect(r.result?.address).toBe("1327 H Street, Las Vegas, NV 89106");
    expect((r.result?.amenities as string[]).length).toBe(3);
    expect(r.message).toContain("senior");
    expect(r.message).toContain("1327 H Street");
  });

  it("labels a family property and tolerates empty amenities", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        name: "Donna Louise Apartments", address_line1: "6275 Donna St", address_line2: null,
        city: "North Las Vegas", state: "NV", zip: "89081",
        property_type: "family", amenities: [], pet_policy: null, accessibility: [],
      }],
    });
    const r = await getPropertyDetailsHandler({ property_name: "Donna Louise" }, CTX);
    expect(r.ok).toBe(true);
    expect(r.result?.is_senior).toBe(false);
    expect(r.result?.type).toBe("family");
    expect(r.message).toContain("North Las Vegas");
  });

  it("registers the handler", () => {
    clearToolHandlersForTests();
    __resetRegistrationForTests();
    registerGetPropertyDetailsHandler();
    expect(getRegisteredToolNames()).toContain("get_property_details");
  });
});
