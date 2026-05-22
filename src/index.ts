import dotenv from "dotenv";
dotenv.config();

import express from "express";
import cors from "cors";
import helmet from "helmet";
import { logger } from "./utils/logger";
import { authenticate, login, AuthRequest } from "./middleware/auth";
import { requirePermission } from "./middleware/rbac";
import { queryAuditLog } from "./middleware/audit";

// Route imports
import applicationRoutes from "./modules/application/routes";
import screeningRoutes from "./modules/screening/routes";
import approvalRoutes from "./modules/approval/routes";
import paymentRoutes from "./modules/payment/routes";
import decisionMatrixRoutes from "./modules/decision-matrix/routes";
import leaseRoutes from "./modules/lease/routes";
import adverseActionRoutes from "./modules/adverse-action/routes";
import userRoutes from "./modules/users/routes";
import propertyRoutes from "./modules/properties/routes";
import complianceRoutes from "./modules/compliance/routes";
import recertificationRoutes from "./modules/recertification/routes";
import ledgerRoutes from "./modules/ledger/routes";
import evictionRoutes from "./modules/eviction/routes";
import inspectionRoutes from "./modules/inspections/routes";
import maintenanceRoutes from "./modules/maintenance/routes";
import renewalRoutes from "./modules/renewal/routes";
import moveoutRoutes from "./modules/moveout/routes";
import authRoutes from "./modules/auth/routes";
import applicantRoutes from "./modules/applicants/routes";
import tenantRoutes from "./modules/tenant/routes";
import messagesRoutes from "./modules/messages/routes";
import tapeRoutes from "./modules/tape/routes";
import { createTapeViewerRoutes } from "./modules/tape/routes-viewer";
import { startScheduler } from "./scheduler";

// Boot-time guardrails: in production, refuse to start without the secrets that
// gate auth + at-rest crypto. Crashing here is preferable to silently booting
// with a misconfigured server that issues unverifiable JWTs or leaves PII
// unencryptable.
if (process.env.NODE_ENV === "production") {
  const required = ["JWT_SECRET", "ENCRYPTION_KEY"] as const;
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    console.error(`Missing required env vars in production: ${missing.join(", ")}`);
    process.exit(1);
  }
}

const app = express();
app.set("trust proxy", 1);
const PORT = parseInt(process.env.PORT || "3000");

// Security middleware
app.use(helmet());
app.use(cors({ origin: process.env.CORS_ORIGIN || "*" }));
app.use(express.json({ limit: "1mb" }));

// Request logging (PII-safe)
app.use((req, _res, next) => {
  logger.info("Request", {
    method: req.method,
    path: req.path,
    ip: req.ip,
  });
  next();
});

// ============================================================
// Public routes
// ============================================================

// Health check — pings the DB so silent outages don't look healthy.
app.get("/health", async (_req, res) => {
  let dbStatus = "unknown";
  try {
    const { query } = await import("./config/database");
    const r = await query("SELECT 1 AS ok");
    dbStatus = r.rows[0]?.ok === 1 ? "ok" : "unexpected";
  } catch (err) {
    dbStatus = "error";
    logger.error("/health DB ping failed", { error: (err as Error).message });
    res.status(503).json({
      status: "degraded",
      service: "frank-pilot",
      db: dbStatus,
      timestamp: new Date().toISOString(),
    });
    return;
  }
  res.json({
    status: "ok",
    service: "frank-pilot",
    db: dbStatus,
    timestamp: new Date().toISOString(),
  });
});

// Magic-link auth (tenants + applicants)
app.use("/api/auth", authRoutes);

// Applicant self-service (public register + auth'd apply)
app.use("/api/applicants", applicantRoutes);

// BP-03b compliance tape beacons (HUD-928.1 page-view, welcome-accept).
// Stub module — see src/modules/tape/index.ts. Replace with canonical BP-02
// helper when it lands.
app.use("/api/tape", tapeRoutes);

// BP-02 compliance tape viewer (operator-only: list, verify, export.pdf).
// TODO(BP-02-Phase-2): Replace the stub service below with the real TapeService
// from Lane B once it is wired. The stub returns 503 for all calls so the
// routes exist in production but remain inert until Phase 2 completes.
app.use(
  "/api/compliance-tape",
  createTapeViewerRoutes({
    async list() {
      throw Object.assign(new Error("service not wired"), { stub: true });
    },
    async verify() {
      throw Object.assign(new Error("service not wired"), { stub: true });
    },
    async exportPdf() {
      throw Object.assign(new Error("service not wired"), { stub: true });
    },
  })
);

