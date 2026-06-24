/**
 * Tests for src/modules/voice-intake/get-application-status.ts — the read-only
 * status/screening lookup by application id.
 */

const mockQuery = jest.fn();
jest.mock("../config/database", () => ({
  query: (...args: unknown[]) => mockQuery(...args),
}));
jest.mock("../utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import {
  getApplicationStatusHandler,
  registerGetApplicationStatusHandler,
  __resetRegistrationForTests,
} from "../modules/voice-intake/get-application-status";
import {
  clearToolHandlersForTests,
  getRegisteredToolNames,
} from "../modules/voice-intake/tool-callbacks";

const CTX = {
  agentId: "agent_test",
  conversationId: "conv_GS_1",
  toolCallId: "tc_GS_1",
  toolName: "get_application_status" as const,
};
const APP_ID = "44444444-4444-4444-4444-444444444444";

beforeEach(() => jest.clearAllMocks());

describe("getApplicationStatusHandler", () => {
  it("returns ok:false when application_id is missing", async () => {
    const r = await getApplicationStatusHandler({}, CTX);
    expect(r.ok).toBe(false);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("returns ok:false for an unknown id", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const r = await getApplicationStatusHandler({ application_id: APP_ID }, CTX);
    expect(r.ok).toBe(false);
  });

  it("returns the status + screening verdicts for a known application", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          status: "screening_passed",
          submitted_at: new Date(),
          screening_authorization_at: new Date(),
          identity_verification_result: "pass",
          background_check_result: "pass",
          credit_check_result: "pass",
          compliance_check_result: "pass",
          income_verification_result: null,
        },
      ],
    });
    const r = await getApplicationStatusHandler({ application_id: APP_ID }, CTX);
    expect(r.ok).toBe(true);
    expect(r.result?.status).toBe("screening_passed");
    expect(r.result?.submitted).toBe(true);
    expect(r.result?.consented).toBe(true);
    expect((r.result?.screening as any).identity).toBe("pass");
    expect(r.message).toContain("screening_passed");
  });

  it("registers the get_application_status handler", () => {
    clearToolHandlersForTests();
    __resetRegistrationForTests();
    registerGetApplicationStatusHandler();
    expect(getRegisteredToolNames()).toContain("get_application_status");
  });
});
