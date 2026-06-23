import { Router, Request, Response } from "express";
import crypto from "crypto";
import { query } from "../../config/database";
import { logger } from "../../utils/logger";

/**
 * Concierge co-browse viewer routes (Phase 2 — DARK scaffold).
 *
 * GET /api/cobrowse/:id/view
 *   The applicant taps the texted link → the viewer page calls this to verify
 *   the one-time token and fetch session metadata before opening the live
 *   screencast. Fail-closed behind COBROWSE_ENABLED (503 while dark).
 *
 * Token model (mirrors auth/magic-link-service.ts): the link carries the RAW
 * token in `?vt=`; we sha256 it and compare to viewer_token_hash. Single-use +
 * short-lived: a used or expired token is rejected. The token is never logged.
 *
 * NOTE: the actual screencast transport (a WebSocket stream of the headless
 * browser the orchestrator drives) is NOT implemented — see the placeholder
 * below. This route only returns the session metadata the viewer shell needs.
 */

function hashToken(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

function pickQueryString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

const router = Router();

router.get("/:id/view", async (req: Request, res: Response): Promise<void> => {
  if (process.env.COBROWSE_ENABLED !== "true") {
    res.status(503).json({ error: "cobrowse_disabled" });
    return;
  }

  const sessionId = String(req.params.id ?? "");
  const rawToken = pickQueryString(req.query.vt);
  if (!sessionId || !rawToken) {
    res.status(400).json({ error: "missing_token" });
    return;
  }

  const tokenHash = hashToken(rawToken);

  let row:
    | {
        id: string;
        state: string;
        expires_at: string;
        used_at: string | null;
        application_id: string;
        fields_filled: number;
      }
    | undefined;
  try {
    const result = await query(
      `SELECT id, state, expires_at, viewer_token_used_at AS used_at,
              application_id, fields_filled
         FROM cobrowse_sessions
        WHERE id = $1 AND viewer_token_hash = $2
        LIMIT 1`,
      [sessionId, tokenHash]
    );
    row = result.rows[0];
  } catch (err) {
    logger.error("cobrowse view lookup failed", {
      sessionId,
      error: (err as Error).message,
    });
    res.status(500).json({ error: "internal_error" });
    return;
  }

  if (!row) {
    // Don't distinguish "no such session" from "wrong token" — both are 404.
    res.status(404).json({ error: "not_found" });
    return;
  }

  if (new Date(row.expires_at) < new Date()) {
    res.status(410).json({ error: "expired" });
    return;
  }

  if (row.used_at) {
    // Single-use: a viewer token that's already bound is not re-openable.
    res.status(409).json({ error: "already_used" });
    return;
  }

  // Bind the token to first view + advance the lifecycle. Best-effort: a write
  // failure here doesn't block returning the metadata (the stream isn't live
  // yet anyway).
  try {
    await query(
      `UPDATE cobrowse_sessions
          SET viewer_token_used_at = NOW(),
              state = CASE WHEN state = 'created' THEN 'viewer_connected' ELSE state END,
              updated_at = NOW()
        WHERE id = $1`,
      [sessionId]
    );
  } catch (err) {
    logger.warn("cobrowse view state update failed", {
      sessionId,
      error: (err as Error).message,
    });
  }

  // ===========================================================================
  // TODO(cobrowse, counsel-gated): open the WebSocket screencast stream here.
  // The viewer shell will upgrade to ws://.../api/cobrowse/:id/stream and the
  // orchestrator (runtime/orchestrator.ts — currently a STUB) will push frames
  // of the headless browser it drives. NOT implemented until the live
  // computer-use loop clears sign-off.
  // ===========================================================================

  res.status(200).json({
    sessionId: row.id,
    state: row.state,
    applicationId: row.application_id,
    fieldsFilled: row.fields_filled,
    // The viewer client uses this to decide whether to poll for the stream.
    streamReady: false,
  });
});

export default router;

export const __test = { hashToken };
