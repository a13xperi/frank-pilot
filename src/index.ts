import dotenv from "dotenv";
dotenv.config();

import express from "express";
import cors from "cors";
import helmet from "helmet";
import { logger } from "./utils/logger";
import { resolveCorsOrigin } from "./utils/cors-origin";
import { authenticate, login, AuthRequest } from "./middleware/auth";
import { requirePermission } from "./middleware/rbac";
import {
  setHousingQaDisabled,
  housingQaStatus,
} from "./modules/housing-qa/routes";
import { queryAuditLog } from "./middleware/audit";

// Route imports
import applicationRoutes from "./modules/application/routes";
import screeningRoutes from "./modules/screening/routes";
import approvalRoutes from "./modules/approval/routes";
import paymentRoutes from "./modules/payment/routes";
import paymentWebhookRouter from "./modules/payment/webhook";
import craWebhookRouter from "./modules/screening/cra-webhook";
import { assertStripeProdConfig } from "./modules/payment/boot-guard";
import {
  voiceIntakeWebhookRouter,
  voiceToolCallbackRouter,
  voiceBrowserSessionRouter,
  voiceIntakeRoutes,
  voiceIntakeApplicantRoutes,
  registerVoiceToolHandlers,
} from "./modules/voice-intake";
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
import { createTapeService } from "./modules/tape/service";
import { PgTapeRepository } from "./modules/tape/repository";
import { qaRouter } from "./modules/qa/routes";
import { housingQaRouter } from "./modules/housing-qa/routes";
import acquisitionRoutes from "./modules/acquisitions/routes";
import savedRoutes from "./modules/saved/routes";
import { outboundValidationRoutes } from "./modules/outbound-validation";
import { managerRoutes } from "./modules/manager";
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

assertStripeProdConfig(process.env);

const app = express();
app.set("trust proxy", 1);
const PORT = parseInt(process.env.PORT || "3000");

// Security middleware
app.use(helmet());
// HIGH-2 (SECURITY-AUDIT-2026-05-21): fail closed on CORS — production
// refuses to boot without an explicit allow-list (mirrors the JWT_SECRET /
// ENCRYPTION_KEY gate above). Dev/test fall back to localhost so `npm start`
// works out of the box. See src/utils/cors-origin.ts + unit tests.
let corsOrigins: string[];
try {
  corsOrigins = resolveCorsOrigin(process.env);
} catch (err) {
  console.error((err as Error).message);
  process.exit(1);
}
// credentials:true so the httpOnly `uh_guest` guest-shortlist cookie is
// accepted on cross-origin XHR (Access-Control-Allow-Credentials). In prod the
// client reaches the API through a same-origin Vercel rewrite, so the cookie is
// first-party there; this keeps direct cross-origin calls working too. Note the
// origin allow-list above is explicit (never "*"), which credentialed CORS
// requires.
app.use(cors({ origin: corsOrigins, credentials: true }));

// BP-08 Stripe webhook — MUST be mounted before `express.json()` so the raw
// request body survives intact for `stripe.webhooks.constructEvent`. Moving
// this below the JSON parser silently breaks signature verification: the
// parser consumes the buffer and we lose the bytes the HMAC was computed
// over. Do not reorder.
app.use("/api/payments/webhook", paymentWebhookRouter);

// Voice intake (ElevenLabs Conv. AI) webhook — same raw-body constraint as
// the Stripe receiver above. The router itself flag-gates on
// VOICE_INTAKE_ENABLED so it can sit in the chain even when the feature is
// off; mounting unconditionally keeps the request path stable across
// environments (otherwise webhook delivery during a config flip would 404
// and ElevenLabs would auto-disable us after 10 consecutive failures).
app.use("/api/webhooks/elevenlabs/post-call", voiceIntakeWebhookRouter);

// Voice agent IN-CALL server tools (Phase A) — sibling of the post-call
// webhook above, same raw-body constraint. Flag-gates on VOICE_TOOLS_ENABLED
// independently of the post-call flag so the receiver can ride along into
// prod (dark, returning 503) before any tool handler is wired.
app.use("/api/webhooks/elevenlabs/tools", voiceToolCallbackRouter);

// Consumer-report CRA webhook (Checkr background + TransUnion ShareAble credit) —
// same raw-body constraint as the receivers above (signature verification needs
// the unparsed bytes). The router self-gates on CRA_WEBHOOK_SECRET (503 until a
// contract is signed), so it can ride into prod dark. Do not move below the JSON
// parser. See modules/screening/cra-webhook.ts.
app.use("/api/webhooks/cra", craWebhookRouter);

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

// Grounded housing Q&A chat (PUBLIC, per-IP rate-limited). This mount serves
// the UNAUTHENTICATED tenant-portal widget, so it is pinned to the
// tenant_public surface: tenantFaq-corpus-only retrieval (NO statewide/GPMG
// property data), a tenant-scoped prompt, and the internal-language output
// guard — enforced in code, see RETRIEVAL_POLICIES in housing-qa/retriever.ts.
// Degrades to 503 when ANTHROPIC_API_KEY is absent.
app.use("/api/housing-qa", housingQaRouter({ surface: "tenant_public" }));

