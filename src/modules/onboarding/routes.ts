/**
 * Onboarding concierge — applicant-facing API.
 *
 * Mount: /api/onboarding  (see src/index.ts). The whole router fail-closes to 503 until
 * ONBOARDING_CONCIERGE_ENABLED=true, so it can ride into prod dark (the established
 * frank-pilot flag pattern). Endpoints power the FrankGuide web component + the shared
 * cross-channel session:
 *
 *   GET  /steps?channel=web        — the questions to ask (plain-language), in order
 *   POST /start { channel? }       — open a session, returns a resume token
 *   GET  /resume/:token            — rehydrate a session (cross-channel resume)
 *   POST /:id/answer { ... }       — record one answer + advance
 *   POST /tts { text }             — Frank's voice (ElevenLabs proxy)
 *
 * Everything is authenticated (the guide runs after the magic-link sign-in), except the
 * flag gate. Sensitive answers (SSN/DOB/payment) are collected on dedicated secure steps,
 * never echoed, and never persisted to the session — see service.recordAnswer.
 */
import { Router, Response } from "express";
import { authenticate, AuthRequest } from "../../middleware/auth";
import { logger } from "../../utils/logger";
import { ttsRouter } from "./tts";
import { register } from "./register";
import { questionsForChannel, type Channel } from "./steps";
import {
  createSession,
  getSessionByToken,
  recordAnswer,
  progress,
} from "./service";

const router = Router();

// Fail-closed dark default: the whole concierge returns 503 until the flag flips on.
router.use((_req, res, next) => {
  if (process.env.ONBOARDING_CONCIERGE_ENABLED !== "true") {
    res.status(503).json({ error: "Onboarding concierge is not enabled" });
    return;
  }
  next();
});

function asChannel(v: unknown): Channel {
  const s = String(v ?? "web");
  return (["web", "sms", "voice", "email"].includes(s) ? s : "web") as Channel;
}

// The questions the guide asks — each prompt rewritten to plain language. Drives
// FrankGuide's fetchQuestions(). Channel filters out sensitive steps for voice/SMS.
router.get("/steps", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const channel = asChannel(req.query.channel);
  try {
    const questions = await Promise.all(
      questionsForChannel(channel).map(async (q) => ({
        id: q.id,
        step: q.step,
        kind: q.kind,
        sensitive: !!q.sensitive,
        title: await register(q.title),
        detail: q.detail ? await register(q.detail) : undefined,
      }))
    );
    res.json({ channel, questions });
  } catch (err) {
    logger.error("onboarding steps failed", { error: (err as Error).message });
    res.status(500).json({ error: "Could not load questions" });
  }
});

// Open a session for this signed-in user; returns the resume token + initial progress.
router.post("/start", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const channel = asChannel(req.body?.channel);
  try {
    const session = await createSession({ channel, email: req.user?.email ?? null });
    res.json({
      sessionId: session.id,
      token: session.resumeToken,
      currentStep: session.currentStep,
      progress: progress(session, channel),
    });
  } catch (err) {
    logger.error("onboarding start failed", { error: (err as Error).message });
    res.status(500).json({ error: "Could not start" });
  }
});

// Rehydrate a session from its token (the cross-channel resume handle). Only non-sensitive
// staged answers come back — sensitive values were never stored.
router.get(
  "/resume/:token",
  authenticate,
  async (req: AuthRequest, res: Response): Promise<void> => {
    const session = await getSessionByToken(String(req.params.token ?? ""));
    if (!session) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const channel = session.channelPref ?? "web";
    const answers: Record<string, string> = {};
    for (const [id, st] of Object.entries(session.answersState)) {
      if (st.value !== undefined) answers[id] = st.value;
    }
    res.json({
      sessionId: session.id,
      token: session.resumeToken,
      currentStep: session.currentStep,
      status: session.status,
      answers,
      progress: progress(session, channel),
    });
  }
);

// Record one answer (or a skip) and advance the resume cursor.
router.post(
  "/:id/answer",
  authenticate,
  async (req: AuthRequest, res: Response): Promise<void> => {
    const sessionId = String(req.params.id ?? "");
    const body = (req.body ?? {}) as { questionId?: string; value?: string; skip?: boolean };
    const channel = asChannel(req.body?.channel);
    if (!body.questionId) {
      res.status(400).json({ error: "questionId required" });
      return;
    }
    try {
      const updated = await recordAnswer(
        sessionId,
        String(body.questionId),
        String(body.value ?? "").slice(0, 2000),
        channel,
        { skip: !!body.skip }
      );
      if (!updated) {
        res.status(404).json({ error: "Session or question not found" });
        return;
      }
      res.json({
        ok: true,
        currentStep: updated.currentStep,
        progress: progress(updated, channel),
      });
    } catch (err) {
      logger.error("onboarding answer failed", { error: (err as Error).message, sessionId });
      res.status(500).json({ error: "Could not save" });
    }
  }
);

// Frank's voice — authed + behind the same flag gate above.
router.use("/tts", ttsRouter);

export default router;
