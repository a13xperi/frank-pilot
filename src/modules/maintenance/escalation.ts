/**
 * Work-order escalation (D1, compliance-ledger-finish).
 *
 * Sits beside MaintenanceService and answers: which open work orders have gone
 * stale, which promised completion dates (ETAs) have been missed, and who needs
 * to be alerted? Three layers, deliberately separated so the decision logic is
 * unit-testable without a database or a live sender:
 *
 *   1. Pure logic — classifyWorkOrder(): given a row + thresholds + clock,
 *      decides outstanding? / promise-breached? / should-escalate? and the
 *      next escalation level. No IO.
 *   2. Service (WorkOrderEscalationService) — sweepStaleWorkOrders() reads open
 *      orders, applies the pure classifier, persists the outstanding/escalation
 *      flags, assembles a manager-alert payload per newly-escalated order, and
 *      hands each payload to a pluggable notifier.
 *   3. Notifier (WorkOrderNotifier) — a pure interface. NO live email/SMS sender
 *      is wired here (that's a separate, gated change); the default is a
 *      log-only notifier, and tests inject a mock.
 *
 * "Outstanding" is intentionally distinct from status='in_progress': it means a
 * stale order awaiting action regardless of whether work has started. A freshly
 * started order is in_progress but NOT outstanding; a submitted order untouched
 * for N days IS outstanding even though no one ever moved it to in_progress.
 */

import { query } from "../../config/database";
import { logger } from "../../utils/logger";

// ---------------------------------------------------------------------------
// Constants / config
// ---------------------------------------------------------------------------

/** Statuses we consider "open" — eligible for the stale-sweep. */
export const OPEN_WORK_ORDER_STATUSES = [
  "submitted",
  "assigned",
  "in_progress",
] as const;

/** Staleness thresholds (calendar days). Emergencies go stale fast. */
export interface StaleThresholds {
  /** submitted/assigned but never started. */
  unstartedDays: number;
  /** in_progress but not completed. */
  inProgressDays: number;
  /** emergency priority, any open status. */
  emergencyDays: number;
}

