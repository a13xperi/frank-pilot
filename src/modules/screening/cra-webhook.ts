import { Router, Request, Response } from "express";
import express from "express";
import { query } from "../../config/database";
import { writeAuditLog } from "../../middleware/audit";
import { logger } from "../../utils/logger";
import { transitionApplicationStatus } from "./state-machine";
import { BackgroundCheckService } from "./background-check";
import { CreditCheckService } from "./credit-check";

/**
 * Consumer-report CRA webhook receiver (Checkr background + TransUnion ShareAble
 * credit). This is the async leg of the applicant-mediated flow: submit() creates
 * the report orders and parks the app in `awaiting_consumer_report`; the CRA later
 * POSTs here when a report completes, we map + persist a categorical verdict, and
 * advance the app into `screening` (or HOLD it in `screening_review`).
 *
 * SECURITY-CRITICAL: like the Stripe receiver, this router MUST be mounted BEFORE
 * `express.json()` in src/index.ts — signature verification operates on the raw
 * request bytes, and any JSON parsing before us mutates the buffer.
 *
 * Idempotency mirrors the Stripe receiver: a `cra_processed_events` table
 * short-circuits a redelivered event_id with a 200, and the persist + transitions
 * are CAS-guarded on `status = 'awaiting_consumer_report'` so a late/duplicate
 * delivery after the app already advanced is a no-op.
 *
 * CREDENTIALING-GATED PARTS (NOT built here — see
 * docs/screening/background-credit-cra-adapter.md §4 vs "Credentialing-gated"):
 *   - Real HMAC signature verification against CHECKR_WEBHOOK_SECRET /
 *     the TransUnion equivalent. Until those secrets exist, the route refuses to
 *     process (503) rather than trust an unsigned payload — fail-closed.
 *   - The exact CRA event envelope shape (event type names, where the report
 *     object + application reference live). The synthetic envelope parsed below
 *     is what the unit tests exercise; the real field paths are marked
 *     `// TODO(credentialing)` and confirmed against a live sandbox before arming.
 *
 * Error handling: any throw during dispatch parks the payload in `cra_webhook_dlq`
 * and returns 200 — we NEVER 5xx a CRA (it would just retry the broken event).
 */

type Domain = "background" | "credit";

interface CraEventEnvelope {
  /** Unique event id for idempotency (CRA delivery retries reuse it). */
  id: string;
  /** Which report domain completed. */
  domain: Domain;
  /** Our application id, carried on the report order we created at submit(). */
  applicationId: string;
  /** The CRA report reference id. */
  reportId: string;
  /** Categorical CRA status (e.g. `complete`, `canceled`, `suspended`). */
  status: string;
  /** The raw CRA report object (mapped to a categorical verdict; never persisted whole). */
  report?: unknown;
}

// ── idempotency + DLQ (mirror payment/webhook.ts) ─────────────────────────────

async function alreadyProcessed(eventId: string): Promise<boolean> {
  const result = await query(
    `SELECT 1 FROM cra_processed_events WHERE event_id = $1 LIMIT 1`,
    [eventId]
  );
  return result.rows.length > 0;
}

async function markProcessed(
  eventId: string,
  domain: string,
  applicationId: string | null
): Promise<void> {
  await query(
    `INSERT INTO cra_processed_events (event_id, domain, application_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (event_id) DO NOTHING`,
    [eventId, domain, applicationId]
  );
}

const DLQ_ACTIVE_ROW_CAP = 10_000;

async function activeDlqRowCount(): Promise<number> {
  const result = await query(
    `SELECT COUNT(*)::int AS count FROM cra_webhook_dlq WHERE attempt_count < 5`,
    []
  );
  return Number(result.rows[0]?.count ?? 0);
}

async function recordDlq(
  eventId: string,
  domain: string,
  rawPayload: unknown,
  err: Error
): Promise<void> {
  try {
    const alreadyParked = await query(
      `SELECT 1 FROM cra_webhook_dlq WHERE event_id = $1 LIMIT 1`,
      [eventId]
    );
    if (alreadyParked.rows.length === 0) {
      const activeCount = await activeDlqRowCount();
      if (activeCount >= DLQ_ACTIVE_ROW_CAP) {
        logger.warn("CRA webhook DLQ at capacity — skipping new row", {
          eventId,
          domain,
          activeCount,
          cap: DLQ_ACTIVE_ROW_CAP,
        });
        return;
      }
    }
    await query(
      `INSERT INTO cra_webhook_dlq
         (event_id, domain, raw_payload, error_message)
       VALUES ($1, $2, $3::jsonb, $4)
       ON CONFLICT (event_id) DO UPDATE
         SET attempt_count = cra_webhook_dlq.attempt_count + 1,
             last_failed_at = NOW(),
             error_message = EXCLUDED.error_message`,
      [eventId, domain, JSON.stringify(rawPayload), err.message]
    );
  } catch (dlqErr) {
    logger.error("CRA webhook DLQ insert failed", {
      eventId,
      error: (dlqErr as Error).message,
    });
  }
}

// ── envelope parsing (CREDENTIALING-GATED shape) ──────────────────────────────

