import dotenv from "dotenv";
dotenv.config();

import { Command } from "commander";
import { pool, query } from "../config/database";
import { login } from "../middleware/auth";
import { ApplicationService } from "../modules/application/service";
import { ScreeningService } from "../modules/screening/service";
import { ApprovalService } from "../modules/approval/service";
import { PaymentService } from "../modules/payment/service";
import { DecisionMatrixService } from "../modules/decision-matrix/service";
import { LeaseService } from "../modules/lease/service";
import { UserService } from "../modules/users/service";
import { PropertyService } from "../modules/properties/service";
import { queryAuditLog } from "../middleware/audit";
import bcrypt from "bcrypt";
import { logger } from "../utils/logger";

const program = new Command();

program
  .name("frank-cli")
  .description("Frank Pilot — Tenant Onboarding CLI")
  .version("1.0.0");

// ============================================================
// Auth commands
// ============================================================

program
  .command("login")
  .description("Login and get a JWT token")
  .requiredOption("-e, --email <email>", "User email")
  .requiredOption("-p, --password <password>", "User password")
  .action(async (opts) => {
    try {
      const result = await login(opts.email, opts.password);
      if (!result) {
        logger.error("Invalid credentials");
        process.exit(1);
      }
      logger.info("\nLogin successful!");
      logger.info(`User: ${result.user.firstName} ${result.user.lastName} (${result.user.role})`);
      logger.info(`\nToken:\n${result.token}\n`);
    } catch (err) {
      logger.error("Error:", { message: (err as Error).message });
    } finally {
      await pool.end();
    }
  });

// ============================================================
// User management
// ============================================================

program
  .command("create-user")
  .description("Create a new staff user")
  .requiredOption("-e, --email <email>", "Email")
  .requiredOption("-p, --password <password>", "Password")
  .requiredOption("-f, --first-name <firstName>", "First name")
  .requiredOption("-l, --last-name <lastName>", "Last name")
  .requiredOption("-r, --role <role>", "Role (leasing_agent, senior_manager, regional_manager, asset_manager, system_admin)")
  .action(async (opts) => {
    try {
      const hash = await bcrypt.hash(opts.password, 10);
      const result = await query(
        `INSERT INTO users (email, password_hash, first_name, last_name, role)
         VALUES ($1, $2, $3, $4, $5) RETURNING id, email, role`,
        [opts.email, hash, opts.firstName, opts.lastName, opts.role]
      );
      logger.info("User created:", { data: result.rows[0] });
    } catch (err) {
      logger.error("Error:", { message: (err as Error).message });
    } finally {
      await pool.end();
    }
  });

program
  .command("list-users")
  .description("List all users")
  .action(async () => {
    try {
      const result = await query(
        "SELECT id, email, first_name, last_name, role, is_active, last_login FROM users ORDER BY role, email"
      );
      logger.info("Users:", { rows: result.rows });
    } catch (err) {
      logger.error("Error:", { message: (err as Error).message });
    } finally {
      await pool.end();
    }
  });

program
  .command("deactivate-user")
  .description("Deactivate a user account (prevents login)")
  .requiredOption("-e, --email <email>", "User email to deactivate")
  .requiredOption("-u, --actor-id <actorId>", "System admin user ID performing the action")
  .action(async (opts) => {
    try {
      const actorResult = await query("SELECT id, role FROM users WHERE id = $1", [opts.actorId]);
      if (actorResult.rows.length === 0) {
        logger.error("Actor user not found:", { actorId: opts.actorId });
        process.exit(1);
      }
      const targetResult = await query("SELECT id FROM users WHERE email = $1", [opts.email]);
      if (targetResult.rows.length === 0) {
        logger.error("Target user not found:", { email: opts.email });
        process.exit(1);
      }
      const svc = new UserService();
      const user = await svc.setActive(
        targetResult.rows[0].id,
        false,
        actorResult.rows[0].id,
        actorResult.rows[0].role
      );
      logger.info("User deactivated:", { id: user.id, email: user.email, role: user.role });
    } catch (err) {
      logger.error("Error:", { message: (err as Error).message });
    } finally {
      await pool.end();
    }
  });

