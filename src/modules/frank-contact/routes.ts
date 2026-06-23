/**
 * routes.ts — Frank-as-a-contact (vCard) endpoint.
 *
 * Mounted at /api/frank (PUBLIC — no auth). GET /vcard returns a downloadable
 * vCard 3.0 (.vcf) so a tenant can save "Frank — Donna Louise" to their phone's
 * contacts in one tap and then call or text the automated housing assistant.
 *
 * The card is a static, hand-built constant: no user input, no DB, no model
 * call — there is nothing to fail closed AGAINST here, so the route is always
 * available (it carries no secrets and gates no spend). The phone number is the
 * provisioned Donna Louise line (+17252672488). Content-Type is the registered
 * text/vcard media type and Content-Disposition forces a download with a stable
 * filename so iOS/Android offer "Add to Contacts" rather than rendering text.
 */

import { Router, Request, Response } from "express";
import { logger } from "../../utils/logger";

// Provisioned Donna Louise assistant line, E.164. Single source of truth for
// the card; keep in sync with the voice/SMS number if it ever changes.
const FRANK_TEL = "+17252672488";

// vCard 3.0 — CRLF line endings per RFC 6350/2426. Built once at module load;
// the body never varies, so there is no per-request work and nothing to cache.
const FRANK_VCARD = [
  "BEGIN:VCARD",
  "VERSION:3.0",
  "FN:Frank — Donna Louise",
  "ORG:Donna Louise",
  `TEL;TYPE=CELL:${FRANK_TEL}`,
  "NOTE:Your automated housing assistant. Call or text anytime.",
  "END:VCARD",
].join("\r\n");

export function frankContactRouter(): Router {
  const router: Router = Router();

  // Public, unauthenticated download. No input to validate, no rate limit
  // (static body, no backend cost). Logs the hit (path only — no PII).
  router.get("/vcard", (req: Request, res: Response) => {
    logger.info("frank-contact vcard served", { path: req.path });
    res.setHeader("Content-Type", "text/vcard; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="frank.vcf"'
    );
    res.status(200).send(FRANK_VCARD);
  });

  return router;
}

export default frankContactRouter();
