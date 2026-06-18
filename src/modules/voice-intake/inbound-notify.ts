import { logger } from "../../utils/logger";
import { TwilioService } from "../integrations/twilio";
import {
  pickField,
  normalizePhone,
  type PostCallPayload,
  type PersistResult,
} from "./service";

/**
 * Phase 2 of "Frank reaches out" — inbound post-call notifications.
 *
 * After the LIVE inbound front-desk agent finishes a call, optionally:
 *  - alert the team (SMS) when the call is a CARE-LINE report (urgent for high/emergency), and
 *  - text the caller a callback confirmation when they asked to be called back.
 *
 * Flag-gated (FRANK_INBOUND_NOTIFY_ENABLED, default off) and fire-and-forget — it must NEVER
 * throw into the webhook path. Reuses the existing TwilioService (the 725 line as the sender).
 */
const INBOUND_AGENT_ID = "agent_8001ksp9ar8cf8ct2x70kacxr8qq";

export async function maybeNotifyInbound(
  payload: PostCallPayload,
  result: PersistResult
): Promise<void> {
  if (process.env.FRANK_INBOUND_NOTIFY_ENABLED !== "true") return;
  // Only the inbound front-desk agent — never the outbound dialer / test agents.
  if (payload.agent_id && payload.agent_id !== INBOUND_AGENT_ID) return;

  const dry = process.env.FRANK_INBOUND_NOTIFY_DRY_RUN === "true";
  const data = payload.analysis?.data_collection_results;
  const twilio = new TwilioService();

  // --- Team alert on care-line reports (keyed off the agent's incident fields) ---
  const category = pickField(data, "incident_category");
  if (category) {
    const severity = (pickField(data, "incident_severity") || "").toLowerCase();
    const urgent = severity === "high" || severity === "emergency";
    const reporter = pickField(data, "reporter_name") || pickField(data, "name") || "a caller";
    const loc = pickField(data, "unit_or_location");
    const teamNum = process.env.TEAM_ALERT_NUMBER;
    const msg =
      `${urgent ? "URGENT — " : ""}Frank care report: ${category}` +
      (loc ? ` (${loc})` : "") +
      ` — reporter: ${reporter} [${payload.conversation_id}]`;
    if (!teamNum) {
      logger.warn("inbound-notify: TEAM_ALERT_NUMBER unset — team SMS skipped", {
        conversationId: payload.conversation_id,
      });
    } else if (dry) {
      logger.info("inbound-notify[dry-run]: would SMS team", { msgPreview: msg.slice(0, 80) });
    } else {
      await twilio.sendSMS(teamNum, msg);
    }
  }

  // --- Caller callback confirmation (only if they asked to be called back) ---
  if (result.callbackRequested) {
    const phone = normalizePhone(pickField(data, "phone"));
    if (phone) {
      const msg =
        "Thanks for calling the GPMG property team. We've logged your request and a property " +
        "manager will call you back shortly. — Community Development Programs Center of Nevada";
      if (dry) {
        logger.info("inbound-notify[dry-run]: would SMS caller a callback confirmation");
      } else {
        await twilio.sendSMS(phone, msg);
      }
    }
  }
}
