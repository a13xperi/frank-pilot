import cron from "node-cron";
import { RecertificationService } from "./modules/recertification/service";
import { LedgerService } from "./modules/ledger/service";
import { LeaseRenewalService } from "./modules/renewal/service";
import { createTapeService } from "./modules/tape/service";
import { PgTapeRepository } from "./modules/tape/repository";
import { AdverseActionService } from "./modules/adverse-action/service";
import { runDialerTick, sweepStuckCalls } from "./modules/outbound-validation/dialer";
import { runFollowupTick } from "./modules/follow-ups/dialer";
import { pushReportToNotion } from "./modules/outbound-validation/report";
import { WorkOrderEscalationService } from "./modules/maintenance/escalation";
import { logger } from "./utils/logger";

const recertService = new RecertificationService();
const ledgerService = new LedgerService();
const renewalService = new LeaseRenewalService();
const tapeService = createTapeService(new PgTapeRepository());
const adverseActionService = new AdverseActionService();
const workOrderEscalationService = new WorkOrderEscalationService();

/**
 * Start daily scheduled jobs.
 * - 8:00 AM: Process recertification reminders (120/90/60-day), mark overdue, apply market rent
 * - 9:00 AM: Check TRACS deadlines (log warnings for approaching 15-month limits)
 */
