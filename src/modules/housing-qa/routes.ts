/**
 * routes.ts — Public, rate-limited housing Q&A endpoint.
 *
 * Mounted at /api/housing-qa (PUBLIC — no auth, per-IP rate-limited, mirrors
 * the applicant register/legal public routes). POST / takes { question },
 * runs the grounded retriever to assemble context, injects it into the ported
 * system prompt, and calls the Anthropic SDK NON-STREAMING. Returns
 * { answer: string }.
 *
 * Guardrails are enforced upstream (in the system prompt + grounded context);
 * this layer only validates input, rate-limits, and degrades cleanly when the
 * API key is absent (503, never a crash).
 */

import { Router, Request, Response } from "express";
import { z } from "zod";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import Anthropic from "@anthropic-ai/sdk";
import { spawn } from "child_process";
import os from "os";
import path from "path";
import { buildContext, buildTenantContext } from "./retriever";
import { buildSystemPrompt, buildTenantSystemPrompt } from "./prompt";
import { logger } from "../../utils/logger";

// Short, grounded answers → Haiku for cost. Locked by the brief.
const MODEL = "claude-haiku-4-5-20251001";
const MAX_QUESTION_CHARS = 1000;
const MAX_TOKENS = 1024;

// Estimated Haiku 4.5 rates for the daily USD budget — INFORMATIONAL, not
// billing-grade (the real invoice is Anthropic's). VERIFY against the current
// pricing page when touched; both the cap and the logged `estCostUsd` derive
// from these. Cache-read/-write tokens (if `usage` carries them) are folded in
// at the input rate — a deliberate simplification; cache rates are lower, so
// this over-estimates spend slightly, which is the safe direction for a cap.
const USD_PER_MTOK_INPUT = 1.0; // ~$1.00 / 1M input tokens
const USD_PER_MTOK_OUTPUT = 5.0; // ~$5.00 / 1M output tokens

// `scope` picks the retrieval path. DEFAULT IS "tenant" (FAQ corpus + platform
// facts ONLY — no property index, no statewide data): the public tenant widget
// must be bounded even if its bundle is stale and sends no flag. "full" is the
// explicit opt-in for the property-search experience; an unknown value 400s
// rather than falling open.
const questionSchema = z.object({
  question: z.string().trim().min(1).max(MAX_QUESTION_CHARS),
  scope: z.enum(["tenant", "full"]).default("tenant"),
});

// Per-IP limiter — public endpoint, so we key on source IP (IPv6-safe via
// express-rate-limit's ipKeyGenerator). ~20 requests / 10 min.
const qaLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 20,
  keyGenerator: (req) => ipKeyGenerator(req.ip ?? ""),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many questions, please slow down and try again soon." },
  // Surface per-IP abuse without Sentry. The PII-filtered logger scrubs the IP;
  // we log the event + path only, never the question.
  handler: (req, res, _next, options) => {
    logger.warn("housing-qa rate-limited", { path: req.path });
    res.status(options.statusCode).json(options.message);
  },
});

// --------------------------------------------------------------------------- //
// Operational guardrails — kill-switch + daily volume ceiling
//
// This endpoint is PUBLIC and, in prod, backed by a personal Max-subscription
// token through the CLI fallback. The per-IP limit alone can't bound it: many
// distinct IPs can each stay under 20/10min while summing to a large daily
// spend, and there's no way to stop it short of a redeploy. These add an
// instant kill and a hard daily cap.
// --------------------------------------------------------------------------- //

// Restart-durable default from env (ON unless explicitly "false"), mirroring
// the VOICE_INTAKE_ENABLED pattern. `inMemoryDisabled` is the break-glass: an
// auth-gated admin route flips it for an INSTANT kill with no redeploy. Either
// signal being "off" disables the endpoint.
let inMemoryDisabled = false;
export function setHousingQaDisabled(disabled: boolean): void {
  inMemoryDisabled = disabled;
}
export function housingQaEnabled(): boolean {
  return !inMemoryDisabled && process.env.HOUSING_QA_ENABLED !== "false";
}