program
  .command("activate-user")
  .description("Reactivate a deactivated user account")
  .requiredOption("-e, --email <email>", "User email to activate")
  .requiredOption("-u, --actor-id <actorId>", "System admin user ID performing the action")
  .action(async (opts) => {
    try {
      const actorResult = await query("SELECT id, role FROM users WHERE id = $1", [opts.actorId]);
      if (actorResult.rows.length === 0) {
        logger.error("Actor user not found:", { actorId: opts.actorId });
        process.exit(1);
      }
      const targetResult = await query("SELECT id FROM users WHERE email = $1", [opts.email]);
      if (targetResult.rows.length === 0) {
        logger.error("Target user not found:", { email: opts.email });
        process.exit(1);
      }
      const svc = new UserService();
      const user = await svc.setActive(
        targetResult.rows[0].id,
        true,
        actorResult.rows[0].id,
        actorResult.rows[0].role
      );
      logger.info("User activated:", { id: user.id, email: user.email, role: user.role });
    } catch (err) {
      logger.error("Error:", { message: (err as Error).message });
    } finally {
      await pool.end();
    }
  });

program
  .command("reset-password")
  .description("Reset a user's password (admin operation — no old password required)")
  .requiredOption("-e, --email <email>", "Email of the user whose password to reset")
  .requiredOption("-p, --new-password <newPassword>", "New password (min 8 characters)")
  .requiredOption("-u, --actor-id <actorId>", "System admin user ID performing the reset")
  .action(async (opts) => {
    try {
      const actorResult = await query("SELECT id, role FROM users WHERE id = $1", [opts.actorId]);
      if (actorResult.rows.length === 0) {
        logger.error("Actor user not found:", { actorId: opts.actorId });
        process.exit(1);
      }
      const targetResult = await query("SELECT id FROM users WHERE email = $1", [opts.email]);
      if (targetResult.rows.length === 0) {
        logger.error("Target user not found:", { email: opts.email });
        process.exit(1);
      }
      const svc = new UserService();
      await svc.resetPassword(
        targetResult.rows[0].id,
        opts.newPassword,
        actorResult.rows[0].id,
        actorResult.rows[0].role
      );
      logger.info(`Password reset successfully for: ${opts.email}`);
    } catch (err) {
      logger.error("Error:", { message: (err as Error).message });
      process.exit(1);
    } finally {
      await pool.end();
    }
  });

// ============================================================
// Application commands
// ============================================================

program
  .command("list-applications")
  .description("List tenant applications")
  .option("-s, --status <status>", "Filter by status")
  .option("-l, --limit <limit>", "Limit results", "25")
  .action(async (opts) => {
    try {
      const service = new ApplicationService();
      const result = await service.list({
        status: opts.status,
        limit: parseInt(opts.limit),
      });
      logger.info(`\nTotal: ${result.total} applications\n`);
      logger.info("Applications:", {
        rows: result.applications.map((a) => ({
          id: a.id.substring(0, 8) + "...",
          name: `${a.first_name} ${a.last_name}`,
          status: a.status,
          property: a.property_name,
          rent: a.requested_rent_amount ? `$${a.requested_rent_amount}` : "-",
          screening: a.overall_screening_result || "-",
          submitted: a.submitted_at ? new Date(a.submitted_at).toLocaleDateString() : "-",
        })),
      });
    } catch (err) {
      logger.error("Error:", { message: (err as Error).message });
    } finally {
      await pool.end();
    }
  });

program
  .command("view-application")
  .description("View application details")
  .requiredOption("-i, --id <id>", "Application ID")
  .action(async (opts) => {
    try {
      const service = new ApplicationService();
      const app = await service.getById(opts.id);
      if (!app) {
        logger.error("Application not found");
        process.exit(1);
      }
      logger.info("\n=== Application Details ===\n");
      logger.info("Application details:", { data: app });
    } catch (err) {
      logger.error("Error:", { message: (err as Error).message });
    } finally {
      await pool.end();
    }
  });

// ============================================================
// Screening commands
// ============================================================

