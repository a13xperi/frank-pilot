import { Router, Request, Response } from "express";
import express from "express";
import crypto from "crypto";
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
 * THREE RECEIVE PATHS, selected by header:
 *   - REAL CHECKR (`X-Checkr-Signature` present): HMAC-SHA256 verify against
 *     CHECKR_WEBHOOK_SECRET (or CHECKR_API_KEY), then translate Checkr's
 *     `{ id, type, data: { object } }` event — resolving our application by the
 *     report/invitation `candidate_id` (createReport persisted candidate.id as
 *     background_report_id, since the invitation flow yields no report id at
 *     create time). Built + tested here; arms when the secret is set.
 *   - REAL TRANSUNION SHAREABLE (`X-ShareAble-Signature` present): HMAC-SHA256
 *     verify against TRANSUNION_SHAREABLE_WEBHOOK_SECRET (or the API key), then
 *     translate ShareAble's `{ id, type, data: { object } }` event — resolving
 *     our application by the screening-request id (createReport persisted
 *     request.id as credit_report_id, since no report id exists until the
 *     applicant passes the hosted KBA exam). Built + tested here; arms when the
 *     secret is set. CREDENTIALING-GATED shape: the exact header, digest, event
 *     vocabulary, and object fields are confirmed against a live sandbox at arm
 *     time (TODO(credentialing) markers below).
 *   - SYNTHETIC (`x-cra-signature` present): a TEST-ONLY fixture envelope the
 *     unit tests post. It carries NO per-vendor HMAC, so it is gated to
 *     NODE_ENV=test and is unreachable (404) in any deployed environment — see
 *     the router below. Real vendors sign their payloads (Checkr above;
 *     TransUnion credit, this adapter).
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

// ── real Checkr ingestion (X-Checkr-Signature + { id, type, data: { object } }) ─

/**
 * Verify Checkr's `X-Checkr-Signature` — HMAC-SHA256 of the RAW request body,
 * keyed by the Checkr webhook secret (or the API key, per Checkr's scheme), hex
 * encoded. Constant-time compare on the raw bytes; an optional `sha256=` prefix
 * is tolerated. Any malformed input → false (reject), never throws.
 */