// Hard daily call ceiling, reset at UTC midnight. Read the cap lazily so ops
// can change it without a reimport. `HOUSING_QA_DAILY_MAX=0` blocks all calls
// (a coarse second kill-switch); unset/invalid falls back to 500/day.
function dailyMax(): number {
  const raw = process.env.HOUSING_QA_DAILY_MAX;
  if (raw === undefined || raw === "") return 500;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 500;
}

// Daily USD budget — the operator-facing cost knob for the metered SDK path.
// Read lazily like dailyMax(). `HOUSING_QA_DAILY_BUDGET_USD=0` blocks all SDK
// calls (a coarse cost kill-switch, matching the DAILY_MAX=0 semantics);
// unset/invalid falls back to $10/day. Governs the SDK path ONLY — the CLI
// fallback has no `usage` to price, so it's bounded by the request counter
// (dailyMax) alone.
function dailyBudgetUsd(): number {
  const raw = process.env.HOUSING_QA_DAILY_BUDGET_USD;
  if (raw === undefined || raw === "") return 10;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 10;
}

let dailyCount = 0;
let dailyInputTokens = 0;
let dailyOutputTokens = 0;
let dailyWindow = utcDayStamp();
function utcDayStamp(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD in UTC
}
// Rolls every per-day accumulator together on the first call of a new UTC day,
// so the request counter and the spend counters can never desync.
function rollWindow(): void {
  const today = utcDayStamp();
  if (today !== dailyWindow) {
    dailyWindow = today;
    dailyCount = 0;
    dailyInputTokens = 0;
    dailyOutputTokens = 0;
  }
}
// Estimated USD spent so far today, derived from accumulated tokens.
function dailyEstCostUsd(): number {
  return (
    (dailyInputTokens / 1e6) * USD_PER_MTOK_INPUT +
    (dailyOutputTokens / 1e6) * USD_PER_MTOK_OUTPUT
  );
}
// Rolls the window then checks both ceilings: the USD budget (SDK path only —
// the CLI path has no usage to price, so pass usagePriced=false there) and the
// request counter. Returns false when either is already reached (caller 503s);
// otherwise counts this call → true. The budget check is post-hoc: real token
// usage is known only AFTER the call, so a call can overshoot the budget by at
// most one call (~$0.01 at MAX_TOKENS=1024) — acceptable.
function underDailyCapAndCount(usagePriced: boolean): boolean {
  rollWindow();
  if (usagePriced && dailyEstCostUsd() >= dailyBudgetUsd()) return false;
  if (dailyCount >= dailyMax()) return false;
  dailyCount++;
  return true;
}
// Records real token usage from a completed SDK call so the budget gate and the
// status route reflect actual spend. Cache tokens (if present) are folded into
// input. No-op for the CLI path, which reports no usage.
function recordUsage(inputTokens: number, outputTokens: number): void {
  rollWindow();
  dailyInputTokens += Math.max(0, inputTokens);
  dailyOutputTokens += Math.max(0, outputTokens);
}
// Observability for the admin status route + tests.
export function housingQaStatus(): {
  enabled: boolean;
  dailyCount: number;
  dailyMax: number;
  dailyInputTokens: number;
  dailyOutputTokens: number;
  dailyEstCostUsd: number;
  dailyBudgetUsd: number;
} {
  return {
    enabled: housingQaEnabled(),
    dailyCount,
    dailyMax: dailyMax(),
    dailyInputTokens,
    dailyOutputTokens,
    dailyEstCostUsd: Number(dailyEstCostUsd().toFixed(4)),
    dailyBudgetUsd: dailyBudgetUsd(),
  };
}

// Lazily construct the SDK client so a missing key degrades to a 503 rather
// than throwing at module load (which would crash the whole server boot).
let cachedClient: Anthropic | null = null;
function getClient(): Anthropic | null {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  if (!cachedClient) cachedClient = new Anthropic({ apiKey: key });
  return cachedClient;
}

// LOCAL/keyless fallback: shell out to the `claude` CLI (uses the operator's
// OAuth login) instead of the SDK. OPT-IN via HOUSING_QA_CLI_FALLBACK=1 so a
// server never spawns a subprocess by surprise — prod with an API key uses the
// SDK path above and never reaches here. Constrained to a clean single-shot:
// --system-prompt fully overrides the agent prompt, no tools are allowed, and
// cwd is a temp dir so no CLAUDE.md is auto-discovered. The question is passed
// as a spawn arg (array form, no shell) so it cannot inject.
function cliFallbackEnabled(): boolean {
  return process.env.HOUSING_QA_CLI_FALLBACK === "1";
}

