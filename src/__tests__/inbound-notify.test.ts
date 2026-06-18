/**
 * Tests for src/modules/voice-intake/inbound-notify.ts — Phase 2 inbound
 * post-call notifications (team care-line alert + caller callback confirmation).
 *
 * TwilioService is mocked so we assert on sendSMS(to, message) calls without a
 * live transmit. service.ts's heavy imports (db/tape/magic-link) are mocked so
 * importing it is side-effect-free; pickField/normalizePhone stay REAL.
 */
import type { PostCallPayload, PersistResult } from "../modules/voice-intake/service";

const mockSendSMS = jest.fn();
jest.mock("../modules/integrations/twilio", () => ({
  TwilioService: jest.fn().mockImplementation(() => ({ sendSMS: mockSendSMS })),
}));
jest.mock("../utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock("../config/database", () => ({ query: jest.fn() }));
jest.mock("../modules/tape", () => ({ stampTape: jest.fn() }));
jest.mock("../modules/auth/magic-link-service", () => ({ sendMagicLinkSms: jest.fn() }));

import { maybeNotifyInbound } from "../modules/voice-intake/inbound-notify";

const INBOUND = "agent_8001ksp9ar8cf8ct2x70kacxr8qq";

function payload(fields: Record<string, string>, agent: string = INBOUND): PostCallPayload {
  const data_collection_results: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) data_collection_results[k] = { value: v };
  return {
    conversation_id: "conv_test_1",
    agent_id: agent,
    analysis: { data_collection_results },
  } as PostCallPayload;
}

function result(callbackRequested = false): PersistResult {
  return {
    callId: "c1",
    language: "en",
    callSuccessful: "success",
    consentRecording: true,
    callbackRequested,
  };
}

const ENV = process.env;
beforeEach(() => {
  jest.clearAllMocks();
  process.env = { ...ENV };
});
afterAll(() => {
  process.env = ENV;
});

describe("maybeNotifyInbound", () => {
  it("does nothing when the flag is off", async () => {
    delete process.env.FRANK_INBOUND_NOTIFY_ENABLED;
    await maybeNotifyInbound(payload({ incident_category: "maintenance" }), result());
    expect(mockSendSMS).not.toHaveBeenCalled();
  });

  it("ignores non-inbound agents", async () => {
    process.env.FRANK_INBOUND_NOTIFY_ENABLED = "true";
    process.env.TEAM_ALERT_NUMBER = "+15550001111";
    await maybeNotifyInbound(payload({ incident_category: "safety" }, "agent_outbound"), result());
    expect(mockSendSMS).not.toHaveBeenCalled();
  });

  it("SMSes the team on a care report, flagged URGENT for high severity", async () => {
    process.env.FRANK_INBOUND_NOTIFY_ENABLED = "true";
    process.env.TEAM_ALERT_NUMBER = "+15550001111";
    await maybeNotifyInbound(
      payload({
        incident_category: "safety",
        incident_severity: "high",
        unit_or_location: "Unit 2B",
        reporter_name: "Dana W",
      }),
      result()
    );
    expect(mockSendSMS).toHaveBeenCalledTimes(1);
    const [to, msg] = mockSendSMS.mock.calls[0];
    expect(to).toBe("+15550001111");
    expect(msg).toContain("URGENT");
    expect(msg).toContain("safety");
    expect(msg).toContain("Unit 2B");
    expect(msg).toContain("Dana W");
  });

  it("does NOT flag URGENT for a routine care report", async () => {
    process.env.FRANK_INBOUND_NOTIFY_ENABLED = "true";
    process.env.TEAM_ALERT_NUMBER = "+15550001111";
    await maybeNotifyInbound(payload({ incident_category: "noise" }), result());
    expect(mockSendSMS).toHaveBeenCalledTimes(1);
    expect(mockSendSMS.mock.calls[0][1]).not.toContain("URGENT");
  });

  it("skips the team SMS when TEAM_ALERT_NUMBER is unset", async () => {
    process.env.FRANK_INBOUND_NOTIFY_ENABLED = "true";
    delete process.env.TEAM_ALERT_NUMBER;
    await maybeNotifyInbound(payload({ incident_category: "pest" }), result());
    expect(mockSendSMS).not.toHaveBeenCalled();
  });

  it("DRY_RUN logs instead of sending", async () => {
    process.env.FRANK_INBOUND_NOTIFY_ENABLED = "true";
    process.env.FRANK_INBOUND_NOTIFY_DRY_RUN = "true";
    process.env.TEAM_ALERT_NUMBER = "+15550001111";
    await maybeNotifyInbound(payload({ incident_category: "maintenance" }), result());
    expect(mockSendSMS).not.toHaveBeenCalled();
  });

  it("does not alert when there is no incident_category (not a care report)", async () => {
    process.env.FRANK_INBOUND_NOTIFY_ENABLED = "true";
    process.env.TEAM_ALERT_NUMBER = "+15550001111";
    await maybeNotifyInbound(payload({ name: "Jo" }), result(false));
    expect(mockSendSMS).not.toHaveBeenCalled();
  });

  it("texts the caller a callback confirmation when callbackRequested", async () => {
    process.env.FRANK_INBOUND_NOTIFY_ENABLED = "true";
    process.env.TEAM_ALERT_NUMBER = "+15550001111";
    await maybeNotifyInbound(payload({ phone: "(702) 555-0123" }), result(true));
    expect(mockSendSMS).toHaveBeenCalledTimes(1);
    const [to, msg] = mockSendSMS.mock.calls[0];
    expect(String(to)).toMatch(/^\+\d{10,}$/);
    expect(String(msg).toLowerCase()).toContain("call you back");
  });
});