function verifyCheckrSignature(rawBody: Buffer, header: string, secret: string): boolean {
  const provided = header.startsWith("sha256=") ? header.slice(7) : header;
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  let a: Buffer;
  try {
    a = Buffer.from(provided, "hex");
  } catch {
    return false;
  }
  const b = Buffer.from(expected, "hex");
  if (a.length === 0 || a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * Map a Checkr event `type` to our categorical status. Returns null for types we
 * don't act on (e.g. `report.created`, `invitation.created`) so they ack 200 with
 * no side effects. Credit (TransUnion) is NOT handled here — separate adapter.
 */
function checkrEventStatus(type: string): string | null {
  switch (type) {
    case "report.completed":
      return "complete";
    case "report.canceled":
    case "report.cancelled":
      return "canceled";
    case "report.suspended":
      return "suspended";
    case "report.disputed":
      return "disputed";
    // The applicant never completed the hosted invitation → terminal, HOLD.
    case "invitation.expired":
    case "invitation.deleted":
      return "canceled";
    default:
      return null;
  }
}

/**
 * Translate a real Checkr event (`{ id, type, data: { object } }`) into our
 * internal CraEventEnvelope, resolving our applicationId from the report /
 * invitation object's `candidate_id` — createReport persisted candidate.id as
 * background_report_id (the invitation flow yields no report id at create time,
 * so candidate_id is the durable join key). Returns null for an event type we
 * don't act on, a malformed object, or an unknown candidate (→ 200 ack, no-op).
 */
async function translateCheckrEvent(body: unknown): Promise<CraEventEnvelope | null> {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, any>;
  const id = typeof b.id === "string" ? b.id : "";
  const type = typeof b.type === "string" ? b.type : "";
  const object = b.data && typeof b.data === "object" ? b.data.object : undefined;
  if (!id || !object || typeof object !== "object") return null;

  const status = checkrEventStatus(type);
  if (!status) return null;

  const candidateId = typeof object.candidate_id === "string" ? object.candidate_id : "";
  if (!candidateId) return null;

  const appRes = await query(
    `SELECT id FROM applications WHERE background_report_id = $1 LIMIT 1`,
    [candidateId]
  );
  const applicationId = appRes.rows[0]?.id;
  if (!applicationId || typeof applicationId !== "string") return null;

  // The report's own id once it exists (report.completed); else fall back to the
  // candidate id so the envelope always carries a stable reference.
  const reportId = typeof object.id === "string" ? object.id : candidateId;
  return { id, domain: "background", applicationId, reportId, status, report: object };
}

/**
 * Verify TransUnion ShareAble's `X-ShareAble-Signature` — HMAC-SHA256 of the RAW
 * request body, keyed by the ShareAble webhook secret (or the API key), hex
 * encoded. Constant-time compare; an optional `sha256=` prefix is tolerated. A
 * SEPARATE fn from verifyCheckrSignature so the per-vendor scheme can diverge —
 * malformed input → false (reject), never throws.
 * TODO(credentialing): confirm ShareAble's signature header + digest/encoding.
 */
function verifyShareAbleSignature(rawBody: Buffer, header: string, secret: string): boolean {
  const provided = header.startsWith("sha256=") ? header.slice(7) : header;
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  let a: Buffer;
  try {
    a = Buffer.from(provided, "hex");
  } catch {
    return false;
  }
  const b = Buffer.from(expected, "hex");
  if (a.length === 0 || a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * Map a TransUnion ShareAble event `type` to our categorical status. Returns null
 * for types we don't act on (e.g. `applicant.created`, `report.created`) so they
 * ack 200 with no side effects. Mirrors checkrEventStatus for the credit domain.
 * TODO(credentialing): confirm ShareAble's event-type vocabulary.
 */
function shareAbleEventStatus(type: string): string | null {
  switch (type) {
    case "report.completed":
    case "screening.completed":
      return "complete";
    case "report.canceled":
    case "report.cancelled":
    case "screening.canceled":
      return "canceled";
    case "report.suspended":
      return "suspended";
    case "report.disputed":
      return "disputed";
    // The applicant never passed the hosted KBA exam → terminal, HOLD.
    case "exam.expired":
    case "exam.failed":
      return "canceled";
    default:
      return null;
  }
}

/**
 * Translate a real TransUnion ShareAble event (`{ id, type, data: { object } }`)
 * into our internal CraEventEnvelope, resolving our applicationId from the
 * object's screening-request id — createReport persisted request.id as
 * credit_report_id (the durable join key; no report id exists until the applicant
 * passes the KBA exam and TU assembles the report). Returns null for an event
 * type we don't act on, a malformed object, or an unknown request (→ 200 ack,
 * no-op).
 * TODO(credentialing): confirm the event envelope, the request-id field on the
 * object, and where the report data is carried.
 */
async function translateShareAbleEvent(body: unknown): Promise<CraEventEnvelope | null> {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, any>;
  const id = typeof b.id === "string" ? b.id : "";
  const type = typeof b.type === "string" ? b.type : "";
  const object = b.data && typeof b.data === "object" ? b.data.object : undefined;
  if (!id || !object || typeof object !== "object") return null;

  const status = shareAbleEventStatus(type);
  if (!status) return null;

  const requestId =
    typeof object.request_id === "string"
      ? object.request_id
      : typeof object.screening_request_id === "string"
        ? object.screening_request_id
        : "";
  if (!requestId) return null;

  const appRes = await query(
    `SELECT id FROM applications WHERE credit_report_id = $1 LIMIT 1`,
    [requestId]
  );
  const applicationId = appRes.rows[0]?.id;
  if (!applicationId || typeof applicationId !== "string") return null;

  // The completed event carries the credit + eviction report; the mapper extracts
  // categorical-only fields. Fall back to the object itself if the report isn't
  // nested under `report`.
  const report = object.report && typeof object.report === "object" ? object.report : object;
  // The report's own id once it exists; else fall back to the request id so the
  // envelope always carries a stable reference.
  const reportId = typeof object.report_id === "string" ? object.report_id : requestId;
  return { id, domain: "credit", applicationId, reportId, status, report };
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

/**
 * Shared tail for BOTH receive paths once an envelope is in hand: dedup the
 * event id, dispatch (DLQ + 200 on throw — we NEVER 5xx a CRA), mark processed.
 * `body` is the parsed payload, parked verbatim in the DLQ on failure.
 */
async function processAndRespond(
  env: CraEventEnvelope,
  body: unknown,
  res: Response
): Promise<void> {
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

const router = Router();

router.post(
  "/",
  express.raw({ type: "application/json", limit: "1mb" }),
  async (req: Request, res: Response): Promise<void> => {
    const raw = req.body as Buffer;

    // ── Real Checkr path — discriminated by the X-Checkr-Signature header ──
    // HMAC-verify against CHECKR_WEBHOOK_SECRET (or the API key, per Checkr's
    // scheme) over the RAW body, then translate Checkr's event envelope.
    const checkrSig = req.headers["x-checkr-signature"];
    if (checkrSig !== undefined) {
      const checkrSecret =
        process.env.CHECKR_WEBHOOK_SECRET || process.env.CHECKR_API_KEY || "";
      if (!checkrSecret || checkrSecret === "changeme") {
        // Fail-closed: never trust a payload we cannot verify.
        res.status(503).json({ error: "Checkr webhook secret not configured" });
        return;
      }
      if (Array.isArray(checkrSig) || !verifyCheckrSignature(raw, checkrSig, checkrSecret)) {
        res.status(401).json({ error: "Invalid Checkr signature" });
        return;
      }

      let body: unknown;
      try {
        body = JSON.parse(raw.toString("utf8"));
      } catch {
        res.status(400).json({ error: "Invalid JSON" });
        return;
      }

      const env = await translateCheckrEvent(body);
      if (!env) {
        // An event type we don't act on, a malformed object, or an unknown
        // candidate → ack 200 with no side effects (Checkr would otherwise retry).
        res.status(200).json({ received: true, ignored: true });
        return;
      }

      await processAndRespond(env, body, res);
      return;
    }

    // ── Real TransUnion ShareAble path — discriminated by X-ShareAble-Signature ──
    // HMAC-verify against TRANSUNION_SHAREABLE_WEBHOOK_SECRET (or the API key)
    // over the RAW body, then translate ShareAble's event envelope (credit domain;
    // resolves the application by the screening-request id == credit_report_id).
    const shareAbleSig = req.headers["x-shareable-signature"];
    if (shareAbleSig !== undefined) {
      const shareAbleSecret =
        process.env.TRANSUNION_SHAREABLE_WEBHOOK_SECRET ||
        process.env.TRANSUNION_SHAREABLE_API_KEY ||
        "";
      if (!shareAbleSecret || shareAbleSecret === "changeme") {
        // Fail-closed: never trust a payload we cannot verify.
        res.status(503).json({ error: "TransUnion ShareAble webhook secret not configured" });
        return;
      }
      if (
        Array.isArray(shareAbleSig) ||
        !verifyShareAbleSignature(raw, shareAbleSig, shareAbleSecret)
      ) {
        res.status(401).json({ error: "Invalid ShareAble signature" });
        return;
      }

      let body: unknown;
      try {
        body = JSON.parse(raw.toString("utf8"));
      } catch {
        res.status(400).json({ error: "Invalid JSON" });
        return;
      }

      const env = await translateShareAbleEvent(body);
      if (!env) {
        // An event type we don't act on, a malformed object, or an unknown
        // request → ack 200 with no side effects (ShareAble would otherwise retry).
        res.status(200).json({ received: true, ignored: true });
        return;
      }

      await processAndRespond(env, body, res);
      return;
    }

    // ── Synthetic path — a TEST-ONLY fixture seam ──
    // This envelope carries NO per-vendor HMAC (it predates the real Checkr path
    // above), so it is verified only by header *presence*. That is safe ONLY
    // under test: in a deployed env, once CRA_WEBHOOK_SECRET is set to arm the
    // receiver, an unauthenticated caller could forge a verdict with a crafted
    // body + any `x-cra-signature` header. Gate it to NODE_ENV=test; real
    // vendors (Checkr + TransUnion credit above) sign their payloads.
    if (process.env.NODE_ENV !== "test") {
      res.status(404).json({ error: "Not found" });
      return;
    }

    const secret = process.env.CRA_WEBHOOK_SECRET ?? "";
    if (!secret || secret === "changeme") {
      res.status(503).json({ error: "CRA webhook secret not configured" });
      return;
    }

    const sig = req.headers["x-cra-signature"];
    if (!sig || Array.isArray(sig)) {
      res.status(400).json({ error: "Missing CRA signature header" });
      return;
    }

    let body: unknown;
    try {
      body = JSON.parse(raw.toString("utf8"));
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

    await processAndRespond(env, body, res);
  }
);

export default router;