// Bound concurrent subprocesses process-wide. The per-IP rate limit doesn't
// cap fan-out across many IPs, so cap the CLI path here and 503 when saturated.
const MAX_CONCURRENT_CLI = 3;
let activeCliCalls = 0;

// Cap captured output so a runaway / injection-induced huge response can't
// balloon node's heap (the CLI path has no MAX_TOKENS equivalent).
const MAX_CLI_OUTPUT_BYTES = 256 * 1024;

// Resolve the `claude` binary. In prod (Railway) it ships as the
// @anthropic-ai/claude-code dependency, whose bin is a ~215MB native launcher
// that is NOT on PATH for the `node dist/index.js` process — so resolve it from
// the installed package dir. CLAUDE_CLI_PATH overrides (tests / custom installs);
// bare "claude" is the last resort for a globally-installed CLI.
function resolveCliBin(): string {
  if (process.env.CLAUDE_CLI_PATH) return process.env.CLAUDE_CLI_PATH;
  try {
    const pkgPath = require.resolve("@anthropic-ai/claude-code/package.json");
    const pkg = require(pkgPath) as { bin?: string | Record<string, string> };
    const rel = typeof pkg.bin === "string" ? pkg.bin : pkg.bin?.claude;
    if (rel) return path.join(path.dirname(pkgPath), rel);
  } catch {
    /* dependency not present (e.g. dev without it) — fall through to PATH */
  }
  return "claude";
}

function callViaCli(system: string, question: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      resolveCliBin(),
      [
        "-p",
        "--system-prompt",
        system,
        "--model",
        MODEL,
        // `--tools ""` is the CLI's DOCUMENTED "disable ALL tools" switch and is
        // load-bearing for security: this `claude` runs inside the prod
        // container, so a prompt-injected "read /proc/self/environ" must not be
        // able to call a tool. NOTE the trap — the similarly-named
        // `--allowed-tools ""` does NOT disable tools (read-family tools stay
        // auto-permitted in -p mode and WILL exfiltrate files). Verified
        // empirically 2026-05-29; never swap this back to --allowed-tools.
        "--tools",
        "",
        "--output-format",
        "text",
        // `--` ends option parsing: the attacker-controlled question is the
        // final positional and can never be interpreted as a CLI flag (e.g.
        // `--dangerously-skip-permissions`). Required — `-p` is a boolean flag,
        // not an option that consumes the next token.
        "--",
        question,
      ],
      { cwd: os.tmpdir(), timeout: 60_000, killSignal: "SIGKILL" }
    );
    let out = "";
    let err = "";
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
    };
    child.stdout.on("data", (d) => {
      out += d.toString();
      if (out.length > MAX_CLI_OUTPUT_BYTES) {
        child.kill("SIGKILL");
        finish(() => reject(new Error("claude CLI output exceeded cap")));
      }
    });
    child.stderr.on("data", (d) => {
      // Keep only the tail; full stderr is never returned to the client.
      err = (err + d.toString()).slice(-200);
    });
    child.on("error", (e) => finish(() => reject(e)));
    child.on("close", (code) => {
      finish(() => {
        if (code === 0) resolve(out.trim());
        else reject(new Error(`claude CLI exited ${code}: ${err}`));
      });
    });
  });
}