program
  .command("run-screening")
  .description("Run automated screening on a submitted application")
  .requiredOption("-i, --id <id>", "Application ID")
  .requiredOption("-u, --user-id <userId>", "Actor user ID")
  .action(async (opts) => {
    try {
      const service = new ScreeningService();
      // Get user role
      const userResult = await query("SELECT role FROM users WHERE id = $1", [opts.userId]);
      if (userResult.rows.length === 0) {
        logger.error("User not found");
        process.exit(1);
      }
      const result = await service.runFullScreening(opts.id, opts.userId, userResult.rows[0].role);
      logger.info("\n=== Screening Results ===\n");
      logger.info(`Overall: ${result.overallResult}`);
      logger.info(`Background: ${result.background.result}`);
      logger.info(`Credit: ${result.credit.result} (Score: ${result.credit.creditScore})`);
      logger.info(`Compliance: ${result.compliance.result}`);
      logger.info("Details:", { data: result });
    } catch (err) {
      logger.error("Error:", { message: (err as Error).message });
    } finally {
      await pool.end();
    }
  });

// ============================================================
// Approval commands
// ============================================================

program
  .command("approval-status")
  .description("View approval workflow status")
  .requiredOption("-i, --id <id>", "Application ID")
  .action(async (opts) => {
    try {
      const service = new ApprovalService();
      const result = await service.getApprovalStatus(opts.id);
      logger.info("\n=== Approval Status ===\n");
      logger.info("Approval status:", { data: result });
    } catch (err) {
      logger.error("Error:", { message: (err as Error).message });
    } finally {
      await pool.end();
    }
  });

// ============================================================
// Lease commands
// ============================================================

program
  .command("generate-lease")
  .description("Generate a lease document for an approved application (senior_manager+)")
  .requiredOption("-i, --id <id>", "Application ID")
  .requiredOption("-u, --user-id <userId>", "Actor user ID")
  .action(async (opts) => {
    try {
      const userResult = await query("SELECT role FROM users WHERE id = $1", [opts.userId]);
      if (userResult.rows.length === 0) {
        logger.error("User not found");
        process.exit(1);
      }
      const service = new LeaseService();
      const result = await service.generateLease(opts.id, opts.userId, userResult.rows[0].role);
      logger.info("\n=== Lease Generated ===\n");
      logger.info(`Lease ID:     ${result.leaseId}`);
      logger.info(`Document URL: ${result.documentUrl}`);
    } catch (err) {
      logger.error("Error:", { message: (err as Error).message });
      process.exit(1);
    } finally {
      await pool.end();
    }
  });

program
  .command("onboard")
  .description("Complete tenant onboarding after lease is signed (senior_manager+)")
  .requiredOption("-i, --id <id>", "Application ID")
  .requiredOption("-u, --user-id <userId>", "Actor user ID")
  .action(async (opts) => {
    try {
      const userResult = await query("SELECT role FROM users WHERE id = $1", [opts.userId]);
      if (userResult.rows.length === 0) {
        logger.error("User not found");
        process.exit(1);
      }
      const service = new LeaseService();
      const result = await service.completeOnboarding(opts.id, opts.userId, userResult.rows[0].role);
      logger.info("\n=== Onboarding Complete ===\n");
      logger.info(`Onboarded:     ${result.onboarded}`);
      logger.info(`Loft Tenant ID: ${result.loftTenantId}`);
    } catch (err) {
      logger.error("Error:", { message: (err as Error).message });
      process.exit(1);
    } finally {
      await pool.end();
    }
  });

program
  .command("lease-status")
  .description("View lease and onboarding status for an application")
  .requiredOption("-i, --id <id>", "Application ID")
  .action(async (opts) => {
    try {
      const service = new LeaseService();
      const result = await service.getLeaseStatus(opts.id);
      if (!result) {
        logger.error("Application not found");
        process.exit(1);
      }
      logger.info("\n=== Lease Status ===\n");
      logger.info(`Application ID:  ${result.applicationId}`);
      logger.info(`Status:          ${result.status}`);
      logger.info(`OneSite Lease:   ${result.onesiteLeaseId || "(not yet generated)"}`);
      logger.info(`Loft Tenant:     ${result.loftTenantId || "(not yet onboarded)"}`);
      logger.info(`Auto-Pay:        ${result.autoPayEnrolled ? "enrolled" : "not enrolled"}`);
    } catch (err) {
      logger.error("Error:", { message: (err as Error).message });
      process.exit(1);
    } finally {
      await pool.end();
    }
  });

// ============================================================
// Audit commands
// ============================================================

