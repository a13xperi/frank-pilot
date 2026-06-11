/**
 * housing-qa-routes.test.ts — route tests for POST /api/housing-qa.
 *
 * Mocks @anthropic-ai/sdk (no real network). The app mounts the router
 * exactly as prod does — surface: tenant_public — so these tests also pin the
 * tenant data-scoping contract at the HTTP boundary. Asserts:
 *   - empty / oversized question → 400
 *   - valid question → 200 { answer }, AND the system prompt passed to the SDK
 *     contains the injected grounded context — and NO property data, dataset
 *     names, or echoed question (tenant scope)
 *   - internal language in a model answer → replaced by the safe fallback
 *   - missing ANTHROPIC_API_KEY → 503 (clean, no crash)
 */
import express from "express";
import request from "supertest";

// Capture the system prompt the route passes to the SDK so we can assert the
// grounded context is injected.
const createMock = jest.fn();

jest.mock("@anthropic-ai/sdk", () => {
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
      messages: { create: createMock },
    })),
  };
});

jest.mock("../utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

// Mock child_process so the CLI-fallback path never spawns a real `claude`.
const spawnMock = jest.fn();
jest.mock("child_process", () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
}));

import { EventEmitter } from "events";

// Build a fake ChildProcess that emits `stdout` then `close` on next tick.
function fakeChild(stdout: string, code = 0) {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: jest.Mock;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = jest.fn();
  setImmediate(() => {
    if (stdout) child.stdout.emit("data", Buffer.from(stdout));
    child.emit("close", code);
  });
  return child;
}

import {
  housingQaRouter,
  setHousingQaDisabled,
  housingQaStatus,
} from "../modules/housing-qa/routes";
import { SAFE_FALLBACK_ANSWER } from "../modules/housing-qa/output-guard";
import { logger } from "../utils/logger";

function makeApp() {
  const app = express();
  app.use(express.json());
  // Mounted exactly as prod (src/index.ts): the public tenant surface.
  app.use("/api/housing-qa", housingQaRouter({ surface: "tenant_public" }));
  return app;
}

const ORIGINAL_KEY = process.env.ANTHROPIC_API_KEY;
const ORIGINAL_CLI_FLAG = process.env.HOUSING_QA_CLI_FALLBACK;
const ORIGINAL_CLI_PATH = process.env.CLAUDE_CLI_PATH;
const ORIGINAL_ENABLED = process.env.HOUSING_QA_ENABLED;
const ORIGINAL_DAILY_MAX = process.env.HOUSING_QA_DAILY_MAX;
const ORIGINAL_DAILY_BUDGET = process.env.HOUSING_QA_DAILY_BUDGET_USD;

beforeEach(() => {
  createMock.mockReset();
  spawnMock.mockReset();
  (logger.info as jest.Mock).mockReset();
  (logger.warn as jest.Mock).mockReset();
  process.env.ANTHROPIC_API_KEY = "test-key-123";
  delete process.env.HOUSING_QA_CLI_FALLBACK;
  // Guardrails default to ON / default cap for every test unless it opts in.
  delete process.env.HOUSING_QA_ENABLED;
  delete process.env.HOUSING_QA_DAILY_MAX;
  delete process.env.HOUSING_QA_DAILY_BUDGET_USD;
  setHousingQaDisabled(false);
  // Pin the resolved binary so the spawn assertion is deterministic regardless
  // of whether @anthropic-ai/claude-code is installed in this environment.
  process.env.CLAUDE_CLI_PATH = "claude";
});

function restoreEnv(key: string, original: string | undefined) {
  if (original === undefined) delete process.env[key];
  else process.env[key] = original;
}

afterAll(() => {
  restoreEnv("ANTHROPIC_API_KEY", ORIGINAL_KEY);
  restoreEnv("HOUSING_QA_CLI_FALLBACK", ORIGINAL_CLI_FLAG);
  restoreEnv("CLAUDE_CLI_PATH", ORIGINAL_CLI_PATH);
  restoreEnv("HOUSING_QA_ENABLED", ORIGINAL_ENABLED);
  restoreEnv("HOUSING_QA_DAILY_MAX", ORIGINAL_DAILY_MAX);
  restoreEnv("HOUSING_QA_DAILY_BUDGET_USD", ORIGINAL_DAILY_BUDGET);
  setHousingQaDisabled(false);
});