export function startScheduler() {
  // Daily at 8:00 AM — process recertification reminders
  cron.schedule("0 8 * * *", async () => {
    logger.info("Scheduler: Running recertification reminder processing");
    try {
      const stats = await recertService.processReminders();
      logger.info("Scheduler: Recertification reminders complete", stats);
    } catch (err) {
      logger.error("Scheduler: Recertification reminder processing failed", {
        error: (err as Error).message,
      });
    }
  });

  // Daily at 9:00 AM — check TRACS deadlines
  cron.schedule("0 9 * * *", async () => {
    logger.info("Scheduler: Checking TRACS deadlines");
    try {
      // TRACS requires submission within 15 months of anniversary
      // Alert on recerts approaching 12-month mark (red alert threshold)
      const { rows } = await import("./config/database").then((db) =>
        db.query(
          `SELECT r.id, r.tenant_name, r.anniversary_date, r.tracs_deadline, p.name as property_name
           FROM recertifications r
           JOIN properties p ON r.property_id = p.id
           WHERE r.status NOT IN ('approved', 'denied', 'market_rent_applied')
             AND r.tracs_deadline <= (CURRENT_DATE + INTERVAL '90 days')
           ORDER BY r.tracs_deadline ASC`
        )
      );

      if (rows.length > 0) {
        logger.warn(`Scheduler: ${rows.length} recertification(s) approaching TRACS deadline`, {
          recertifications: rows.map((r: any) => ({
            id: r.id,
            tenant: r.tenant_name,
            property: r.property_name,
            tracsDeadline: r.tracs_deadline,
          })),
        });
      }
    } catch (err) {
      logger.error("Scheduler: TRACS deadline check failed", {
        error: (err as Error).message,
      });
    }
  });

  // 1st of month at 6:00 AM — auto-post monthly rent for all active tenants
  cron.schedule("0 6 1 * *", async () => {
    logger.info("Scheduler: Running monthly rent postings");
    try {
      const stats = await ledgerService.processMonthlyRentPostings();
      logger.info("Scheduler: Monthly rent postings complete", stats);
    } catch (err) {
      logger.error("Scheduler: Monthly rent postings failed", {
        error: (err as Error).message,
      });
    }
  });

  // Daily at 7:00 AM — assess late fees on overdue rent (effective from 6th onward)
  cron.schedule("0 7 * * *", async () => {
    const day = new Date().getDate();
    if (day < 6) return; // Grace period: rent not late until the 6th
    logger.info("Scheduler: Processing late fees");
    try {
      const stats = await ledgerService.processLateFees();
      logger.info("Scheduler: Late fee processing complete", stats);
    } catch (err) {
      logger.error("Scheduler: Late fee processing failed", {
        error: (err as Error).message,
      });
    }
  });

  // Daily at 7:30 AM — process lease renewal offers (auto-generate at 90 days, send reminders)
  cron.schedule("30 7 * * *", async () => {
    logger.info("Scheduler: Processing lease renewal offers");
    try {
      const stats = await renewalService.processRenewalOffers();
      logger.info("Scheduler: Renewal offer processing complete", stats);
    } catch (err) {
      logger.error("Scheduler: Renewal offer processing failed", { error: (err as Error).message });
    }
  });

  // BP-02 verify-cron — gated on COMPLIANCE_TAPE_V2_ENABLED.
  // Until Phase 2 Step 2 wires the canonical TapeService, this cron would
  // run every 5 minutes against a stub that always throws "service not
  // wired", flooding logs and obscuring real BP-02 issues when the service
  // DOES land. Default OFF; ops flips the flag when the service is ready.
  if (process.env.COMPLIANCE_TAPE_V2_ENABLED === "true") {
    // Every 5 minutes — BP-02 compliance-tape chain-integrity sweep.
    // Samples up to 20 applicants that received a tape stamp in the last hour
    // and runs verify() on each. WARN per broken chain is the in-app alert
    // signal; the prod-smoke compliance-tape-verify job is the external one.
    cron.schedule("*/5 * * * *", async () => {
      try {
        const { query } = await import("./config/database");
        const { rows } = await query(
          `SELECT DISTINCT applicant_id
             FROM compliance_tape
            WHERE created_at > NOW() - INTERVAL '1 hour'
              AND applicant_id IS NOT NULL
            LIMIT 20`
        );
        let warnings = 0;
        for (const r of rows) {
          const result = await tapeService.verify({
            type: "applicant",
            applicantId: r.applicant_id as string,
          });
          if (!result.ok) {
            warnings++;
            logger.warn("BP-02 chain break detected", {
              applicantId: r.applicant_id,
              brokeAt: result.brokeAt,
              reason: result.reason,
            });
          }
        }
        logger.info("BP-02 verify-cron tick", {
          sampledApplicants: rows.length,
          warnings,
        });
      } catch (err) {
        logger.error("BP-02 verify-cron failed", {
          error: (err as Error).message,
        });
      }
    });
    logger.info("BP-02 verify-cron registered (COMPLIANCE_TAPE_V2_ENABLED=true)");

    // Every 15 minutes — re-stamp compliance-tape failures the acq stamp sites
    // swallowed into compliance_tape_dlq. Dark by default (same flag as the
    // verify-cron): parking is always-on so failures are durable, but auto-drain
    // is opt-in. Until the flag is on, parked rows wait for this cron or a manual
    // replayTapeDlq() call — recoverable, never silently lost.
    cron.schedule("*/15 * * * *", async () => {
      try {
        const { replayTapeDlq } = await import("./modules/tape/dlq");
        const stats = await replayTapeDlq();
        if (stats.scanned > 0) {
          logger.info("BP-02 tape-DLQ replay tick", stats);
        }
      } catch (err) {
        logger.error("BP-02 tape-DLQ replay failed", {
          error: (err as Error).message,
        });
      }
    });
    logger.info("BP-02 tape-DLQ replay-cron registered (COMPLIANCE_TAPE_V2_ENABLED=true)");
  } else {
    logger.info(
      "BP-02 verify-cron skipped — COMPLIANCE_TAPE_V2_ENABLED is off"
    );
  }

  // FCRA pre-adverse-action finalizer — gated on FCRA_PRE_ADVERSE_ENABLED.
  // Until the flag is on there are no pending_adverse_action holds to finalize,
  // so the cron stays unregistered (default off ⇒ byte-identical scheduler).
  if (process.env.FCRA_PRE_ADVERSE_ENABLED === "true") {
    // Daily at 6:00 AM — finalize every pre-adverse hold whose dispute window
    // has elapsed: CAS pending_adverse_action -> screening_failed + § 1681m
    // final notice (exactly-once, gated on the CAS result per application).
    cron.schedule("0 6 * * *", async () => {
      logger.info("Scheduler: Finalizing due pre-adverse-action holds");
      try {
        const stats = await adverseActionService.finalizeDuePreAdverseActions();
        logger.info("Scheduler: Pre-adverse-action finalization complete", stats);
      } catch (err) {
        logger.error("Scheduler: Pre-adverse-action finalization failed", {
          error: (err as Error).message,
        });
      }
    });
    logger.info("FCRA pre-adverse finalizer cron registered (FCRA_PRE_ADVERSE_ENABLED=true)");
  } else {
    logger.info(
      "FCRA pre-adverse finalizer cron skipped — FCRA_PRE_ADVERSE_ENABLED is off"
    );
  }

  // DM-FRANK-029 outbound waitlist-validation dialer — gated on
  // FRANK_OUTBOUND_ENABLED. One dial per tick max; the in-code gates
  // (call window, in-flight, daily batch cap, pacing, DRY_RUN) do the real
  // throttling, the cron is just the heartbeat. Default OFF ⇒ byte-identical
  // scheduler, same pattern as the BP-02 and FCRA blocks above.
  if (process.env.FRANK_OUTBOUND_ENABLED === "true") {
    // Every 5 minutes, 9am–8pm Pacific — dialer tick.
    cron.schedule(
      "*/5 9-19 * * *",
      async () => {
        try {
          const result = await runDialerTick({ trigger: "cron" });
          if (result.action !== "queue_empty" && result.action !== "paced") {
            logger.info("Outbound validation dialer tick", { ...result });
          }
        } catch (err) {
          logger.error("Outbound validation dialer tick failed", {
            error: (err as Error).message,
          });
        }
      },
      { timezone: "America/Los_Angeles" }
    );

    // Every 15 minutes — expire dialed calls that never produced a webhook.
    cron.schedule(
      "*/15 * * * *",
      async () => {
        try {
          await sweepStuckCalls();
        } catch (err) {
          logger.error("Outbound validation sweep failed", {
            error: (err as Error).message,
          });
        }
      },
      { timezone: "America/Los_Angeles" }
    );

    // Daily at 8:05pm Pacific (just after the call window closes) — push the
    // day's sweep report to the Notion live-report page.
    cron.schedule(
      "5 20 * * *",
      async () => {
        try {
          await pushReportToNotion();
        } catch (err) {
          logger.error("Outbound validation report push failed", {
            error: (err as Error).message,
          });
        }
      },
      { timezone: "America/Los_Angeles" }
    );
    logger.info("Outbound validation dialer cron registered (FRANK_OUTBOUND_ENABLED=true)");
  } else {
    logger.info("Outbound validation dialer cron skipped — FRANK_OUTBOUND_ENABLED is off");
  }

  // Follow-up callback dialer (Phase 2) — gated on FRANK_FOLLOWUP_ENABLED. Every
  // 5 min, 8am–9pm Pacific (hours 8–20 ⇒ last tick ~8:55pm; never dials past 9pm):
  // claim the next due follow-up and dial it back as Frank, with the context
  // packet. Dark until the flag + FRANK_FOLLOWUP_AGENT_ID are set, so the
  // scheduler is byte-identical otherwise.
  if (process.env.FRANK_FOLLOWUP_ENABLED === "true") {
    cron.schedule(
      "*/5 8-20 * * *",
      async () => {
        try {
          const result = await runFollowupTick();
          if (result.action !== "queue_empty") {
            logger.info("Follow-up callback tick", { ...result });
          }
        } catch (err) {
          logger.error("Follow-up callback tick failed", { error: (err as Error).message });
        }
      },
      { timezone: "America/Los_Angeles" }
    );
    logger.info("Follow-up callback cron registered (FRANK_FOLLOWUP_ENABLED=true)");
  }

  // Work-order stale-sweep + manager escalation (D1) — gated on
  // WORK_ORDER_ESCALATION_ENABLED. Until the flag is on, the cron stays
  // unregistered ⇒ byte-identical scheduler, same pattern as the BP-02 / FCRA /
  // outbound blocks above. The default LoggingWorkOrderNotifier only LOGS the
  // alert — no live email/SMS is wired (a real channel is a separate change).
  if (process.env.WORK_ORDER_ESCALATION_ENABLED === "true") {
    // Daily at 7:15 AM — flag stale open work orders, re-flag breached ETAs,
    // and emit a manager alert per newly-escalated order.
    cron.schedule("15 7 * * *", async () => {
      logger.info("Scheduler: Running work-order stale-sweep");
      try {
        const stats = await workOrderEscalationService.sweepStaleWorkOrders();
        logger.info("Scheduler: Work-order stale-sweep complete", stats);
      } catch (err) {
        logger.error("Scheduler: Work-order stale-sweep failed", {
          error: (err as Error).message,
        });
      }
    });
    logger.info("Work-order escalation cron registered (WORK_ORDER_ESCALATION_ENABLED=true)");
  } else {
    logger.info("Work-order escalation cron skipped — WORK_ORDER_ESCALATION_ENABLED is off");
  }

  logger.info("Scheduler started: rent postings (1st @ 6AM) + late fees (7AM) + renewals (7:30AM) + recert reminders (8AM) + TRACS checks (9AM)");
}
