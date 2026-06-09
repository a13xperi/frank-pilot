import cron from "node-cron";
import { RecertificationService } from "./modules/recertification/service";
import { LedgerService } from "./modules/ledger/service";
import { LeaseRenewalService } from "./modules/renewal/service";
import { createTapeService } from "./modules/tape/service";
import { PgTapeRepository } from "./modules/tape/repository";
import { AdverseActionService } from "./modules/adverse-action/service";
import { logger } from "./utils/logger";

const recertService = new RecertificationService();
const ledgerService = new LedgerService();
const renewalService = new LeaseRenewalService();
const tapeService = createTapeService(new PgTapeRepository());
const adverseActionService = new AdverseActionService();

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

  logger.info("Scheduler started: rent postings (1st @ 6AM) + late fees (7AM) + renewals (7:30AM) + recert reminders (8AM) + TRACS checks (9AM)");
}
