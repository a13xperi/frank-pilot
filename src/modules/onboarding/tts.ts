/**
 * Frank's voice for the onboarding guide — server-side ElevenLabs proxy.
 *
 * The API key stays server-side; the browser only ever receives audio bytes. Mirrors
 * fleet-portal/api/tts.js: retries transient ElevenLabs failures (429 / 5xx) so the
 * guide reliably speaks in Frank's real voice. The client never falls back to a
 * different (robotic) voice — on hard failure it stays silent and shows the text.
 *
 * Mount: POST /api/onboarding/tts  (self-gated by the onboarding router's flag).
 */
import { Router, Request, Response } from "express";
import { logger } from "../../utils/logger";

const FRANK_VOICE_ID = process.env.FRANK_VOICE_ID || "0hghHo7QnCixqORu75zl"; // frank-hawkins-pvc (Frank V2 PVC)
const ELEVEN_MODEL = process.env.ELEVEN_MODEL || "eleven_turbo_v2_5"; // low-latency

export const ttsRouter = Router();

ttsRouter.post("/", async (req: Request, res: Response): Promise<void> => {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) {
    res.status(503).json({ error: "tts not configured" });
    return;
  }

  const body = (req.body ?? {}) as { text?: unknown };
  const text = String(body.text ?? "")
    .replace(/\s+/g, " ")
    .slice(0, 800)
    .trim();
  if (!text) {
    res.status(400).json({ error: "text required" });
    return;
  }

  const url = `https://api.elevenlabs.io/v1/text-to-speech/${FRANK_VOICE_ID}?output_format=mp3_44100_128`;
  const payload = JSON.stringify({
    text,
    model_id: ELEVEN_MODEL,
    voice_settings: { stability: 0.45, similarity_boost: 0.8, style: 0, use_speaker_boost: true },
  });

  let status = 0;
  let detail = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "xi-api-key": key, "Content-Type": "application/json", Accept: "audio/mpeg" },
        body: payload,
      });
      if (r.ok) {
        const buf = Buffer.from(await r.arrayBuffer());
        res.setHeader("Content-Type", "audio/mpeg");
        res.setHeader("Cache-Control", "private, max-age=3600");
        res.send(buf);
        return;
      }
      status = r.status;
      detail = (await r.text()).slice(0, 200);
      // 4xx that isn't a rate-limit won't improve on retry (bad voice id, quota, etc.)
      if (status !== 429 && status < 500) break;
    } catch (err) {
      status = 0;
      detail = (err as Error).message;
    }
    await new Promise((f) => setTimeout(f, 350 * (attempt + 1)));
  }

  logger.warn("onboarding tts failed", { status, detail });
  res.status(502).json({ error: `tts ${status}` });
});