export const DEFAULT_STALE_THRESHOLDS: StaleThresholds = {
  unstartedDays: 3,
  inProgressDays: 7,
  emergencyDays: 1,
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The subset of a work_orders row the classifier reasons over. */
export interface WorkOrderRow {
  id: string;
  property_id: string;
  title: string;
  status: string;
  priority: string;
  is_emergency: boolean;
  created_at: string | Date;
  started_at: string | Date | null;
  assigned_to: string | null;
  estimated_completion_date: string | Date | null;
  is_outstanding: boolean;
  escalation_level: number;
  manager_alerted_at: string | Date | null;
}

/** Verdict from the pure classifier for one order at a given instant. */
export interface EscalationVerdict {
  workOrderId: string;
  /** Should this order be flagged outstanding (stale, awaiting action)? */
  outstanding: boolean;
  /** Days the order has been open (age). */
  ageDays: number;
  /** Promised ETA elapsed while still open? */
  promiseBreached: boolean;
  /** Should the sweep escalate (bump level + alert a manager) this tick? */
  shouldEscalate: boolean;
  /** The escalation level to persist (current level, or current+1 on escalate). */
  nextLevel: number;
  /** Short machine-readable reason, for the alert + logs. */
  reason: EscalationReason | null;
}

export type EscalationReason =
  | "emergency_stale"
  | "unstarted_stale"
  | "in_progress_stale"
  | "promise_breached";

/** The alert payload assembled per escalated order. This is what a notifier
 *  turns into an email/SMS/Slack message — NOT sent here. */
export interface ManagerAlertPayload {
  workOrderId: string;
  propertyId: string;
  title: string;
  priority: string;
  isEmergency: boolean;
  status: string;
  ageDays: number;
  escalationLevel: number;
  reason: EscalationReason;
  promiseBreached: boolean;
  estimatedCompletionDate: string | null;
  assignedTo: string | null;
  /** Human-readable one-liner for the alert body. */
  summary: string;
  /** When the alert was assembled (ISO). */
  generatedAt: string;
}

/**
 * Pluggable notifier. Implementations decide the channel. The escalation
 * service depends ONLY on this interface — no concrete email/SMS client is
 * imported here, so wiring a live sender is an isolated, separately-reviewed
 * change. Returning void; failures should be caught by the impl (the sweep
 * also guards each call).
 */
export interface WorkOrderNotifier {
  notifyManager(payload: ManagerAlertPayload): Promise<void>;
}

/** Default notifier: logs the alert. Deliberately does NOT send anything — a
 *  live channel is out of scope for D1 (build the detection + payload + the
 *  interface; do not wire a real sender). */
export class LoggingWorkOrderNotifier implements WorkOrderNotifier {
  async notifyManager(payload: ManagerAlertPayload): Promise<void> {
    logger.warn("Work order escalation — manager alert (log-only notifier)", {
      workOrderId: payload.workOrderId,
      propertyId: payload.propertyId,
      reason: payload.reason,
      ageDays: payload.ageDays,
      escalationLevel: payload.escalationLevel,
    });
  }
}

// ---------------------------------------------------------------------------
// Pure logic
// ---------------------------------------------------------------------------

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function toMs(v: string | Date): number {
  return v instanceof Date ? v.getTime() : new Date(v).getTime();
}

/** Whole days between two instants (floor, never negative). */
export function daysBetween(fromMs: number, toMsValue: number): number {
  return Math.max(0, Math.floor((toMsValue - fromMs) / MS_PER_DAY));
}

/**
 * Decide a work order's escalation verdict at instant `now`. Pure: no IO, no
 * Date.now() — the caller passes the clock so this is deterministic + testable.
 *
 * Outstanding rules (any one trips it):
 *   - emergency + open longer than emergencyDays
 *   - submitted/assigned (never started) longer than unstartedDays
 *   - in_progress longer than inProgressDays
 *   - promised ETA date is in the past while still open (promise breached)
 *
 * Escalation: escalate this tick when the order is outstanding AND no manager
 * alert has been sent yet at the level we're about to raise it to (i.e. a
 * promise breach re-escalates one level beyond the current; otherwise the first
 * outstanding detection escalates to level 1). This makes the sweep idempotent
 * — re-running it on the same stale order will not re-page at the same level.
 */
export function classifyWorkOrder(
  row: WorkOrderRow,
  now: Date,
  thresholds: StaleThresholds = DEFAULT_STALE_THRESHOLDS
): EscalationVerdict {
  const nowMs = now.getTime();
  const isOpen = (OPEN_WORK_ORDER_STATUSES as readonly string[]).includes(
    row.status
  );

  // Closed orders are never outstanding and never escalate.
  if (!isOpen) {
    return {
      workOrderId: row.id,
      outstanding: false,
      ageDays: daysBetween(toMs(row.created_at), nowMs),
      promiseBreached: false,
      shouldEscalate: false,
      nextLevel: row.escalation_level,
      reason: null,
    };
  }

  const ageDays = daysBetween(toMs(row.created_at), nowMs);
  const started = row.started_at !== null;

  // Promise breach: an ETA date strictly before `now` while still open.
  const promiseBreached =
    row.estimated_completion_date !== null &&
    toMs(row.estimated_completion_date) < nowMs;

  // Determine staleness + the governing reason (most-severe first).
  let reason: EscalationReason | null = null;
  if (row.is_emergency && ageDays >= thresholds.emergencyDays) {
    reason = "emergency_stale";
  } else if (!started && ageDays >= thresholds.unstartedDays) {
    reason = "unstarted_stale";
  } else if (started && ageDays >= thresholds.inProgressDays) {
    reason = "in_progress_stale";
  }
  // A promise breach makes it outstanding even if the age thresholds haven't
  // tripped; it also takes reason precedence when nothing more severe fired.
  if (promiseBreached && reason === null) {
    reason = "promise_breached";
  }

  const outstanding = reason !== null;

  // Escalation level: a promise breach pushes one level beyond the current
  // (re-escalation); otherwise the first outstanding detection raises to 1.
  const targetLevel = promiseBreached
    ? row.escalation_level + 1
    : Math.max(row.escalation_level, 1);

  // Escalate only if outstanding AND we haven't already alerted at targetLevel.
  // (escalation_level reflects the last level we raised TO; if targetLevel is
  // greater, this is a new escalation.)
  const shouldEscalate = outstanding && targetLevel > row.escalation_level;
  const nextLevel = shouldEscalate ? targetLevel : row.escalation_level;

  return {
    workOrderId: row.id,
    outstanding,
    ageDays,
    promiseBreached,
    shouldEscalate,
    nextLevel,
    reason,
  };
}

/** Build the manager-alert payload from a row + its verdict. Pure. */
export function assembleManagerAlert(
  row: WorkOrderRow,
  verdict: EscalationVerdict,
  now: Date
): ManagerAlertPayload {
  const eta =
    row.estimated_completion_date === null
      ? null
      : row.estimated_completion_date instanceof Date
        ? row.estimated_completion_date.toISOString().slice(0, 10)
        : String(row.estimated_completion_date).slice(0, 10);

  const reason = verdict.reason ?? "unstarted_stale";
  const summary = buildSummary(row, verdict, reason);

  return {
    workOrderId: row.id,
    propertyId: row.property_id,
    title: row.title,
    priority: row.priority,
    isEmergency: row.is_emergency,
    status: row.status,
    ageDays: verdict.ageDays,
    escalationLevel: verdict.nextLevel,
    reason,
    promiseBreached: verdict.promiseBreached,
    estimatedCompletionDate: eta,
    assignedTo: row.assigned_to,
    summary,
    generatedAt: now.toISOString(),
  };
}

function buildSummary(
  row: WorkOrderRow,
  verdict: EscalationVerdict,
  reason: EscalationReason
): string {
  const tag = row.is_emergency ? "EMERGENCY " : "";
  switch (reason) {
    case "emergency_stale":
      return `${tag}work order "${row.title}" has been open ${verdict.ageDays}d (status: ${row.status}) and needs immediate attention.`;
    case "unstarted_stale":
      return `Work order "${row.title}" has been ${row.status} for ${verdict.ageDays}d without being started.`;
    case "in_progress_stale":
      return `Work order "${row.title}" has been in progress for ${verdict.ageDays}d without completion.`;
    case "promise_breached":
      return `Work order "${row.title}" missed its promised completion date and is still open after ${verdict.ageDays}d.`;
  }
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export interface SweepResult {
  scanned: number;
  /** Orders newly flagged or kept outstanding this sweep. */
  outstanding: number;
  /** Orders escalated (level bumped + alert assembled) this sweep. */
  escalated: number;
  /** Orders with a breached promised ETA. */
  promiseBreaches: number;
}

export class WorkOrderEscalationService {
  constructor(
    private readonly notifier: WorkOrderNotifier = new LoggingWorkOrderNotifier(),
    private readonly thresholds: StaleThresholds = DEFAULT_STALE_THRESHOLDS
  ) {}

  /**
   * Read every open work order, classify it, persist outstanding/escalation
   * state, and emit a manager alert for each newly-escalated order. `now` is
   * injectable for deterministic tests; defaults to the current time.
   */
  async sweepStaleWorkOrders(now: Date = new Date()): Promise<SweepResult> {
    const statusList = OPEN_WORK_ORDER_STATUSES.map((s) => `'${s}'`).join(", ");
    const { rows } = await query(
      `SELECT id, property_id, title, status, priority, is_emergency,
              created_at, started_at, assigned_to,
              estimated_completion_date, is_outstanding,
              escalation_level, manager_alerted_at
         FROM work_orders
        WHERE status IN (${statusList})
        ORDER BY created_at ASC`
    );

    const result: SweepResult = {
      scanned: rows.length,
      outstanding: 0,
      escalated: 0,
      promiseBreaches: 0,
    };

    for (const raw of rows) {
      const row = raw as WorkOrderRow;
      const verdict = classifyWorkOrder(row, now, this.thresholds);
      if (verdict.outstanding) result.outstanding += 1;
      if (verdict.promiseBreached) result.promiseBreaches += 1;

      // Persist the outstanding flag + (when escalating) the bumped level and
      // alert timestamp. outstanding_since is set the first time it flips.
      await this.persistVerdict(row, verdict, now);

      if (verdict.shouldEscalate) {
        const payload = assembleManagerAlert(row, verdict, now);
        try {
          await this.notifier.notifyManager(payload);
          result.escalated += 1;
        } catch (err) {
          logger.error("Work order manager alert failed", {
            workOrderId: row.id,
            error: (err as Error).message,
          });
        }
      }
    }

    if (result.outstanding > 0 || result.escalated > 0) {
      logger.info("Work order stale-sweep complete", { ...result });
    }
    return result;
  }

  /** Persist the verdict back to the row. Idempotent: re-running with the same
   *  verdict makes no material change (outstanding_since only sets once). */
  private async persistVerdict(
    row: WorkOrderRow,
    verdict: EscalationVerdict,
    now: Date
  ): Promise<void> {
    await query(
      `UPDATE work_orders
          SET is_outstanding = $2,
              outstanding_since = CASE
                WHEN $2 = true AND outstanding_since IS NULL THEN $4
                WHEN $2 = false THEN NULL
                ELSE outstanding_since
              END,
              escalation_level = $3,
              manager_alerted_at = CASE WHEN $5 THEN $4 ELSE manager_alerted_at END,
              promise_breached_at = CASE
                WHEN $6 = true AND promise_breached_at IS NULL THEN $4
                ELSE promise_breached_at
              END,
              updated_at = NOW()
        WHERE id = $1`,
      [
        row.id,
        verdict.outstanding,
        verdict.nextLevel,
        now.toISOString(),
        verdict.shouldEscalate,
        verdict.promiseBreached,
      ]
    );
  }

  /**
   * Set / update the promised completion date (ETA) for an order. This is the
   * "promise" a manager commits to; the sweep flags a breach when it elapses
   * while the order is still open. Returns the stored date.
   */
  async setEstimatedCompletionDate(
    workOrderId: string,
    date: string
  ): Promise<{ id: string; estimatedCompletionDate: string }> {
    const result = await query(
      `UPDATE work_orders
          SET estimated_completion_date = $2, updated_at = NOW()
        WHERE id = $1
      RETURNING id, estimated_completion_date`,
      [workOrderId, date]
    );
    if (result.rows.length === 0) throw new Error("Work order not found");
    const r = result.rows[0];
    return {
      id: r.id as string,
      estimatedCompletionDate:
        r.estimated_completion_date instanceof Date
          ? r.estimated_completion_date.toISOString().slice(0, 10)
          : String(r.estimated_completion_date).slice(0, 10),
    };
  }

  /** List the currently-outstanding orders (the manager board). */
  async listOutstanding(propertyId?: string): Promise<WorkOrderRow[]> {
    const params: unknown[] = [];
    let where = "WHERE is_outstanding = true";
    if (propertyId) {
      params.push(propertyId);
      where += ` AND property_id = $${params.length}`;
    }
    const { rows } = await query(
      `SELECT id, property_id, title, status, priority, is_emergency,
              created_at, started_at, assigned_to,
              estimated_completion_date, is_outstanding,
              escalation_level, manager_alerted_at
         FROM work_orders
         ${where}
        ORDER BY outstanding_since ASC NULLS LAST`,
      params
    );
    return rows as WorkOrderRow[];
  }
}