export function housingQaRouter(): Router {
  const router: Router = Router();

  router.post("/", qaLimiter, async (req: Request, res: Response) => {
    const startedAt = Date.now();

    // Kill-switch first — a disabled endpoint short-circuits before we even
    // parse the body. Same opaque 503 body as the keyless path.
    if (!housingQaEnabled()) {
      logger.warn("housing-qa request rejected — endpoint disabled");
      res.status(503).json({
        error:
          "The housing assistant is temporarily unavailable. Please try again later.",
      });
      return;
    }

    const parsed = questionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "A non-empty question (max 1000 characters) is required.",
      });
      return;
    }
    const { question, scope } = parsed.data;

    const client = getClient();
    const useCli = !client && cliFallbackEnabled();
    if (!client && !useCli) {
      logger.warn("housing-qa request rejected — ANTHROPIC_API_KEY not set");
      res.status(503).json({
        error:
          "The housing assistant is temporarily unavailable. Please try again later.",
      });
      return;
    }

    // Daily ceilings — only well-formed, dispatchable requests count. The USD
    // budget is enforced only when the SDK (metered) path will answer; the CLI
    // path is priced-blind and bounded by the request counter alone.
    if (!underDailyCapAndCount(Boolean(client))) {
      logger.warn("housing-qa request rejected — daily cap reached", {
        dailyMax: dailyMax(),
        dailyBudgetUsd: dailyBudgetUsd(),
        dailyEstCostUsd: Number(dailyEstCostUsd().toFixed(4)),
      });
      res.status(503).json({
        error:
          "The housing assistant has reached today's limit. Please try again tomorrow.",
      });
      return;
    }

    try {
      // Tenant scope never touches the property index — the statewide source
      // is structurally absent from its context, not prompted away.
      let system: string;
      let routeLabel: string;
      let propertyCount: number;
      if (scope === "full") {
        const context = buildContext(question);
        system = buildSystemPrompt(context);
        routeLabel = context.routing;
        propertyCount = context.properties.length;
      } else {
        const context = buildTenantContext(question);
        system = buildTenantSystemPrompt(context);
        routeLabel = "tenant_faq";
        propertyCount = 0;
      }

      let answer: string;
      // Captured from the SDK response for the budget gate + spend log; stays
      // null on the CLI path, which reports no usage.
      let inputTokens: number | null = null;
      let outputTokens: number | null = null;
      if (client) {
        const completion = await client.messages.create({
          model: MODEL,
          max_tokens: MAX_TOKENS,
          system,
          messages: [{ role: "user", content: question }],
        });
        answer = completion.content
          .filter(
            (block): block is Anthropic.TextBlock => block.type === "text"
          )
          .map((block) => block.text)
          .join("")
          .trim();
        // Fold cache tokens into input (over-estimates slightly — the safe
        // direction for a cost cap). Feeds the daily budget + status route.
        const u = completion.usage;
        inputTokens =
          (u?.input_tokens ?? 0) +
          (u?.cache_creation_input_tokens ?? 0) +
          (u?.cache_read_input_tokens ?? 0);
        outputTokens = u?.output_tokens ?? 0;
        recordUsage(inputTokens, outputTokens);
      } else {
        // CLI fallback (local, keyless) — see callViaCli. Bound concurrency so
        // many IPs can't fan out into unbounded subprocesses.
        if (activeCliCalls >= MAX_CONCURRENT_CLI) {
          res.status(503).json({
            error:
              "The housing assistant is busy right now. Please try again in a moment.",
          });
          return;
        }
        activeCliCalls++;
        try {
          answer = await callViaCli(system, question);
        } finally {
          activeCliCalls--;
        }
      }

      if (!answer) {
        res.status(502).json({
          error: "The assistant returned an empty response. Please try again.",
        });
        return;
      }

      // PII-safe usage line for cost-spike + abuse visibility. Question LENGTH
      // only, never content (the logger PII-filters regardless). `route` is the
      // retrieval branch; `path` is which backend answered. Token counts + the
      // estimated cost are present only on the metered SDK path (null on CLI);
      // tokens are not PII.
      logger.info("housing-qa answered", {
        route: routeLabel,
        scope,
        path: client ? "sdk" : "cli",
        qLen: question.length,
        propertyCount,
        latencyMs: Date.now() - startedAt,
        inputTokens,
        outputTokens,
        estCostUsd:
          inputTokens !== null && outputTokens !== null
            ? Number(
                (
                  (inputTokens / 1e6) * USD_PER_MTOK_INPUT +
                  (outputTokens / 1e6) * USD_PER_MTOK_OUTPUT
                ).toFixed(4)
              )
            : null,
      });

      res.json({ answer });
    } catch (err) {
      // Never echo the upstream error (may embed prompt fragments); log name only.
      const errName = err instanceof Error ? err.name : "UnknownError";
      logger.error("housing-qa model call failed", { errorName: errName });
      res.status(502).json({
        error: "The housing assistant couldn't answer right now. Please try again.",
      });
    }
  });

  return router;
}

export default housingQaRouter;