// Break-glass kill-switch for the public housing-QA endpoint (system_admin
// only). HOUSING_QA_ENABLED=false is the restart-durable default; this flips
// the in-memory override instantly with NO redeploy. GET reports current state
// + today's call count for cost visibility.
app.get(
  "/api/admin/housing-qa",
  authenticate,
  requirePermission("housing_qa:admin"),
  (_req: AuthRequest, res) => {
    res.json(housingQaStatus());
  }
);
app.post(
  "/api/admin/housing-qa",
  authenticate,
  requirePermission("housing_qa:admin"),
  (req: AuthRequest, res) => {
    const enabled = (req.body as { enabled?: unknown })?.enabled;
    if (typeof enabled !== "boolean") {
      res.status(400).json({ error: "Body must include { enabled: boolean }" });
      return;
    }
    setHousingQaDisabled(!enabled);
    logger.warn("housing-qa kill-switch toggled", {
      enabled,
      by: req.user?.id,
    });
    res.json(housingQaStatus());
  }
);

// "Talk to Frank" — in-browser WebRTC voice session minter. Anonymous
// visitors are the dominant case (mirrors the outbound phone semantics),
// so this sits ahead of any auth-required route. Flag-gates on
// VOICE_BROWSER_SESSIONS_ENABLED so the route returns 503 (and the UI
// hides the affordance) until the operator opts in. Daily budget cap +
// per-IP + per-cookie rate limits are enforced inside the router.
app.use("/api/voice/sessions", voiceBrowserSessionRouter);

// Saved-property shortlist (public — guests via uh_guest cookie OR authed users).
// Guests save without an account; on magic-link conversion the saves migrate
// onto the real user. See src/modules/saved/.
app.use("/api/saved", savedRoutes);

// BP-03b compliance tape beacons (HUD-928.1 page-view, welcome-accept).
// Stub module — see src/modules/tape/index.ts. Replace with canonical BP-02
// helper when it lands.
app.use("/api/tape", tapeRoutes);

// BP-02 compliance tape viewer (operator-only: list, verify, export.pdf).
// Phase 2 cutover: the real TapeService (Lane B) is wired here, replacing the
// inert Phase-1 stub. The viewer now serves live hash-chain reads / verify /
// PDF export against the compliance_tape table. The verify-cron in
// src/scheduler.ts shares the same service + repository wiring.
//
// Flag-gated on COMPLIANCE_TAPE_V2_ENABLED (mirrors the verify-cron gate in
// src/scheduler.ts). When the flag is off the routes are NOT mounted, so a
// request to /api/compliance-tape/* falls through to the 404 handler below.
if (process.env.COMPLIANCE_TAPE_V2_ENABLED === "true") {
  app.use(
    "/api/compliance-tape",
    createTapeViewerRoutes(createTapeService(new PgTapeRepository()))
  );
  logger.info("BP-02 compliance-tape viewer routes mounted");
} else {
  logger.info(
    "BP-02 compliance-tape viewer routes skipped — COMPLIANCE_TAPE_V2_ENABLED is off"
  );
}

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
    // L1.3 audit follow-up (PR #101): never log err.message — downstream
    // validators may embed the submitted email/password in their messages,
    // leaking credentials into combined.log. Log err.name only.
    const errName = err instanceof Error ? err.name : "UnknownError";
    logger.error("Login error", { errorName: errName });
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

// QAP acquisitions — Demand-Evidence Engine (asset_manager+ / acquisition:view)
app.use("/api/acquisitions", acquisitionRoutes);

// Manager briefing — unified operations rollup (senior_manager+ / manager_briefing:view)
app.use("/api/manager", managerRoutes);

// Voice intake PM console (flag-gated to avoid surfacing unstamped review
// surface area when the feature is off in an environment).
if (process.env.VOICE_INTAKE_ENABLED === "true") {
  app.use("/api/pm/voice-intakes", voiceIntakeRoutes);
  logger.info("Voice intake PM routes mounted");
} else {
  logger.info("Voice intake PM routes skipped — VOICE_INTAKE_ENABLED is off");
}

// Applicant-facing voice-intake prefill (Phase B). Mounted on the same
// flag as the PM console — both surfaces depend on the voice_intake_calls
// table existing and the post-call webhook having landed rows.
if (process.env.VOICE_INTAKE_ENABLED === "true") {
  app.use("/api/voice/intakes", voiceIntakeApplicantRoutes);
  logger.info("Voice intake applicant routes mounted");
}

// Phase B: register in-call server-tool handlers (send_app_link, etc.).
// Idempotent — safe even when VOICE_TOOLS_ENABLED is off; the tool-callback
// router will still 503 until that flag flips on.
registerVoiceToolHandlers();

// Outbound waitlist-validation dialer admin surface (DM-FRANK-029).
// Always mounted; every route 503s while FRANK_OUTBOUND_ENABLED is off
// (router-level guard), so a dark deploy is byte-identical in behavior.
app.use("/api/admin/outbound-validation", outboundValidationRoutes);

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

// QA debug bundles (audit:view) — operator viewer for screenshots / sidecars / rrweb
app.use("/api/qa", qaRouter());

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
