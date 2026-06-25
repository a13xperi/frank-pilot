import { logger } from "../../utils/logger";
import {
  registerToolHandler,
  type ToolCallbackContext,
  type ToolCallbackResult,
} from "./tool-callbacks";

/**
 * Voice tool: `web_search`.
 *
 * When a caller asks Frank something he does not have in front of him and that
 * lives on the open web (bus / transit routes near a property, the nearest
 * grocery, area facts), ElevenLabs fires this tool with `{ query }`. We run a
 * Tavily web search (include_answer) and hand back a SHORT, cited answer for
 * Frank to read aloud.
 *
 * Read-only and side-effect-free: it never sends, books, or mutates anything,
 * so it is safe to auto-approve in-call without tripping the never-send gate.
 *
 * This is the current-plan substitute for EL native MCP, which is gated OFF on
 * our workspace (can_use_mcp_servers=false). It mirrors the battlestation
 * grounding primitive scripts/frank-research.py. DARK without TAVILY_API_KEY:
 * it fails soft ("I can find out and follow up") so a missing key never breaks
 * a call. Requires Node 18+ (global fetch).
 *
 * Returns ToolCallbackResult:
 *   - { ok: true,  result: { answer, sources }, message } → Frank reads `message`
 *   - { ok: false, message }                              → Frank apologizes / offers to follow up
 */

const TAVILY_URL = "https://api.tavily.com/search";
const MAX_ANSWER_CHARS = 600; // short enough to speak on a live call

function pickString(params: Record<string, unknown>, key: string): string | undefined {
  const v = params[key];
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

interface TavilyResult {
  title?: string;
  url?: string;
}
interface TavilyResponse {
  answer?: string;
  results?: TavilyResult[];
}

export async function webSearchHandler(
  parameters: Record<string, unknown>,
  context: ToolCallbackContext
): Promise<ToolCallbackResult> {
  const queryText =
    pickString(parameters, "query") ?? pickString(parameters, "question");
  if (!queryText) {
    return {
      ok: false,
      message: "I didn't catch what to look up. What would you like me to find?",
    };
  }

  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) {
    logger.warn("web_search disabled: TAVILY_API_KEY not set", {
      conversationId: context.conversationId,
    });
    return {
      ok: false,
      message:
        "I can't look that up on the call right now, but I can find out and follow up with you.",
    };
  }

  let data: TavilyResponse;
  try {
    const resp = await fetch(TAVILY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: apiKey,
        query: queryText,
        include_answer: true,
        max_results: 5,
        search_depth: "basic", // basic = faster; right tradeoff for a live call
      }),
    });
    if (!resp.ok) {
      logger.error("web_search Tavily non-2xx", {
        status: resp.status,
        conversationId: context.conversationId,
      });
      return {
        ok: false,
        message:
          "I had trouble looking that up just now. I can find out and follow up with you.",
      };
    }
    data = (await resp.json()) as TavilyResponse;
  } catch (err) {
    logger.error("web_search Tavily threw", {
      error: (err as Error).message,
      conversationId: context.conversationId,
    });
    return {
      ok: false,
      message:
        "I couldn't reach my search just now. I can look into it and get back to you.",
    };
  }

  const answer = (data.answer ?? "").trim().slice(0, MAX_ANSWER_CHARS);
  const sources = (data.results ?? [])
    .filter((r) => r.url)
    .slice(0, 3)
    .map((r) => ({ title: r.title ?? "", url: r.url as string }));

  if (!answer) {
    return {
      ok: false,
      message:
        "I looked but couldn't find a clear answer. I can dig into it and follow up with you.",
    };
  }

  return {
    ok: true,
    result: { answer, sources },
    message: answer,
  };
}

/**
 * Wire-up (call once at boot, alongside the other voice tool handlers). NOT yet
 * invoked anywhere — adding the call in src/index.ts is the deliberate, gated
 * step that turns this on. Until then the tool is inert (unregistered), so the
 * dispatcher returns "Tool not yet implemented" if the agent ever fires it.
 */
export function registerWebSearchHandler(): void {
  registerToolHandler("web_search", webSearchHandler);
}
