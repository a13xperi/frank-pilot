import cron from "node-cron";
import { RecertificationService } from "./modules/recertification/service";
import { LedgerService } from "./modules/ledger/service";
import { LeaseRenewalService } from "./modules/renewal/service";
import { logger } from "./utils/logger";

const recertService = new RecertificationService();
const ledgerService = new LedgerService();
const renewalService = new LeaseRenewalService();

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

  logger.info("Scheduler started: rent postings (1st @ 6AM) + late fees (7AM) + renewals (7:30AM) + recert reminders (8AM) + TRACS checks (9AM)");
}
