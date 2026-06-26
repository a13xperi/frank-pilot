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
  registerFunnelToolHandlers,
  registerNameVerificationHandler,
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
import { callFeedbackRoutes } from "./modules/call-feedback";
import { waitlistGraduationRoutes } from "./modules/waitlist-graduation";
import { propertyRouterRoutes } from "./modules/property-router";
import {
  outboundApplicationRoutes,
  registerOutboundApplicationToolHandlers,
} from "./modules/outbound-application";
import { registerVoiceVerificationHandlers } from "./modules/voice-verification";
import { managerRoutes } from "./modules/manager";
import { cockpitMetricsRoutes } from "./modules/cockpit-metrics";
// Caller-memory voice tools (Phase 2/3): texted-PIN validation
// (send_pin / verify_pin) + caller-history rapport (get_caller_history).
// Registered alongside the other in-call server-tool handlers below.
import { registerValidationPinHandlers } from "./modules/outbound-validation/validation-tools";
import { registerCallerHistoryHandler } from "./modules/caller-history/service";
import { registerStartVerificationHandler } from "./modules/voice-intake/start-verification";
import { registerTakePaymentHandler } from "./modules/voice-intake/take-payment";
import { registerGetApplicationStatusHandler } from "./modules/voice-intake/get-application-status";
import { registerGetPropertyDetailsHandler } from "./modules/voice-intake/get-property-details";
import { registerRecommendByNeedHandler } from "./modules/voice-intake/recommend-by-need";
import { registerFollowUpHandlers } from "./modules/follow-ups/tools";
import { registerEscalationHandler } from "./modules/voice-intake/escalation";
import { registerCallTimeHandler } from "./modules/follow-ups/call-time";
import { registerRelationshipHandlers } from "./modules/relationship/tools";
import { registerCreateApplicationHandler } from "./modules/voice-intake/create-application";
import { frankContactRoutes } from "./modules/frank-contact";
import { smsIntakeRoutes } from "./modules/sms-intake";
import { cobrowseRoutes, registerCobrowseHandlers } from "./modules/cobrowse";
import { truthTokenRoutes } from "./modules/truth-token";
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

// Inbound SMS intake (phone-first Frank, Phase 1). Carries its OWN
// express.urlencoded on POST /inbound, so it mounts BEFORE the global
// express.json(). Self-gates 503 until SMS_INTAKE_ENABLED.
app.use("/api/webhooks/twilio", smsIntakeRoutes);

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

// Frank vCard — public "save my number" contact card (Phase 0b).
app.use("/api/frank", frankContactRoutes);

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

// Concierge co-browse watch-along (Phase 2). Flag-gated 503 until COBROWSE_ENABLED;
// scaffold dark — live computer-use loop pending counsel sign-off.
app.use("/api/cobrowse", cobrowseRoutes);

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

// Truth Token — public read-only grounding attestation verify surface (Phase 3).
// Flag-gated on TRUTH_TOKEN_ENABLED; off => routes NOT mounted => 404 fallthrough.
if (process.env.TRUTH_TOKEN_ENABLED === "true") {
  app.use("/api/truth-tokens", truthTokenRoutes());
  logger.info("Truth Token verify routes mounted");
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

// Cockpit metrics — NO-PII inbound voice counts for the token-watch Frank tab
// (shared-secret COCKPIT_METRICS_TOKEN; fail-closed 503 until set).
app.use("/api/cockpit", cockpitMetricsRoutes);

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
registerNameVerificationHandler();
registerCobrowseHandlers();

// Jacqueline's in-call application tools (Frank core C3). Safe to register dark
// — the tools only fire if a live outbound agent (DEFERRED) is wired to call
// them, and the tool-callback router still 503s until VOICE_TOOLS_ENABLED.
registerOutboundApplicationToolHandlers();
// Caller-memory in-call tools (Phase 2/3). Same idempotent one-time-register
// contract as the handlers above; the tool-callback router still 503s until
// VOICE_TOOLS_ENABLED flips on, so this is safe to wire unconditionally.
registerValidationPinHandlers();
registerCallerHistoryHandler();
// Funnel voice tools (prequalify + present_options) — same dark-by-flag path;
// the tool-callback router still 503s until VOICE_TOOLS_ENABLED flips on.
registerFunnelToolHandlers();
// Phase B paid-conversion tool (start_verification — $35.95 fee → screening).
registerCreateApplicationHandler();
registerStartVerificationHandler();
registerTakePaymentHandler();
registerGetApplicationStatusHandler();
registerGetPropertyDetailsHandler();
registerRecommendByNeedHandler();
registerFollowUpHandlers();
registerEscalationHandler();
// check_call_time — the call clock. Lets Frank notice he's near the duration
// cut and warn + schedule_followup + wrap before the line drops (call-time.ts).
registerCallTimeHandler();
registerRelationshipHandlers();

// Phase 2 voice verification + caller history (send_verification,
// get_caller_history). Flag-gated: only register when VOICE_VERIFICATION_ENABLED
// is on. Each handler ALSO fails closed on the flag (belt + suspenders), and the
// tool-callback router still 503s until VOICE_TOOLS_ENABLED — a dark deploy with
// the flag off never wires these tools into the dispatch table.
if (process.env.VOICE_VERIFICATION_ENABLED === "true") {
  registerVoiceVerificationHandlers();
  logger.info("Voice verification tool handlers registered (send_verification, get_caller_history)");
} else {
  logger.info("Voice verification tool handlers skipped — VOICE_VERIFICATION_ENABLED is off");
}

// Outbound waitlist-validation dialer admin surface (DM-FRANK-029).
// Always mounted; every route 503s while FRANK_OUTBOUND_ENABLED is off
// (router-level guard), so a dark deploy is byte-identical in behavior.
app.use("/api/admin/outbound-validation", outboundValidationRoutes);

// Tenant-call feedback loop (Frank core C1). Auth'd; capture/view open to
// leasing agents, dataset export senior+ (see rbac matrix). No feature flag —
// the marks are inert data until a training job reads them.
app.use("/api/call-feedback", callFeedbackRoutes);

// Waitlist→application graduation + relationship-ID dedup (Frank core C5).
// Auth'd; application:create authority. Idempotent per waitlist entry.
app.use("/api/waitlist", waitlistGraduationRoutes);

// Multi-property inbound router (Frank core C4). Maps property→agent and buckets
// inbound contacts. Lookup/selection only — never touches live DID/IVR config.
app.use("/api/property-routing", propertyRouterRoutes);

// Outbound full-application agent admin (Frank core C3, "Jacqueline"). Every
// route 503s while FRANK_OUTBOUND_APPLICATION_ENABLED is off. The DIAL is
// DEFERRED — this surface only manages the queue, it never places a call.
app.use("/api/admin/outbound-application", outboundApplicationRoutes);

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
  const server = app.listen(PORT, () => {
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

  // Graceful shutdown: on a deploy SIGTERM/SIGINT, stop accepting new
  // connections and let in-flight requests drain instead of being killed
  // mid-webhook/screening/ledger transaction. Hard-stop after 10s as a backstop.
  const shutdown = (sig: string): void => {
    logger.info(`${sig} received — draining connections before exit`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 10_000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

// Last-resort process handlers so an escaped rejection / throw from a
// fire-and-forget block is LOGGED, not silently fatal (modern Node exits on an
// unhandled rejection by default).
process.on("unhandledRejection", (reason) => {
  logger.error("unhandledRejection", {
    reason: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack : undefined,
  });
});
process.on("uncaughtException", (err) => {
  logger.error("uncaughtException", { error: err.message, stack: err.stack });
});

export default app;
