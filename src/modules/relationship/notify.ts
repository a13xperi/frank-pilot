import { query } from "../../config/database";
import { logger } from "../../utils/logger";
import { getEmailService } from "../integrations/email";
import { recordLedgerEntry } from "./ledger";

/**
 * The relationship notifier — "email the applicant at every meaningful step,"
 * Craig's ledger-of-truth ask, now that Frank's email is live (frankhousing.com).
 *
 * notifyPersonStep is BEST-EFFORT and NEVER THROWS — it's hooked from the
 * application_status chokepoint (transitionApplicationStatus), gated on the
 * exactly-once `changed === true` CAS, so each real transition notifies once.
 * It (1) sends the applicant a status email and (2) writes a relationship_ledger
 * row, both keyed by the application's email/phone.
 *
 * Dark by default: only fires when RELATIONSHIP_NOTIFY_ENABLED === "true".
 */

interface StepNotification {
  applicationId: string;
  toStatus: string;
  trigger: string;
}

// Status → human-facing email (heading + body) + a ledger event_type. Only the
// statuses worth telling the applicant about are mapped; others no-op.
function copyFor(status: string): { heading: string; body: string; event: string; terminal?: "approved" | "denied" } | null {
  switch (status) {
    case "screening":
      return {
        heading: "Your screening is underway",
        body: "We've started verifying your application — identity, credit, and background. This usually comes back within a few hours and we'll let you know the moment it's done.",
        event: "screening_started",
      };
    case "screening_review":
      return {
        heading: "Your application is under review",
        body: "Your application needs a quick manual review by our team. We'll follow up shortly with the outcome — nothing else is needed from you right now.",
        event: "screening_review",
      };
    case "screening_passed":
      return { heading: "Good news — you're approved", body: "", event: "screening_passed", terminal: "approved" };
    case "screening_failed":
      return { heading: "An update on your application", body: "", event: "screening_failed", terminal: "denied" };
    default:
      return null;
  }
}

export async function notifyPersonStep(n: StepNotification): Promise<void> {
  if (process.env.RELATIONSHIP_NOTIFY_ENABLED !== "true") return;
  const copy = copyFor(n.toStatus);
  if (!copy) return;

  try {
    const res = await query(
      `SELECT email, first_name, phone FROM applications WHERE id = $1`,
      [n.applicationId]
    );
    const row = res.rows[0];
    if (!row) return;

    const rawEmail = (row.email as string) ?? "";
    const deliverable =
      rawEmail && !rawEmail.endsWith("@voice-handoff.invalid") ? rawEmail : "";
    const name = (row.first_name as string) || "there";
    const phone = (row.phone as string) ?? null;

    let emailed = false;
    if (deliverable) {
      const email = getEmailService();
      let r;
      if (copy.terminal === "approved") r = await email.sendApproved(deliverable, name);
      else if (copy.terminal === "denied") r = await email.sendDenied(deliverable, name);
      else r = await email.sendStatusUpdate(deliverable, name, copy.heading, copy.body);
      emailed = r.sent;
    }

    // Record the step on the person's ledger of truth (the applicant-facing record).
    void recordLedgerEntry({
      phoneE164: phone,
      eventType: copy.event,
      channel: emailed ? "email" : "system",
      direction: emailed ? "outbound" : "internal",
      summary: copy.heading,
      ref: n.applicationId,
    });

    logger.info("relationship notify", {
      applicationId: n.applicationId,
      toStatus: n.toStatus,
      emailed,
    });
  } catch (err) {
    logger.warn("relationship notify failed (non-fatal)", {
      applicationId: n.applicationId,
      toStatus: n.toStatus,
      error: (err as Error).message,
    });
  }
}
