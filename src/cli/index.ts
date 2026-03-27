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
import { queryAuditLog } from "../middleware/audit";
import bcrypt from "bcrypt";

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
        console.error("Invalid credentials");
        process.exit(1);
      }
      console.log("\nLogin successful!");
      console.log(`User: ${result.user.firstName} ${result.user.lastName} (${result.user.role})`);
      console.log(`\nToken:\n${result.token}\n`);
    } catch (err) {
      console.error("Error:", (err as Error).message);
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
      console.log("User created:", result.rows[0]);
    } catch (err) {
      console.error("Error:", (err as Error).message);
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
      console.table(result.rows);
    } catch (err) {
      console.error("Error:", (err as Error).message);
    } finally {
      await pool.end();
    }
  });

program
  .command("deactivate-user")
  .description("Deactivate a user account (prevents login)")
  .requiredOption("-e, --email <email>", "User email to deactivate")
  .action(async (opts) => {
    try {
      const result = await query(
        "UPDATE users SET is_active = false WHERE email = $1 RETURNING id, email, role",
        [opts.email]
      );
      if (result.rows.length === 0) {
        console.error("User not found:", opts.email);
        process.exit(1);
      }
      console.log("User deactivated:", result.rows[0]);
    } catch (err) {
      console.error("Error:", (err as Error).message);
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
      console.log(`\nTotal: ${result.total} applications\n`);
      console.table(
        result.applications.map((a) => ({
          id: a.id.substring(0, 8) + "...",
          name: `${a.first_name} ${a.last_name}`,
          status: a.status,
          property: a.property_name,
          rent: a.requested_rent_amount ? `$${a.requested_rent_amount}` : "-",
          screening: a.overall_screening_result || "-",
          submitted: a.submitted_at ? new Date(a.submitted_at).toLocaleDateString() : "-",
        }))
      );
    } catch (err) {
      console.error("Error:", (err as Error).message);
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
        console.error("Application not found");
        process.exit(1);
      }
      console.log("\n=== Application Details ===\n");
      console.log(JSON.stringify(app, null, 2));
    } catch (err) {
      console.error("Error:", (err as Error).message);
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
        console.error("User not found");
        process.exit(1);
      }
      const result = await service.runFullScreening(opts.id, opts.userId, userResult.rows[0].role);
      console.log("\n=== Screening Results ===\n");
      console.log(`Overall: ${result.overallResult}`);
      console.log(`Background: ${result.background.result}`);
      console.log(`Credit: ${result.credit.result} (Score: ${result.credit.creditScore})`);
      console.log(`Compliance: ${result.compliance.result}`);
      console.log("\nDetails:", JSON.stringify(result, null, 2));
    } catch (err) {
      console.error("Error:", (err as Error).message);
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
      console.log("\n=== Approval Status ===\n");
      console.log(JSON.stringify(result, null, 2));
    } catch (err) {
      console.error("Error:", (err as Error).message);
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
        console.error("User not found");
        process.exit(1);
      }
      const service = new LeaseService();
      const result = await service.generateLease(opts.id, opts.userId, userResult.rows[0].role);
      console.log("\n=== Lease Generated ===\n");
      console.log(`Lease ID:     ${result.leaseId}`);
      console.log(`Document URL: ${result.documentUrl}`);
    } catch (err) {
      console.error("Error:", (err as Error).message);
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
        console.error("User not found");
        process.exit(1);
      }
      const service = new LeaseService();
      const result = await service.completeOnboarding(opts.id, opts.userId, userResult.rows[0].role);
      console.log("\n=== Onboarding Complete ===\n");
      console.log(`Onboarded:     ${result.onboarded}`);
      console.log(`Loft Tenant ID: ${result.loftTenantId}`);
    } catch (err) {
      console.error("Error:", (err as Error).message);
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
        console.error("Application not found");
        process.exit(1);
      }
      console.log("\n=== Lease Status ===\n");
      console.log(`Application ID:  ${result.applicationId}`);
      console.log(`Status:          ${result.status}`);
      console.log(`OneSite Lease:   ${result.onesiteLeaseId || "(not yet generated)"}`);
      console.log(`Loft Tenant:     ${result.loftTenantId || "(not yet onboarded)"}`);
      console.log(`Auto-Pay:        ${result.autoPayEnrolled ? "enrolled" : "not enrolled"}`);
    } catch (err) {
      console.error("Error:", (err as Error).message);
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
      console.log(`\n=== Audit Log (${logs.length} entries) ===\n`);
      console.table(
        logs.map((l: any) => ({
          time: new Date(l.created_at).toLocaleString(),
          action: l.action,
          actor: l.actor_id?.substring(0, 8) || "system",
          role: l.actor_role || "-",
          app: l.application_id?.substring(0, 8) || "-",
          details: JSON.stringify(l.details).substring(0, 60),
        }))
      );
    } catch (err) {
      console.error("Error:", (err as Error).message);
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

      console.log("\n=== Frank Pilot Statistics ===\n");

      console.log("Applications by Status:");
      console.table(apps.rows);

      console.log("\nActive Users by Role:");
      console.table(users.rows);

      console.log(`\nTotal Audit Log Entries: ${audits.rows[0].total}`);
      console.log(`Fraud Flags: ${flags.rows[0].total} total, ${flags.rows[0].unresolved} unresolved`);
      console.log(`Properties: ${properties.rows[0].total} (${properties.rows[0].total_units || 0} units)`);

      // Auto-pay stats
      const autoPayResult = await query(
        `SELECT
          COUNT(*) as total_onboarded,
          COUNT(*) FILTER (WHERE auto_pay_enrolled = true) as auto_pay_count
         FROM applications WHERE status = 'onboarded'`
      );
      const ap = autoPayResult.rows[0];
      const rate = ap.total_onboarded > 0 ? ((ap.auto_pay_count / ap.total_onboarded) * 100).toFixed(1) : "N/A";
      console.log(`\nAuto-Pay Enrollment: ${ap.auto_pay_count}/${ap.total_onboarded} (${rate}%)`);
    } catch (err) {
      console.error("Error:", (err as Error).message);
    } finally {
      await pool.end();
    }
  });

program.parse();