/**
 * Normalize the incoming CRA payload to our internal envelope. The real Checkr /
 * TransUnion envelopes differ from this synthetic shape; this is the seam where
 * the per-vendor adapter would translate.
 */
function parseEnvelope(body: unknown): CraEventEnvelope | null {
  // TODO(credentialing): confirm the real Checkr (`{ type, data: { object } }`)
  // and TransUnion event envelopes and translate them into this internal shape.
  // The synthetic shape below is what the unit tests post.
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const domain = b.domain;
  if (domain !== "background" && domain !== "credit") return null;
  if (typeof b.id !== "string" || typeof b.applicationId !== "string") return null;
  if (typeof b.reportId !== "string" || typeof b.status !== "string") return null;
  return {
    id: b.id,
    domain,
    applicationId: b.applicationId,
    reportId: b.reportId,
    status: b.status,
    report: b.report,
  };
}

/** A CRA status the applicant can never recover from on their own → HOLD. */
function isTerminalFailure(status: string): boolean {
  const s = status.toLowerCase();
  return s === "canceled" || s === "cancelled" || s === "suspended" || s === "disputed";
}

// ── dispatch ──────────────────────────────────────────────────────────────────

/**
 * Map + persist a completed report's categorical verdict, then advance the app.
 *
 * PII discipline: we persist ONLY the mapped categorical response (counts,
 * statuses, the report reference) into the JSONB `*_details.rawResponse`. The
 * mappers (mapCheckrReportToResponse / mapShareAbleReportToResponse) strip
 * everything else; charge narratives / tradeline detail / addresses / full
 * DOB+SSN never leave the CRA.
 */
async function dispatch(env: CraEventEnvelope): Promise<void> {
  // A terminal failure status means the CRA never produced a verdict → HOLD.
  if (isTerminalFailure(env.status)) {
    await holdCouldNotScreen(env, `${env.domain} report ${env.status}`);
    return;
  }

  if (env.domain === "background") {
    const response = new BackgroundCheckService().mapCheckrReportToResponse(env.report);
    // Re-use the SAME evaluation policy as the synchronous path. We persist the
    // categorical-only mapped response; resolve() reads it back at screening time
    // and re-runs evaluateResults() (so the HUD-engine flag is applied then).
    const persisted = await query(
      `UPDATE applications SET
          consumer_report_background_status = $2,
          background_check_details = $3,
          background_check_completed_at = NOW()
        WHERE id = $1 AND status = 'awaiting_consumer_report'
        RETURNING id`,
      [
        env.applicationId,
        env.status,
        JSON.stringify({ reportId: env.reportId, rawResponse: response }),
      ]
    );
    if (persisted.rows.length === 0) {
      logger.info("CRA background verdict ignored — app not awaiting consumer report", {
        applicationId: env.applicationId,
        reportId: env.reportId,
      });
      return;
    }
    await writeAuditLog({
      action: "background_check_completed",
      applicationId: env.applicationId,
      resourceType: "application",
      details: {
        actor: "cra-webhook",
        vendor: "checkr",
        reportId: env.reportId,
        status: env.status,
        // categorical summary only
        felonies: response.felonies,
        sexOffenses: response.sexOffenses,
        violentCrimes: response.violentCrimes,
      },
    });
  } else {
    const response = new CreditCheckService().mapShareAbleReportToResponse(env.report);
    const persisted = await query(
      `UPDATE applications SET
          consumer_report_credit_status = $2,
          credit_score = $3,
          credit_check_details = $4,
          credit_check_completed_at = NOW()
        WHERE id = $1 AND status = 'awaiting_consumer_report'
        RETURNING id`,
      [
        env.applicationId,
        env.status,
        response.creditScore,
        JSON.stringify({ reportId: env.reportId, rawResponse: response }),
      ]
    );
    if (persisted.rows.length === 0) {
      logger.info("CRA credit verdict ignored — app not awaiting consumer report", {
        applicationId: env.applicationId,
        reportId: env.reportId,
      });
      return;
    }
    await writeAuditLog({
      action: "credit_check_completed",
      applicationId: env.applicationId,
      resourceType: "application",
      details: {
        actor: "cra-webhook",
        vendor: "transunion",
        reportId: env.reportId,
        status: env.status,
        creditScore: response.creditScore,
        evictions: response.evictions,
        bankruptcies: response.bankruptcies,
      },
    });
  }

  // Both reports must be in before we advance into screening — a single report
  // landing leaves the app in awaiting_consumer_report waiting on its sibling.
  await advanceIfBothReportsIn(env.applicationId);
}

/**
 * Advance awaiting_consumer_report -> screening once BOTH the background and
 * credit reports have completed (both `*_completed_at` set). Kicks the full
 * screening pipeline when auto-on-submit is armed; otherwise the app rests in
 * `screening` for staff to run manual /screen. resolve() will read the verdicts
 * we just persisted.
 */
