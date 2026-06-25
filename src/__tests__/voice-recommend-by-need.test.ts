/**
 * Tests for recommend_by_need — senior vs family context-aware matching.
 */
const mockQuery = jest.fn();
jest.mock("../config/database", () => ({ query: (...a: unknown[]) => mockQuery(...a) }));
jest.mock("../utils/logger", () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));

import {
  recommendByNeedHandler,
  registerRecommendByNeedHandler,
  __resetRegistrationForTests,
} from "../modules/voice-intake/recommend-by-need";
import { clearToolHandlersForTests, getRegisteredToolNames } from "../modules/voice-intake/tool-callbacks";

const CTX = { agentId: "a", conversationId: "c", toolCallId: "t", toolName: "recommend_by_need" as const };
beforeEach(() => jest.clearAllMocks());

describe("recommendByNeedHandler", () => {
  it("filters to SENIOR communities when age_55_plus", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [
      { id: "u1", unit_number: "101", bedrooms: 1, monthly_rent: 747, available_from: null, property_name: "Ethel Mae Robinson Senior Apartments", property_type: "senior", property_address: "1327 H Street", property_city: "Las Vegas" },
    ]});
    const r = await recommendByNeedHandler({ age_55_plus: true, bedrooms: 1 }, CTX);
    const sql = mockQuery.mock.calls[0][0] as string;
    expect(sql).toContain("p.property_type = 'senior'");
    expect(r.result?.recommended_type).toBe("senior");
    expect((r.result?.options as any[])[0].is_senior).toBe(true);
    expect(r.message).toMatch(/senior community/i);
  });

  it("filters to FAMILY/mixed when not senior", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [
      { id: "u2", unit_number: "5", bedrooms: 2, monthly_rent: 1194, available_from: null, property_name: "Donna Louise Apartments", property_type: "family", property_address: "6275 Donna St", property_city: "North Las Vegas" },
    ]});
    const r = await recommendByNeedHandler({ household_size: 3, bedrooms: 2 }, CTX);
    const sql = mockQuery.mock.calls[0][0] as string;
    expect(sql).toContain("p.property_type = 'family' OR p.property_type = 'mixed_use'");
    expect(r.result?.recommended_type).toBe("family");
    expect((r.result?.options as any[])[0].is_senior).toBe(false);
  });

  it("applies a budget_max filter", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await recommendByNeedHandler({ age_55_plus: true, budget_max: 900 }, CTX);
    const params = mockQuery.mock.calls[0][1] as unknown[];
    expect(params).toContain(900);
  });

  it("returns a graceful empty message with no matches", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const r = await recommendByNeedHandler({ age_55_plus: true }, CTX);
    expect(r.ok).toBe(true);
    expect((r.result?.options as any[]).length).toBe(0);
    expect(r.message).toMatch(/senior community/i);
  });

  it("registers the handler", () => {
    clearToolHandlersForTests();
    __resetRegistrationForTests();
    registerRecommendByNeedHandler();
    expect(getRegisteredToolNames()).toContain("recommend_by_need");
  });
});