// Password login (staff)
app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      res.status(400).json({ error: "Email and password required" });
      return;
    }

    const result = await login(email, password);
    if (!result) {
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }

    res.json(result);
  } catch (err) {
    logger.error("Login error", { error: (err as Error).message });
    res.status(500).json({ error: "Login failed" });
  }
});

// ============================================================
// Protected routes
// ============================================================

// Applications
app.use("/api/applications", applicationRoutes);

// Screening
app.use("/api/screening", screeningRoutes);

// Approvals
app.use("/api/approvals", approvalRoutes);

// Payments
app.use("/api/payments", paymentRoutes);

// Decision Matrix (Lease Modifications)
app.use("/api/modifications", decisionMatrixRoutes);

// Lease generation and onboarding
app.use("/api/leases", leaseRoutes);

// FCRA Adverse action notices (nested under /api/applications)
app.use("/api/applications", adverseActionRoutes);

// Application messages — staff side (nested under /api/applications)
app.use("/api/applications", messagesRoutes);

// User management (system_admin: create/deactivate/reset-pw; senior_manager+: view)
app.use("/api/users", userRoutes);

// Property management (asset_manager+: create/update; all roles: view)
app.use("/api/properties", propertyRoutes);

// Compliance reports (Fair Housing Act — audit:view / Regional Manager+)
app.use("/api/compliance", complianceRoutes);
app.use("/api/recertifications", recertificationRoutes);
app.use("/api/ledger", ledgerRoutes);
app.use("/api/evictions", evictionRoutes);
app.use("/api/inspections", inspectionRoutes);
app.use("/api/maintenance", maintenanceRoutes);
app.use("/api/renewals", renewalRoutes);
app.use("/api/moveouts", moveoutRoutes);

// Tenant portal (auth'd, scoped to user's own applications)
app.use("/api/tenant", tenantRoutes);

// Audit log
app.get(
  "/api/audit",
  authenticate,
  requirePermission("audit:view"),
  async (req: AuthRequest, res) => {
    try {
      const logs = await queryAuditLog({
        applicationId: req.query.applicationId as string,
        actorId: req.query.actorId as string,
        action: req.query.action as string,
        limit: req.query.limit ? parseInt(req.query.limit as string) : 100,
        offset: req.query.offset ? parseInt(req.query.offset as string) : 0,
      });
      res.json({ logs });
    } catch (err) {
      logger.error("Failed to query audit log", { error: (err as Error).message });
      res.status(500).json({ error: "Failed to query audit log" });
    }
  }
);

// Demo data seeding (system_admin only)
app.post(
  "/api/demo/seed",
  authenticate,
  requirePermission("user:manage"),
  async (_req: AuthRequest, res) => {
    try {
      const { seedDemoData } = await import("./db/seed-demo");
      const result = await seedDemoData();
      res.json({ success: true, ...result });
    } catch (err) {
      logger.error("Demo seed failed", { error: (err as Error).message });
      res.status(500).json({ error: "Demo seed failed: " + (err as Error).message });
    }
  }
);

// ============================================================
// Error handling
// ============================================================

app.use((_req, res) => {
  res.status(404).json({ error: "Not found" });
});

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error("Unhandled error", { error: err.message, stack: err.stack });
  res.status(500).json({ error: "Internal server error" });
});

// ============================================================
// Start server
// ============================================================

if (process.env.NODE_ENV !== "test") {
  app.listen(PORT, () => {
    logger.info(`Frank Pilot server running on port ${PORT}`);
    startScheduler();
    console.log(`
  ╔══════════════════════════════════════════════════╗
  ║  Frank Pilot — Tenant Onboarding Module          ║
  ║  Community Development Programs Center of Nevada  ║
  ║                                                    ║
  ║  Server: http://localhost:${PORT}                    ║
  ║  Health: http://localhost:${PORT}/health              ║
  ╚══════════════════════════════════════════════════╝
  `);
  });
}

export default app;
