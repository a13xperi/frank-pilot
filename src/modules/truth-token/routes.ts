/**
 * routes.ts — public, read-only Truth Token verification.
 *
 * Mounted at /api/truth-tokens (in src/index.ts, behind TRUTH_TOKEN_ENABLED).
 * GET /verify/:answer_hash recomputes the stored token's source-set fingerprint
 * and reports whether it is internally consistent. Output is PII-free by
 * construction (verifyTruthToken returns only hashes, model id, source ids, and
 * a timestamp — never question/answer text), so this endpoint needs no auth.
 *
 * FAIL-CLOSED: an unknown or malformed answer_hash yields hash_valid:false (200)
 * — never an error that leaks internal state. Unexpected failures degrade to a
 * 503, never a crash.
 */

import { Router, Request, Response } from "express";
import { verifyTruthToken } from "./service";
import { logger } from "../../utils/logger";

// answer_hash is a 64-char lowercase SHA-256 hex digest. Reject anything else
// up front so the lookup can't be probed with arbitrary strings.
const HASH_RE = /^[0-9a-f]{64}$/;

export function truthTokenRoutes(): Router {
  const router: Router = Router();

  router.get("/verify/:answer_hash", async (req: Request, res: Response) => {
    const answerHash = String(req.params.answer_hash || "").toLowerCase();
    if (!HASH_RE.test(answerHash)) {
      // Malformed input is fail-closed: report not-valid rather than 400-leaking
      // the validation rule, matching the unknown-token path below.
      res.json({
        hash_valid: false,
        sources: [],
        model_id: null,
        created_at: null,
        ledger_contradiction: false,
      });
      return;
    }

    try {
      const result = await verifyTruthToken(answerHash);
      res.json(result);
    } catch (err) {
      const errName = err instanceof Error ? err.name : "UnknownError";
      logger.error("truth-token verify failed", { errorName: errName });
      res.status(503).json({
        error: "Token verification is temporarily unavailable. Please try again.",
      });
    }
  });

  return router;
}

export default truthTokenRoutes;