program
  .command("audit")
  .description("View audit log")
  .option("-i, --application-id <id>", "Filter by application ID")
  .option("-a, --action <action>", "Filter by action")
  .option("-l, --limit <limit>", "Limit results", "25")
  .action(async (opts) => {
    try {
      const logs = await queryAuditLog({
        applicationId: opts.applicationId,
        action: opts.action,
        limit: parseInt(opts.limit),
      });
      logger.info(`\n=== Audit Log (${logs.length} entries) ===\n`);
      logger.info("Audit log:", {
        rows: logs.map((l: any) => ({
          time: new Date(l.created_at).toLocaleString(),
          action: l.action,
          actor: l.actor_id?.substring(0, 8) || "system",
          role: l.actor_role || "-",
          app: l.application_id?.substring(0, 8) || "-",
          details: JSON.stringify(l.details).substring(0, 60),
        })),
      });
    } catch (err) {
      logger.error("Error:", { message: (err as Error).message });
    } finally {
      await pool.end();
    }
  });

// ============================================================
// Stats commands
// ============================================================

program
  .command("stats")
  .description("Show system statistics")
  .action(async () => {
    try {
      const [apps, users, audits, flags, properties] = await Promise.all([
        query("SELECT status, COUNT(*) as count FROM applications GROUP BY status ORDER BY count DESC"),
        query("SELECT role, COUNT(*) as count FROM users WHERE is_active = true GROUP BY role"),
        query("SELECT COUNT(*) as total FROM audit_log"),
        query("SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE resolved = false) as unresolved FROM fraud_flags"),
        query("SELECT COUNT(*) as total, SUM(unit_count) as total_units FROM properties"),
      ]);

      logger.info("\n=== Frank Pilot Statistics ===\n");

      logger.info("Applications by Status:", { rows: apps.rows });

      logger.info("Active Users by Role:", { rows: users.rows });

      logger.info(`\nTotal Audit Log Entries: ${audits.rows[0].total}`);
      logger.info(`Fraud Flags: ${flags.rows[0].total} total, ${flags.rows[0].unresolved} unresolved`);
      logger.info(`Properties: ${properties.rows[0].total} (${properties.rows[0].total_units || 0} units)`);

      // Auto-pay stats
      const autoPayResult = await query(
        `SELECT
          COUNT(*) as total_onboarded,
          COUNT(*) FILTER (WHERE auto_pay_enrolled = true) as auto_pay_count
         FROM applications WHERE status = 'onboarded'`
      );
      const ap = autoPayResult.rows[0];
      const rate = ap.total_onboarded > 0 ? ((ap.auto_pay_count / ap.total_onboarded) * 100).toFixed(1) : "N/A";
      logger.info(`\nAuto-Pay Enrollment: ${ap.auto_pay_count}/${ap.total_onboarded} (${rate}%)`);
    } catch (err) {
      logger.error("Error:", { message: (err as Error).message });
    } finally {
      await pool.end();
    }
  });

// ============================================================
// Property commands
// ============================================================

program
  .command("list-properties")
  .description("List all properties")
  .action(async () => {
    try {
      const svc = new PropertyService();
      const properties = await svc.list();
      logger.info(`\nTotal: ${properties.length} properties\n`);
      logger.info("Properties:", {
        rows: properties.map((p) => ({
          id: p.id.substring(0, 8) + "...",
          name: p.name,
          city: p.city,
          state: p.state,
          units: p.unitCount,
          amiArea: p.amiArea.substring(0, 30),
          onesite: p.onesitePropertyId || "-",
        })),
      });
    } catch (err) {
      logger.error("Error:", { message: (err as Error).message });
    } finally {
      await pool.end();
    }
  });

program
  .command("view-property")
  .description("View property details including AMI area and integration IDs")
  .requiredOption("-i, --id <id>", "Property ID")
  .action(async (opts) => {
    try {
      const svc = new PropertyService();
      const property = await svc.getById(opts.id);
      if (!property) {
        logger.error("Property not found");
        process.exit(1);
      }
      logger.info("\n=== Property Details ===\n");
      logger.info("Property details:", { data: property });
    } catch (err) {
      logger.error("Error:", { message: (err as Error).message });
    } finally {
      await pool.end();
    }
  });

program.parse();
