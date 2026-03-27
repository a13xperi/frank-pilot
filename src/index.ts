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

const app = express();
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

// Health check
app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "frank-pilot", timestamp: new Date().toISOString() });
});

// Login
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

// User management (system_admin: create/deactivate/reset-pw; senior_manager+: view)
app.use("/api/users", userRoutes);

// Property management (asset_manager+: create/update; all roles: view)
app.use("/api/properties", propertyRoutes);

// Compliance reports (Fair Housing Act — audit:view / Regional Manager+)
app.use("/api/compliance", complianceRoutes);

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

app.listen(PORT, () => {
  logger.info(`Frank Pilot server running on port ${PORT}`);
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

export default app;
