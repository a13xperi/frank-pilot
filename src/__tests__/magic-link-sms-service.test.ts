/**
 * Magic-link SMS delivery — service layer.
 *
 * Locks the contract for sendMagicLink's `channel` option and sendMagicLinkSms:
 *   - 'sms' resolves the phone of record by user id and sends via Twilio with
 *     the link, email transport does NOT fire.
 *   - 'sms' with no phone on file → no SMS attempted, no throw.
 *   - an SMS send failure is swallowed (fire-and-forget) — never throws/rejects.
 *   - 'both' triggers email AND sms.
 *   - default (no channel) stays email-only — no phone lookup, no SMS.
 *   - sendMagicLinkSms accepts a raw phone number directly (no UUID lookup).
 *
 * TwilioService.sendSMS and the email service are mocked so no real client is
 * constructed. Mirrors the magic-link-service mocking style.
 */

jest.mock("../config/database", () => ({ query: jest.fn(), transaction: jest.fn() }));
jest.mock("../utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const mockSendSMS = jest.fn();
jest.mock("../modules/integrations/twilio", () => ({
  TwilioService: jest.fn().mockImplementation(() => ({ sendSMS: mockSendSMS })),
}));

const mockEmailSendMagicLink = jest.fn();
jest.mock("../modules/integrations/email", () => ({
  getEmailService: () => ({ sendMagicLink: mockEmailSendMagicLink }),
}));

import { query } from "../config/database";
import { sendMagicLink, sendMagicLinkSms } from "../modules/auth/magic-link-service";

const mockQuery = query as jest.MockedFunction<typeof query>;

// Let all pending fire-and-forget promise chains (.then/.catch) settle.
const flush = () => new Promise((resolve) => setImmediate(resolve));

const USER_ID = "11111111-1111-1111-1111-111111111111";
const LINK = "http://portal/auth/callback?token=raw-token";

describe("magic-link SMS delivery — service layer", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSendSMS.mockResolvedValue({ sent: true, messageId: "SM123" });
    mockEmailSendMagicLink.mockResolvedValue(undefined);
  });

  it("channel 'sms' resolves the phone by user id and sends via sendSMS with the link", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ phone: "+17025551234" }] } as any);

    sendMagicLink("u@example.com", LINK, { channel: "sms", userId: USER_ID });
    await flush();

    expect(mockQuery).toHaveBeenCalledWith("SELECT phone FROM users WHERE id = $1", [USER_ID]);
    expect(mockSendSMS).toHaveBeenCalledTimes(1);
    const [to, body] = mockSendSMS.mock.calls[0];
    expect(to).toBe("+17025551234");
    expect(body).toContain(LINK);
    // email transport must NOT fire for sms-only
    expect(mockEmailSendMagicLink).not.toHaveBeenCalled();
  });

  it("channel 'sms' with no phone on file does not attempt an SMS (and does not throw)", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ phone: null }] } as any);

    expect(() =>
      sendMagicLink("u@example.com", LINK, { channel: "sms", userId: USER_ID })
    ).not.toThrow();
    await flush();

    expect(mockSendSMS).not.toHaveBeenCalled();
  });

  it("SMS send failure is swallowed — does not throw, does not reject", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ phone: "+17025551234" }] } as any);
    mockSendSMS.mockRejectedValueOnce(new Error("twilio 500"));

    expect(() => sendMagicLinkSms(USER_ID, LINK)).not.toThrow();
    await flush();

    expect(mockSendSMS).toHaveBeenCalledTimes(1);
    // flush() completing without an unhandled rejection proves the .catch().
  });

  it("channel 'both' triggers email AND sms", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ phone: "+17025551234" }] } as any);

    sendMagicLink("u@example.com", LINK, { channel: "both", userId: USER_ID, firstName: "Bo" });
    await flush();

    expect(mockEmailSendMagicLink).toHaveBeenCalledTimes(1);
    expect(mockEmailSendMagicLink).toHaveBeenCalledWith("u@example.com", LINK, { firstName: "Bo" });
    expect(mockSendSMS).toHaveBeenCalledTimes(1);
  });

  it("default channel (none) stays email-only — no SMS call, no phone lookup", async () => {
    sendMagicLink("u@example.com", LINK, { firstName: "De", userId: USER_ID });
    await flush();

    expect(mockEmailSendMagicLink).toHaveBeenCalledTimes(1);
    expect(mockSendSMS).not.toHaveBeenCalled();
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("sendMagicLinkSms accepts a raw phone number directly (no UUID lookup)", async () => {
    sendMagicLinkSms("+17025559999", LINK);
    await flush();

    expect(mockQuery).not.toHaveBeenCalled();
    expect(mockSendSMS).toHaveBeenCalledTimes(1);
    expect(mockSendSMS.mock.calls[0][0]).toBe("+17025559999");
  });
});
