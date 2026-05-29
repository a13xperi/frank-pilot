import { Router, Response } from "express";
import { authenticate, AuthRequest } from "../../middleware/auth";
import { query } from "../../config/database";
import { logger } from "../../utils/logger";
import { pickField, normalizePhone } from "./service";

/**
 * Applicant-facing voice-intake endpoints.
 *
 * Mount path: /api/voice/intakes
 *
 * Distinct from src/modules/voice-intake/routes.ts (the PM-console router at
 * /api/pm/voice-intakes) — that one is staff-only behind RBAC permissions
 * like `voice_intake:view`. This router is for the applicant who just
 * landed via magic-link with `?intake=<conversation_id>` in the URL and
 * needs their voice-collected data to hydrate the wizard form.
 *
 * Only one endpoint today: GET /:conversationId/prefill. Returns a flat
 * normalized object the wizard can map straight onto its form state.
 * Authentication is required (any active user role); the conversation_id
 * is the secret, treated like an unguessable resource handle. We do not
 * cross-reference user ↔ conversation_id today because the matching identity
 * (phone) may not yet be on the user record at first paint, and we don't
 * want the wizard to flash an empty form while the link is still warm.
 *
 * No raw-body concerns — mounted AFTER global express.json() in src/index.ts.
 */

const router = Router();

router.get(
  "/:conversationId/prefill",
  authenticate,
  async (req: AuthRequest, res: Response): Promise<void> => {
    const conversationId = String(req.params.conversationId ?? "").trim();
    if (!conversationId || conversationId.length > 120) {
      res.status(400).json({ error: "Invalid conversation_id" });
      return;
    }

    try {
      const result = await query(
        `SELECT data_collection_results, language
           FROM voice_intake_calls
          WHERE conversation_id = $1
          LIMIT 1`,
        [conversationId]
      );
      const row = result.rows[0];
      if (!row) {
        // Soft-404: do NOT leak whether a conversation_id has ever existed.
        // The wizard treats this as "no prefill available" and renders the
        // blank form — same UX as a normal cold-start.
        res.status(404).json({ error: "Not found" });
        return;
      }

      const data = (row.data_collection_results ?? {}) as Record<string, unknown>;
      const name = pickField(data, "name");
      const [firstName, ...rest] = (name ?? "").split(/\s+/);
      const lastName = rest.join(" ");
      const phone = normalizePhone(pickField(data, "phone"));

      const householdRaw = pickField(data, "household") ?? pickField(data, "household_size");
      const householdSize = householdRaw ? parseInt(householdRaw, 10) || null : null;

      const incomeRaw = pickField(data, "monthly_income");
      const monthlyIncome = incomeRaw
        ? Number(incomeRaw.replace(/[^0-9.]/g, "")) || null
        : null;

      const currentCity = pickField(data, "current_city");
      const consent = pickField(data, "consent_recording");

      res.json({
        conversationId,
        language: row.language ?? null,
        prefill: {
          firstName: firstName || null,
          lastName: lastName || null,
          phone,
          currentCity,
          householdSize,
          monthlyIncome,
          consentRecording: consent === null ? null : /^(true|yes|1|y)$/i.test(consent),
        },
      });
    } catch (err) {
      logger.error("voice-intake prefill failed", {
        error: (err as Error).message,
        conversationId,
      });
      res.status(500).json({ error: "Failed to load prefill" });
    }
  }
);

export default router;
