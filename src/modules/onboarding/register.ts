/**
 * Plain-language layer — rewrites any applicant-facing text to ~5th-grade, warm copy
 * before it is spoken or sent, so non-technical, stressed people aren't tripped by
 * jargon. Ports the proven approach in battlestation/scripts/lib_register.py (grade
 * target + measure + skip-if-already-plain) onto the Anthropic SDK already used by
 * housing-qa. Cached in-process by source text so we never re-pay for the same line.
 *
 * Best-effort by contract: on a missing key, error, or disable flag it returns the
 * input unchanged — it must NEVER block a question, nudge, or send.
 */
import Anthropic from "@anthropic-ai/sdk";
import { logger } from "../../utils/logger";

const TARGET_GRADE = 5;
const MODEL = process.env.REGISTER_MODEL || "claude-haiku-4-5-20251001";

const cache = new Map<string, string>();
let client: Anthropic | null = null;

function getClient(): Anthropic | null {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  if (!client) client = new Anthropic({ apiKey: key });
  return client;
}

// Flesch–Kincaid grade level — cheap local measure so we only call the model when copy
// is actually too hard (most of our base copy is already plain and skips the call).
function syllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!w) return 0;
  const groups = w.replace(/e$/, "").match(/[aeiouy]+/g);
  return Math.max(1, groups ? groups.length : 1);
}

export function gradeLevel(text: string): number {
  const sentences = (text.match(/[.!?]+/g) || []).length || 1;
  const words = text.match(/\b[\w']+\b/g) || [];
  const wc = words.length || 1;
  const syl = words.reduce((n, w) => n + syllables(w), 0);
  return 0.39 * (wc / sentences) + 11.8 * (syl / wc) - 15.59;
}

const SYSTEM = `You rewrite text for adults who read at about a 5th-grade level and may be stressed and not tech-savvy. Rules:
- Everyday words. Short sentences. One idea per sentence.
- Warm and plain, like a helpful person talking — not a form.
- Keep ALL names, dates, numbers, and dollar amounts exactly as written.
- Never invent facts or add new requirements.
- Return ONLY the rewritten text, nothing else.`;

/**
 * Rewrite `text` to plain, grade-5 language. Returns the original on any failure.
 */
export async function register(text: string): Promise<string> {
  const src = (text || "").trim();
  if (!src) return src;
  if (process.env.ONBOARDING_REGISTER_DISABLED === "true") return src;

  const cached = cache.get(src);
  if (cached !== undefined) return cached;

  // Already plain enough — skip the model call entirely.
  if (gradeLevel(src) <= TARGET_GRADE + 0.5) {
    cache.set(src, src);
    return src;
  }

  const c = getClient();
  if (!c) return src;

  try {
    const msg = await c.messages.create({
      model: MODEL,
      max_tokens: 400,
      system: SYSTEM,
      messages: [{ role: "user", content: `Rewrite this at a 5th-grade level:\n\n${src}` }],
    });
    const out = msg.content
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("")
      .trim();
    const result = out || src;
    cache.set(src, result);
    return result;
  } catch (err) {
    logger.warn("register rewrite failed; using original", { error: (err as Error).message });
    return src;
  }
}

/** Convenience: rewrite many lines concurrently (best-effort each). */
export async function registerAll(texts: string[]): Promise<string[]> {
  return Promise.all(texts.map((t) => register(t)));
}
