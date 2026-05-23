// Demo-link gate — decides whether a magic-link should be echoed back in the
// HTTP response (instead of being delivered only by email/SMS).
//
// This exists so a controlled group of usability testers can walk the real
// auth funnel without a working inbox (Resend is test-mode and only delivers
// to the account owner). It is a deliberate auth bypass, so it is gated:
//
//   1. NODE_ENV === "development"        — always on locally.
//   2. DEMO_LINK_SECRET set AND the request carries a matching `x-demo-token`
//      header — the link is only echoed to clients that hold the shared demo
//      token (i.e. arrived via the `?demo=<TOKEN>` deep link). This is the
//      production-safe path: random internet traffic never receives a devLink.
//   3. DEMO_LINK_IN_RESPONSE === "true"  — legacy fully-open switch, kept as a
//      transitional fallback. Prefer the secret. NEVER leave this on once a
//      DEMO_LINK_SECRET is configured.
//
// Returning a devLink for an arbitrary email is account-takeover-grade, so
// option 2 is the only one that should ever be live on a tenant-facing deploy.

export const DEMO_TOKEN_HEADER = "x-demo-token";

/** Minimal request shape — Express's `Request` satisfies this. */
export interface DemoLinkRequest {
  header(name: string): string | undefined;
}

export function shouldReturnDevLink(req: DemoLinkRequest): boolean {
  if (process.env.NODE_ENV === "development") return true;

  const secret = process.env.DEMO_LINK_SECRET;
  if (secret && secret.length > 0) {
    const provided = req.header(DEMO_TOKEN_HEADER);
    return typeof provided === "string" && provided === secret;
  }

  return process.env.DEMO_LINK_IN_RESPONSE === "true";
}