describe("POST /api/housing-qa — validation", () => {
  it("rejects an empty question with 400", async () => {
    const res = await request(makeApp())
      .post("/api/housing-qa")
      .send({ question: "" });
    expect(res.status).toBe(400);
    expect(createMock).not.toHaveBeenCalled();
  });

  it("rejects a missing question body with 400", async () => {
    const res = await request(makeApp()).post("/api/housing-qa").send({});
    expect(res.status).toBe(400);
    expect(createMock).not.toHaveBeenCalled();
  });

  it("rejects an oversized question (>1000 chars) with 400", async () => {
    const res = await request(makeApp())
      .post("/api/housing-qa")
      .send({ question: "a".repeat(1001) });
    expect(res.status).toBe(400);
    expect(createMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/housing-qa — grounded answer", () => {
  it("returns 200 { answer } and injects grounded context into the system prompt", async () => {
    createMock.mockResolvedValueOnce({
      content: [{ type: "text", text: "The application fee is $35.95 per adult." }],
    });

    const res = await request(makeApp())
      .post("/api/housing-qa")
      .send({ question: "How much is the application fee?" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      answer: "The application fee is $35.95 per adult.",
    });

    expect(createMock).toHaveBeenCalledTimes(1);
    const callArg = createMock.mock.calls[0][0];
    // model + user message wired correctly
    expect(callArg.model).toContain("haiku");
    expect(callArg.messages).toEqual([
      { role: "user", content: "How much is the application fee?" },
    ]);
    // The system prompt must carry the guardrails AND the injected context.
    expect(callArg.system).toMatch(/GROUNDING RULES \(non-negotiable\)/);
    expect(callArg.system).toMatch(/BEGIN CONTEXT/);
    // tenant surface: the payload is the tenant shape — scope marker present,
    // retrieval metadata (routing/properties keys) absent entirely
    expect(callArg.system).toMatch(/"scope": "tenant"/);
    expect(callArg.system).not.toMatch(/"routing"/);
    // always-on facts injected so the answer can be grounded
    expect(callArg.system).toMatch(/\$35\.95/);
  });

  it("'test' (the demo-leak repro) injects NO statewide property data", async () => {
    createMock.mockResolvedValueOnce({
      content: [{ type: "text", text: "Could you tell me more about what you need?" }],
    });

    const res = await request(makeApp())
      .post("/api/housing-qa")
      .send({ question: "test" });

    expect(res.status).toBe(200);
    const callArg = createMock.mock.calls[0][0];
    // The leak: "test" fuzzy-matched "Test Property, Carson City" out of the
    // statewide dataset. None of that may reach the system prompt now.
    expect(callArg.system).not.toMatch(/Test Property/i);
    expect(callArg.system).not.toMatch(/Carson City/i);
    expect(callArg.system).not.toMatch(/HUD[\s-]LIHTC|GPMG|statewide/i);
    // Stronger than the old `"properties": []` pin: the key no longer exists
    // on this surface at all.
    expect(callArg.system).not.toMatch(/"properties"/);
  });

  it("a named-property question injects no property record and no echo of the name", async () => {
    createMock.mockResolvedValueOnce({
      content: [{ type: "text", text: "I can't look up specific properties here." }],
    });

    const res = await request(makeApp())
      .post("/api/housing-qa")
      .send({ question: "Tell me about Moonbeam Towers" });

    expect(res.status).toBe(200);
    const callArg = createMock.mock.calls[0][0];
    // tenant scope: the question reaches the model ONLY as the user message —
    // never echoed into the system prompt (injection surface), and no
    // dataset-naming refusal note is generated.
    expect(callArg.system).not.toMatch(/Moonbeam Towers/);
    expect(callArg.system).not.toMatch(/statewide|HUD[\s-]LIHTC|\/discover/i);
    expect(callArg.messages[0].content).toBe("Tell me about Moonbeam Towers");
  });

  it("returns 502 when the model call throws", async () => {
    createMock.mockRejectedValueOnce(new Error("upstream boom"));
    const res = await request(makeApp())
      .post("/api/housing-qa")
      .send({ question: "How much is the fee?" });
    expect(res.status).toBe(502);
    expect(res.body.error).toBeDefined();
    // the raw upstream error is never echoed to the client
    expect(JSON.stringify(res.body)).not.toMatch(/upstream boom/);
  });
});

describe("POST /api/housing-qa — internal-language output guard", () => {
  it("replaces an answer carrying internal pipeline language with the safe fallback", async () => {
    // Prompt drift simulation: the model answers with the exact language that
    // leaked in the 2026-06 demo. The response boundary must catch it.
    createMock.mockResolvedValueOnce({
      content: [
        {
          type: "text",
          text: "Open the Frank-Pilot application and go to the Pick step — that property is in the statewide HUD-LIHTC dataset.",
        },
      ],
    });

    const res = await request(makeApp())
      .post("/api/housing-qa")
      .send({ question: "How do I find a property?" });

    expect(res.status).toBe(200);
    expect(res.body.answer).toBe(SAFE_FALLBACK_ANSWER);
    expect(JSON.stringify(res.body)).not.toMatch(/Frank-Pilot|Pick step|HUD-LIHTC/i);

    // The trip is logged with rule ids only — never the answer text.
    const warnCall = (logger.warn as jest.Mock).mock.calls.find(
      (c) => c[0] === "housing-qa output guard tripped — answer replaced"
    );
    expect(warnCall).toBeDefined();
    const meta = warnCall![1] as { surface: string; violations: string[] };
    expect(meta.surface).toBe("tenant_public");
    expect(meta.violations).toEqual(
      expect.arrayContaining(["brand-frank-pilot", "pipeline-step"])
    );
    expect(JSON.stringify(meta)).not.toMatch(/Frank-Pilot application/);

    // The success log records that the answer was guarded.
    const infoCall = (logger.info as jest.Mock).mock.calls.find(
      (c) => c[0] === "housing-qa answered"
    );
    expect((infoCall![1] as { guarded: boolean }).guarded).toBe(true);
  });

  it("clean answers pass through untouched, logged as unguarded on the tenant surface", async () => {
    createMock.mockResolvedValueOnce({
      content: [
        {
          type: "text",
          text: "SNAP benefits generally don't count as income (Tenant FAQ #63).",
        },
      ],
    });

    const res = await request(makeApp())
      .post("/api/housing-qa")
      .send({ question: "Do food stamps count as income?" });

    expect(res.status).toBe(200);
    expect(res.body.answer).toBe(
      "SNAP benefits generally don't count as income (Tenant FAQ #63)."
    );
    const infoCall = (logger.info as jest.Mock).mock.calls.find(
      (c) => c[0] === "housing-qa answered"
    );
    const meta = infoCall![1] as { surface: string; guarded: boolean };
    expect(meta.surface).toBe("tenant_public");
    expect(meta.guarded).toBe(false);
  });
});

describe("POST /api/housing-qa — missing API key", () => {
  it("returns 503 (clean) when ANTHROPIC_API_KEY is absent", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const res = await request(makeApp())
      .post("/api/housing-qa")
      .send({ question: "How much is the application fee?" });
    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/temporarily unavailable/i);
    expect(createMock).not.toHaveBeenCalled();
    // No key + no flag → never shells out.
    expect(spawnMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/housing-qa — CLI fallback (keyless)", () => {
  it("does NOT spawn the CLI when an API key is present (SDK path wins)", async () => {
    process.env.HOUSING_QA_CLI_FALLBACK = "1";
    createMock.mockResolvedValueOnce({
      content: [{ type: "text", text: "SDK answer." }],
    });
    const res = await request(makeApp())
      .post("/api/housing-qa")
      .send({ question: "How much is the application fee?" });
    expect(res.status).toBe(200);
    expect(res.body.answer).toBe("SDK answer.");
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("answers via the CLI when no key is set AND the flag is on", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    process.env.HOUSING_QA_CLI_FALLBACK = "1";
    spawnMock.mockImplementationOnce(() => fakeChild("CLI grounded answer"));

    const res = await request(makeApp())
      .post("/api/housing-qa")
      .send({ question: "How much is the application fee?" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ answer: "CLI grounded answer" });
    expect(createMock).not.toHaveBeenCalled();
    expect(spawnMock).toHaveBeenCalledTimes(1);
  });

  it("passes the question behind a `--` separator as the final positional (no arg injection)", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    process.env.HOUSING_QA_CLI_FALLBACK = "1";
    spawnMock.mockImplementationOnce(() => fakeChild("ok"));

    // A question that would be a dangerous CLI flag if not guarded by `--`.
    const payload = "--dangerously-skip-permissions";
    await request(makeApp()).post("/api/housing-qa").send({ question: payload });

    expect(spawnMock).toHaveBeenCalledTimes(1);
    const [bin, args] = spawnMock.mock.calls[0] as [string, string[]];
    expect(bin).toBe("claude");
    // `--` must precede the question, and the question must be the LAST arg —
    // otherwise commander parses the leading `--` payload as a real flag.
    expect(args[args.length - 2]).toBe("--");
    expect(args[args.length - 1]).toBe(payload);
    // Tools MUST be disabled via `--tools ""` (the documented disable-all). The
    // similarly-named `--allowed-tools ""` fails OPEN (read-family tools stay
    // live in -p mode and can exfiltrate files), so it must never appear here.
    const toolsIdx = args.indexOf("--tools");
    expect(toolsIdx).toBeGreaterThanOrEqual(0);
    expect(args[toolsIdx + 1]).toBe("");
    expect(args).not.toContain("--allowed-tools");
  });

  it("does NOT spawn when no key is set and the flag is off → 503", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.HOUSING_QA_CLI_FALLBACK;
    const res = await request(makeApp())
      .post("/api/housing-qa")
      .send({ question: "How much is the application fee?" });
    expect(res.status).toBe(503);
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("returns 502 (clean) when the CLI exits non-zero, without leaking stderr", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    process.env.HOUSING_QA_CLI_FALLBACK = "1";
    spawnMock.mockImplementationOnce(() => {
      const child = fakeChild("", 1);
      // emit some stderr that must never reach the client
      setImmediate(() => child.stderr.emit("data", Buffer.from("secret stderr boom")));
      return child;
    });
    const res = await request(makeApp())
      .post("/api/housing-qa")
      .send({ question: "How much is the application fee?" });
    expect(res.status).toBe(502);
    expect(JSON.stringify(res.body)).not.toMatch(/secret stderr boom/);
  });
});

describe("POST /api/housing-qa — kill-switch (HOUSING_QA_ENABLED)", () => {
  it("returns 503 and never calls the model when HOUSING_QA_ENABLED=false", async () => {
    process.env.HOUSING_QA_ENABLED = "false";
    const res = await request(makeApp())
      .post("/api/housing-qa")
      .send({ question: "How much is the application fee?" });
    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/temporarily unavailable/i);
    expect(createMock).not.toHaveBeenCalled();
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("the in-memory override (break-glass) 503s instantly, then re-enables", async () => {
    // Disable via the admin setter (no env change, no redeploy) → 503.
    setHousingQaDisabled(true);
    const down = await request(makeApp())
      .post("/api/housing-qa")
      .send({ question: "How much is the application fee?" });
    expect(down.status).toBe(503);
    expect(createMock).not.toHaveBeenCalled();

    // Flip it back on → normal 200.
    setHousingQaDisabled(false);
    createMock.mockResolvedValueOnce({
      content: [{ type: "text", text: "Back online." }],
    });
    const up = await request(makeApp())
      .post("/api/housing-qa")
      .send({ question: "How much is the application fee?" });
    expect(up.status).toBe(200);
    expect(up.body.answer).toBe("Back online.");
  });
});

describe("POST /api/housing-qa — daily ceiling (HOUSING_QA_DAILY_MAX)", () => {
  it("returns 503 without calling the model once the daily cap is reached", async () => {
    // 0 = block all calls for the day (the cap floor).
    process.env.HOUSING_QA_DAILY_MAX = "0";
    const res = await request(makeApp())
      .post("/api/housing-qa")
      .send({ question: "How much is the application fee?" });
    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/today's limit/i);
    expect(createMock).not.toHaveBeenCalled();
    expect(spawnMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/housing-qa — usage logging is PII-safe", () => {
  it("logs question LENGTH and route on success, never the question text", async () => {
    createMock.mockResolvedValueOnce({
      content: [{ type: "text", text: "The fee is $35.95." }],
    });
    const question = "How much is the secret-codeword application fee?";
    const res = await request(makeApp())
      .post("/api/housing-qa")
      .send({ question });
    expect(res.status).toBe(200);

    const infoCall = (logger.info as jest.Mock).mock.calls.find(
      (c) => c[0] === "housing-qa answered"
    );
    expect(infoCall).toBeDefined();
    const meta = infoCall![1] as Record<string, unknown>;
    expect(meta.qLen).toBe(question.length);
    expect(typeof meta.latencyMs).toBe("number");
    expect(meta.route).toBeDefined();
    expect(meta.path).toBe("sdk");
    // The raw question text must NEVER appear in the structured log meta.
    expect(JSON.stringify(meta)).not.toContain("secret-codeword");
  });
});

describe("POST /api/housing-qa — metered spend accounting + USD budget", () => {
  it("captures SDK usage (cache folded into input) → status + success log", async () => {
    const before = housingQaStatus();
    // 3000 base + 500 + 500 cache = 4000 input; output 1000. Choosing the cache
    // split this way keeps the est. cost a clean $0.009 while still proving the
    // fold (the asserted input delta is 4000, not the 3000 base).
    createMock.mockResolvedValueOnce({
      content: [{ type: "text", text: "Grounded answer." }],
      usage: {
        input_tokens: 3000,
        cache_creation_input_tokens: 500,
        cache_read_input_tokens: 500,
        output_tokens: 1000,
      },
    });

    const res = await request(makeApp())
      .post("/api/housing-qa")
      .send({ question: "How much is the application fee?" });
    expect(res.status).toBe(200);

    // Status reflects exactly this call's tokens (counters are exact, not rounded);
    // input delta = 4000 proves cache tokens are folded into the input total.
    const after = housingQaStatus();
    expect(after.dailyInputTokens - before.dailyInputTokens).toBe(4000);
    expect(after.dailyOutputTokens - before.dailyOutputTokens).toBe(1000);
    expect(after.dailyEstCostUsd).toBeGreaterThan(before.dailyEstCostUsd);
    expect(after.dailyBudgetUsd).toBe(10); // default

    // The success log carries token counts + an estimated cost (not PII).
    const infoCall = (logger.info as jest.Mock).mock.calls.find(
      (c) => c[0] === "housing-qa answered"
    );
    const meta = infoCall![1] as Record<string, unknown>;
    expect(meta.inputTokens).toBe(4000);
    expect(meta.outputTokens).toBe(1000);
    // 4000/1e6*$1 + 1000/1e6*$5 = $0.004 + $0.005 = $0.009
    expect(meta.estCostUsd).toBeCloseTo(0.009, 6);
  });

  it("503s the SDK path when HOUSING_QA_DAILY_BUDGET_USD=0 (cost kill-switch)", async () => {
    process.env.HOUSING_QA_DAILY_BUDGET_USD = "0";
    const res = await request(makeApp())
      .post("/api/housing-qa")
      .send({ question: "How much is the application fee?" });
    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/today's limit/i);
    // Budget gate trips BEFORE the model is dispatched.
    expect(createMock).not.toHaveBeenCalled();
  });

  it("the USD budget governs the SDK path ONLY — the priced-blind CLI still answers", async () => {
    // Budget that would block the SDK, but no key + flag on → CLI path.
    delete process.env.ANTHROPIC_API_KEY;
    process.env.HOUSING_QA_CLI_FALLBACK = "1";
    process.env.HOUSING_QA_DAILY_BUDGET_USD = "0";
    spawnMock.mockImplementationOnce(() => fakeChild("CLI answer"));

    const res = await request(makeApp())
      .post("/api/housing-qa")
      .send({ question: "How much is the application fee?" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ answer: "CLI answer" });
    expect(createMock).not.toHaveBeenCalled();
    expect(spawnMock).toHaveBeenCalledTimes(1);

    // CLI path reports no usage → token fields log as null, never throws.
    const infoCall = (logger.info as jest.Mock).mock.calls.find(
      (c) => c[0] === "housing-qa answered"
    );
    const meta = infoCall![1] as Record<string, unknown>;
    expect(meta.path).toBe("cli");
    expect(meta.inputTokens).toBeNull();
    expect(meta.outputTokens).toBeNull();
    expect(meta.estCostUsd).toBeNull();
  });
});
