import { webSearchHandler } from "../modules/voice-intake/web-search";
import type { ToolCallbackContext } from "../modules/voice-intake/tool-callbacks";

const ctx: ToolCallbackContext = {
  agentId: "agent_test",
  conversationId: "conv_test",
  toolCallId: "tc_test",
  toolName: "web_search",
};

describe("web_search voice tool", () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
    delete process.env.TAVILY_API_KEY;
    jest.clearAllMocks();
  });

  it("returns ok:false when the query is missing", async () => {
    process.env.TAVILY_API_KEY = "tvly-test";
    const r = await webSearchHandler({}, ctx);
    expect(r.ok).toBe(false);
  });

  it("fails soft (offers to follow up) when TAVILY_API_KEY is unset", async () => {
    delete process.env.TAVILY_API_KEY;
    const r = await webSearchHandler({ query: "what bus serves 1700 E Charleston" }, ctx);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/follow up/i);
  });

  it("returns a short cited answer on a Tavily hit", async () => {
    process.env.TAVILY_API_KEY = "tvly-test";
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        answer: "RTC route 109 serves that address.",
        results: [
          { title: "RTC Transit", url: "https://rtc.example/109" },
          { title: "Transit App", url: "https://transit.example" },
        ],
      }),
    }) as unknown as typeof fetch;
    const r = await webSearchHandler(
      { query: "what bus serves 1700 E Charleston" },
      ctx
    );
    expect(r.ok).toBe(true);
    expect(r.message).toContain("route 109");
    expect((r.result as { sources?: unknown[] })?.sources).toHaveLength(2);
  });

  it("fails soft on a Tavily non-2xx response", async () => {
    process.env.TAVILY_API_KEY = "tvly-test";
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({}),
    }) as unknown as typeof fetch;
    const r = await webSearchHandler({ query: "anything" }, ctx);
    expect(r.ok).toBe(false);
  });

  it("fails soft when Tavily returns no synthesized answer", async () => {
    process.env.TAVILY_API_KEY = "tvly-test";
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ answer: "", results: [] }),
    }) as unknown as typeof fetch;
    const r = await webSearchHandler({ query: "anything" }, ctx);
    expect(r.ok).toBe(false);
  });
});
