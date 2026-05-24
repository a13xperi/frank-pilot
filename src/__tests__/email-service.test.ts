/**
 * EmailService (Resend) — unit tests.
 *
 * Locks the contract that:
 *   1. With RESEND_API_KEY set, `resend.emails.send` is invoked with the
 *      exact { from, to, subject, html, text } shape the templates produce.
 *   2. With RESEND_API_KEY unset, every send is a no-op that returns
 *      { sent: false } and never throws.
 *   3. A Resend API error (thrown or returned in `result.error`) is swallowed
 *      and converted to { sent: false } — no exception propagates to callers.
 *   4. The raw token is included exactly once in the magic-link email (inside
 *      the CTA href) and never in alt text, preview, or anywhere else.
 */

jest.mock("../utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const mockSend = jest.fn();
jest.mock(
  "resend",
  () => ({
    Resend: jest.fn().mockImplementation(() => ({
      emails: { send: mockSend },
    })),
  }),
  // `resend` is lazily `require()`'d inside email.ts only when RESEND_API_KEY
  // is set in prod. We mock it virtually so the test doesn't depend on the SDK
  // actually being present in node_modules (CI installs it from package.json,
  // local dev caches can drift).
  { virtual: true }
);

import { EmailService, __resetEmailServiceForTests } from "../modules/integrations/email";

describe("EmailService", () => {
  const ORIGINAL_API_KEY = process.env.RESEND_API_KEY;
  const ORIGINAL_FROM = process.env.RESEND_FROM;

  beforeEach(() => {
    jest.clearAllMocks();
    __resetEmailServiceForTests();
  });

  afterEach(() => {
    if (ORIGINAL_API_KEY === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = ORIGINAL_API_KEY;
    if (ORIGINAL_FROM === undefined) delete process.env.RESEND_FROM;
    else process.env.RESEND_FROM = ORIGINAL_FROM;
  });

  describe("when RESEND_API_KEY is unset", () => {
    beforeEach(() => {
      delete process.env.RESEND_API_KEY;
    });

    it("sendMagicLink returns { sent: false } and does not call Resend", async () => {
      const svc = new EmailService();
      const result = await svc.sendMagicLink("a@b.com", "https://x/auth/callback?token=raw");
      expect(result).toEqual({ sent: false });
      expect(mockSend).not.toHaveBeenCalled();
    });

    it("sendApplicationSubmitted is a no-op", async () => {
      const svc = new EmailService();
      const result = await svc.sendApplicationSubmitted("a@b.com", "Alex");
      expect(result).toEqual({ sent: false });
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('treats RESEND_API_KEY="changeme" the same as unset', async () => {
      process.env.RESEND_API_KEY = "changeme";
      const svc = new EmailService();
      const result = await svc.sendApproved("a@b.com", "Alex");
      expect(result).toEqual({ sent: false });
      expect(mockSend).not.toHaveBeenCalled();
    });

    it("sendPaymentReceipt is a no-op without an API key", async () => {
      const svc = new EmailService();
      const result = await svc.sendPaymentReceipt("a@b.com", {
        amountCents: 12500,
        currency: "usd",
        paymentIntentId: "pi_test_001",
      });
      expect(result).toEqual({ sent: false });
      expect(mockSend).not.toHaveBeenCalled();
    });
  });

  describe("when RESEND_API_KEY is set", () => {
    beforeEach(() => {
      process.env.RESEND_API_KEY = "re_test_key_abc123";
      process.env.RESEND_FROM = "CDPC Nevada <onboarding@resend.dev>";
    });

    it("sendMagicLink calls resend.emails.send with the expected shape", async () => {
      mockSend.mockResolvedValueOnce({ data: { id: "msg_001" }, error: null });

      const svc = new EmailService();
      const link = "https://portal.example/auth/callback?token=raw-token-xyz";
      const result = await svc.sendMagicLink("applicant@example.com", link, { firstName: "Alex" });

      expect(result).toEqual({ sent: true, messageId: "msg_001" });
      expect(mockSend).toHaveBeenCalledTimes(1);
      const args = mockSend.mock.calls[0]![0];
      expect(args).toEqual(
        expect.objectContaining({
          from: "CDPC Nevada <onboarding@resend.dev>",
          to: "applicant@example.com",
          subject: expect.stringMatching(/sign-in link/i),
          html: expect.any(String),
          text: expect.any(String),
        })
      );

      // The raw token must appear inside the CTA href, but nowhere else.
      const html = args.html as string;
      expect(html).toContain(`href="${link}"`);
      // The bare token (without ?token= prefix) must not appear in alt text,
      // preview text, or be repeated in the body — it should only ride along
      // inside the href above.
      const rawToken = "raw-token-xyz";
      const occurrences = html.split(rawToken).length - 1;
      expect(occurrences).toBe(1);

      // First-name personalization should land in the body.
      expect(html).toMatch(/Hi Alex,/);
      expect(args.text).toMatch(/Hi Alex,/);
      // Plain-text fallback should include the link.
      expect(args.text).toContain(link);
    });

    it("falls back to a generic greeting when firstName is missing", async () => {
      mockSend.mockResolvedValueOnce({ data: { id: "msg_002" }, error: null });
      const svc = new EmailService();
      await svc.sendMagicLink("applicant@example.com", "https://x/auth/callback?token=t");
      const args = mockSend.mock.calls[0]![0];
      expect(args.html).toMatch(/Hi,/);
      expect(args.text).toMatch(/^Hi,\n/);
    });

    it("sendApplicationSubmitted/Approved/Denied each call send() once with distinct subjects", async () => {
      mockSend
        .mockResolvedValueOnce({ data: { id: "m1" }, error: null })
        .mockResolvedValueOnce({ data: { id: "m2" }, error: null })
        .mockResolvedValueOnce({ data: { id: "m3" }, error: null });

      const svc = new EmailService();
      const a = await svc.sendApplicationSubmitted("a@b.com", "Alex");
      const b = await svc.sendApproved("a@b.com", "Alex");
      const c = await svc.sendDenied("a@b.com", "Alex");

      expect(a.sent && b.sent && c.sent).toBe(true);
      const subjects = mockSend.mock.calls.map((call) => call[0].subject);
      expect(new Set(subjects).size).toBe(3);
    });

    it("escapes HTML in user-supplied names to prevent injection in templates", async () => {
      mockSend.mockResolvedValueOnce({ data: { id: "m" }, error: null });
      const svc = new EmailService();
      await svc.sendApproved("a@b.com", '<script>alert("x")</script>');
      const args = mockSend.mock.calls[0]![0];
      expect(args.html).not.toContain("<script>");
      expect(args.html).toContain("&lt;script&gt;");
    });

    it("returns { sent: false } when Resend returns an error envelope (no throw)", async () => {
      mockSend.mockResolvedValueOnce({
        data: null,
        error: { message: "invalid_api_key" },
      });
      const svc = new EmailService();
      const result = await svc.sendMagicLink("a@b.com", "https://x/auth/callback?token=t");
      expect(result).toEqual({ sent: false });
    });

    it("returns { sent: false } when resend.emails.send throws (no propagation)", async () => {
      mockSend.mockRejectedValueOnce(new Error("network down"));
      const svc = new EmailService();
      const result = await svc.sendMagicLink("a@b.com", "https://x/auth/callback?token=t");
      expect(result).toEqual({ sent: false });
    });

    it("sendPaymentReceipt sends with the formatted amount in the subject + body", async () => {
      mockSend.mockResolvedValueOnce({ data: { id: "msg_rcpt" }, error: null });
      const svc = new EmailService();
      const result = await svc.sendPaymentReceipt("applicant@example.com", {
        firstName: "Alex",
        amountCents: 12500,
        currency: "usd",
        paymentIntentId: "pi_test_001",
        receiptUrl: "https://pay.stripe.com/receipts/abc",
        newBalanceCents: 0,
      });

      expect(result).toEqual({ sent: true, messageId: "msg_rcpt" });
      const args = mockSend.mock.calls[0]![0];
      expect(args).toEqual(
        expect.objectContaining({
          to: "applicant@example.com",
          subject: "Payment received — $125.00",
          html: expect.any(String),
          text: expect.any(String),
        })
      );
      // Personalization, confirmation id, balance, and the receipt link all land.
      expect(args.html).toMatch(/Hi Alex,/);
      expect(args.html).toContain("pi_test_001");
      expect(args.html).toContain("$125.00");
      expect(args.html).toContain("https://pay.stripe.com/receipts/abc");
      expect(args.text).toContain("Amount paid: $125.00");
    });

    it("sendRefundConfirmation sends with the refund reference + 'Refund issued' subject", async () => {
      mockSend.mockResolvedValueOnce({ data: { id: "msg_refund" }, error: null });
      const svc = new EmailService();
      const result = await svc.sendRefundConfirmation("applicant@example.com", {
        firstName: "Alex",
        amountCents: 5000,
        currency: "usd",
        refundId: "re_test_001",
        newBalanceCents: 7500,
      });

      expect(result).toEqual({ sent: true, messageId: "msg_refund" });
      const args = mockSend.mock.calls[0]![0];
      expect(args.subject).toBe("Refund issued — $50.00");
      expect(args.html).toContain("re_test_001");
      expect(args.text).toContain("Refund amount: $50.00");
    });
  });
});
