/**
 * Config for the on-call DTMF payment path: Twilio `<Pay>` → Stripe Pay Connector.
 *
 * PCI posture is SAQ-A: Twilio captures the card over DTMF and tokenizes/charges
 * it through the Stripe Pay Connector — the PAN never reaches our server. See
 * docs/FRANK-PHONE-PAYMENT-PCI.md ("<Pay> connector — gating unknown RESOLVED").
 *
 * DARK by default: `<Pay>` is only emitted when PAY_DTMF_ENABLED === "true".
 * Until then /twiml speaks an "unavailable, we'll text the link" line so a
 * mis-routed call degrades to the working email-link path instead of erroring.
 */

/** The $35.95 application fee, as the decimal string the `<Pay chargeAmount>` attribute wants. */
export const APPLICATION_FEE_DOLLARS = "35.95";

/** Twilio action URL for the `<Pay>` outcome callback (mounted under /api/pay). */
export const PAY_RESULT_ACTION = "/api/pay/result";

/** Gate: only emit the live `<Pay>` verb when explicitly enabled. */
export function payDtmfEnabled(): boolean {
  return process.env.PAY_DTMF_ENABLED === "true";
}

/**
 * The unique name of the Stripe Pay Connector instance installed in the Twilio
 * console (docs pattern: Stripe_Dev = Test, Stripe_Prod = Live). Defaults to the
 * test instance so a stray enable can't touch live funds.
 */
export function payStripeConnector(): string {
  return process.env.PAY_STRIPE_CONNECTOR || "Stripe_Dev";
}
