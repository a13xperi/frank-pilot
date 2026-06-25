/**
 * Research worker — the middle of the Frank loop ("ask -> capture -> RESEARCH -> deliver").
 *
 * Claims one follow_up with research_status='needs_research', grounds an answer
 * (our property data + Anthropic's web_search for external facts like transit/
 * utilities), and writes it back as 'ready_for_review' for human approval before
 * the dialer delivers it. Strict anti-fabrication: the model is told to never
 * invent specifics it can't source, and to mark low confidence when unsure — so a
 * weak answer is caught at review, never spoken as fact (the conv_2301 lesson).
 *
 * Dark until FRANK_RESEARCH_ENABLED=true. Reuses the Anthropic client pattern from
 * src/modules/housing-qa/routes.ts (ANTHROPIC_API_KEY).
 */
import Anthropic from "@anthropic-ai/sdk";
import { query } from "../../config/database";
import { logger } from "../../utils/logger";
import { claimNextResearchTask, writeResearchAnswer } from "./service";

const MODEL = "claude-haiku-4-5-20251001";

let cachedClient: Anthropic | null = null;
function getClient(): Anthropic | null {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  if (!cachedClient) cachedClient = new Anthropic({ apiKey: key });
  return cachedClient;
}

/** Internal grounding: the properties we manage (so "near Donna Louise" resolves). */
async function gatherContext(): Promise<string> {
  try {
    const res = await query(
      `SELECT name, address, city, state FROM properties ORDER BY name LIMIT 40`
    );
    if (!res.rows.length) return "";
    return (
      "Our managed properties (name | address | city):\n" +
      res.rows
        .map((r) => `- ${r.name} | ${r.address ?? ""} | ${r.city ?? ""} ${r.state ?? ""}`.trim())
        .join("\n")
    );
  } catch {
    return ""; // table/columns may differ in some envs — degrade to web-only research
  }
}

export interface ResearchAnswer {
  answer: string;
  source: string;
  confidence: "high" | "medium" | "low";
}

/**
 * One tick: claim a needs_research follow_up, research a grounded answer, write it
 * back. Concurrency 1 (one claim per tick) to respect the org rate limit. Returns
 * a small status object (mirrors runFollowupTick) for the scheduler to log.
 */
export async function runResearchTick(): Promise<{ action: string; id?: string }> {
  if (process.env.FRANK_RESEARCH_ENABLED !== "true") return { action: "disabled" };
  const client = getClient();
  if (!client) {
    logger.warn("research worker: ANTHROPIC_API_KEY not set");
    return { action: "no_key" };
  }
  const task = await claimNextResearchTask();
  if (!task) return { action: "queue_empty" };

  const q = (task.question || task.checkpoint || "").trim();
  if (!q) {
    await writeResearchAnswer(task.id, "", "no question text captured", "failed");
    return { action: "failed", id: task.id };
  }

  const system =
    "You are a research assistant for Frank, a Las Vegas affordable-housing voice agent. " +
    "Find an ACCURATE, CONCISE answer to the caller's question that Frank can read back on a " +
    "callback. Ground every claim and cite the source. Use web search for external facts " +
    "(bus/transit routes, utilities, civic info). NEVER invent specifics (route numbers, prices, " +
    "schedules) you cannot source — if you cannot verify it, say so and set confidence to low. " +
    'Reply with ONLY a JSON object: {"answer": <1-3 spoken-friendly sentences>, "source": ' +
    '<where it came from>, "confidence": "high"|"medium"|"low"}.';

  try {
    const ctx = await gatherContext();
    const completion = await client.messages.create({
      model: MODEL,
      max_tokens: 800,
      system,
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 4 } as unknown as Anthropic.Tool],
      messages: [
        {
          role: "user",
          content: `Caller's question: ${q}\n\nInternal context we have:\n${ctx || "(none)"}`,
        },
      ],
    });
    const text = completion.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
    const json = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
    const parsed = JSON.parse(json) as ResearchAnswer;
    if (!parsed.answer) throw new Error("model returned no answer");
    await writeResearchAnswer(
      task.id,
      parsed.answer,
      `${parsed.source} [confidence: ${parsed.confidence}]`,
      "ready_for_review"
    );
    logger.info("research answered", { id: task.id, confidence: parsed.confidence });
    return { action: "answered", id: task.id };
  } catch (err) {
    logger.error("research worker failed", { id: task.id, error: (err as Error).message });
    // leave it failed (not back to needs_research) so a bad row doesn't hot-loop;
    // an operator can requeue.
    await writeResearchAnswer(task.id, "", `research failed: ${(err as Error).message}`, "failed");
    return { action: "failed", id: task.id };
  }
}
