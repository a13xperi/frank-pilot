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
import { buildContext } from "./retriever";
import { buildSystemPrompt } from "./prompt";
import { logger } from "../../utils/logger";

// Short, grounded answers → Haiku for cost. Locked by the brief.
const MODEL = "claude-haiku-4-5-20251001";
const MAX_QUESTION_CHARS = 1000;
const MAX_TOKENS = 1024;

const questionSchema = z.object({
  question: z.string().trim().min(1).max(MAX_QUESTION_CHARS),
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
});

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

function callViaCli(system: string, question: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "claude",
      [
        "-p",
        question,
        "--system-prompt",
        system,
        "--model",
        MODEL,
        "--allowed-tools",
        "",
        "--output-format",
        "text",
      ],
      { cwd: os.tmpdir(), timeout: 60_000 }
    );
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (err += d.toString()));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(out.trim());
      else reject(new Error(`claude CLI exited ${code}: ${err.slice(0, 200)}`));
    });
  });
}

export function housingQaRouter(): Router {
  const router: Router = Router();

  router.post("/", qaLimiter, async (req: Request, res: Response) => {
    const parsed = questionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "A non-empty question (max 1000 characters) is required.",
      });
      return;
    }
    const { question } = parsed.data;

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

    try {
      const context = buildContext(question);
      const system = buildSystemPrompt(context);

      let answer: string;
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
      } else {
        // CLI fallback (local, keyless) — see callViaCli.
        answer = await callViaCli(system, question);
      }

      if (!answer) {
        res.status(502).json({
          error: "The assistant returned an empty response. Please try again.",
        });
        return;
      }

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