async function advanceIfBothReportsIn(applicationId: string): Promise<void> {
  const ctx = await query(
    `SELECT a.status,
            a.background_check_completed_at,
            a.credit_check_completed_at,
            a.submitted_by,
            u.role AS submitter_role
       FROM applications a
       LEFT JOIN users u ON u.id = a.submitted_by
      WHERE a.id = $1`,
    [applicationId]
  );
  const row = ctx.rows[0];
  if (!row || row.status !== "awaiting_consumer_report") return;
  if (!row.background_check_completed_at || !row.credit_check_completed_at) {
    // Still waiting on the other report.
    return;
  }

  const advanced = await transitionApplicationStatus({
    applicationId,
    from: "awaiting_consumer_report",
    to: "screening",
    trigger: "consumer_report_resolved",
    actorId: row.submitted_by ?? undefined,
    actorRole: row.submitter_role ?? undefined,
    evidence: { source: "cra_webhook" },
  });
  if (!advanced.changed) return;

  if (process.env.SCREENING_ON_SUBMIT_ENABLED === "true" && row.submitted_by) {
    const initiatedBy = row.submitted_by as string;
    const initiatorRole = (row.submitter_role as string) ?? "applicant";
    void (async () => {
      try {
        const { ScreeningService } = await import("./service");
        await new ScreeningService().runFullScreening(applicationId, initiatedBy, initiatorRole);
      } catch (err) {
        logger.error("Post-consumer-report screening pipeline failed", {
          applicationId,
          error: (err as Error).message,
        });
      }
    })();
  }
}

/**
 * HOLD the application in screening_review for a could_not_screen — a terminal
 * CRA failure (canceled / suspended) means we never got a verdict. NEVER an
 * auto-pass. Guarded on awaiting_consumer_report so a late/duplicate event is a
 * no-op.
 */
async function holdCouldNotScreen(env: CraEventEnvelope, reason: string): Promise<void> {
  const statusCol =
    env.domain === "background"
      ? "consumer_report_background_status"
      : "consumer_report_credit_status";
  const persisted = await query(
    `UPDATE applications SET ${statusCol} = $2
      WHERE id = $1 AND status = 'awaiting_consumer_report'
      RETURNING id`,
    [env.applicationId, env.status]
  );
  if (persisted.rows.length === 0) {
    logger.info("CRA could_not_screen ignored — app not awaiting consumer report", {
      applicationId: env.applicationId,
      reportId: env.reportId,
    });
    return;
  }

  await transitionApplicationStatus({
    applicationId: env.applicationId,
    from: "awaiting_consumer_report",
    to: "screening_review",
    trigger: "could_not_screen",
    evidence: { source: "cra_webhook", domain: env.domain, reason },
  });
  await query(
    `UPDATE applications SET overall_screening_result = 'could_not_screen'
      WHERE id = $1 AND overall_screening_result IS NULL`,
    [env.applicationId]
  );
}

// ── router ──────────────────────────────────────────────────────────────────

const router = Router();

router.post(
  "/",
  express.raw({ type: "application/json", limit: "1mb" }),
  async (req: Request, res: Response): Promise<void> => {
    // CREDENTIALING-GATED: real signature verification. Until a CRA contract is
    // signed and CHECKR_WEBHOOK_SECRET (+ the TransUnion equivalent) exist, we
    // refuse to process — fail-closed, so an unsigned payload is never trusted.
    // The synthetic-payload tests set CRA_WEBHOOK_SECRET to exercise the path.
    const secret = process.env.CRA_WEBHOOK_SECRET ?? "";
    if (!secret || secret === "changeme") {
      res.status(503).json({ error: "CRA webhook secret not configured" });
      return;
    }

    // TODO(credentialing): verify the HMAC signature header against `secret`
    // using each vendor's documented scheme (Checkr `X-Checkr-Signature`,
    // TransUnion equivalent). For now we require the header to be present so the
    // contract is exercised, but the real constant-time HMAC compare is gated on
    // having a documented signing scheme + a live secret.
    const sig = req.headers["x-cra-signature"];
    if (!sig || Array.isArray(sig)) {
      res.status(400).json({ error: "Missing CRA signature header" });
      return;
    }

    let body: unknown;
    try {
      body = JSON.parse((req.body as Buffer).toString("utf8"));
    } catch {
      res.status(400).json({ error: "Invalid JSON" });
      return;
    }

    const env = parseEnvelope(body);
    if (!env) {
      logger.warn("CRA webhook unparseable envelope");
      res.status(400).json({ error: "Unrecognized event" });
      return;
    }

    if (await alreadyProcessed(env.id)) {
      logger.info("CRA webhook duplicate event short-circuited", { eventId: env.id });
      res.status(200).json({ received: true, duplicate: true });
      return;
    }

    let dispatchError: Error | null = null;
    try {
      await dispatch(env);
    } catch (err) {
      dispatchError = err as Error;
      logger.error("CRA webhook dispatch failed", {
        eventId: env.id,
        domain: env.domain,
        error: dispatchError.message,
      });
      await recordDlq(env.id, env.domain, body, dispatchError);
    }

    if (!dispatchError) {
      await markProcessed(env.id, env.domain, env.applicationId);
    }

    // Always 200 — DLQ is the recovery path, not retry.
    res.status(200).json({ received: true });
  }
);

export default router;
