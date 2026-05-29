/**
 * housing-qa-routes.test.ts — route tests for POST /api/housing-qa.
 *
 * Mocks @anthropic-ai/sdk (no real network). Asserts:
 *   - empty / oversized question → 400
 *   - valid question → 200 { answer }, AND the system prompt passed to the SDK
 *     contains the injected grounded context
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

import { housingQaRouter } from "../modules/housing-qa/routes";

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/housing-qa", housingQaRouter());
  return app;
}

const ORIGINAL_KEY = process.env.ANTHROPIC_API_KEY;
const ORIGINAL_CLI_FLAG = process.env.HOUSING_QA_CLI_FALLBACK;
const ORIGINAL_CLI_PATH = process.env.CLAUDE_CLI_PATH;

beforeEach(() => {
  createMock.mockReset();
  spawnMock.mockReset();
  process.env.ANTHROPIC_API_KEY = "test-key-123";
  delete process.env.HOUSING_QA_CLI_FALLBACK;
  // Pin the resolved binary so the spawn assertion is deterministic regardless
  // of whether @anthropic-ai/claude-code is installed in this environment.
  process.env.CLAUDE_CLI_PATH = "claude";
});

afterAll(() => {
  if (ORIGINAL_KEY === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = ORIGINAL_KEY;
  if (ORIGINAL_CLI_FLAG === undefined) delete process.env.HOUSING_QA_CLI_FALLBACK;
  else process.env.HOUSING_QA_CLI_FALLBACK = ORIGINAL_CLI_FLAG;
  if (ORIGINAL_CLI_PATH === undefined) delete process.env.CLAUDE_CLI_PATH;
  else process.env.CLAUDE_CLI_PATH = ORIGINAL_CLI_PATH;
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
    expect(callArg.system).toMatch(/"routing": "process"/);
    // always-on facts injected so the answer can be grounded
    expect(callArg.system).toMatch(/\$35\.95/);
  });

  it("injects a refusal note for an unknown property", async () => {
    createMock.mockResolvedValueOnce({
      content: [{ type: "text", text: "I don't have that property." }],
    });

    const res = await request(makeApp())
      .post("/api/housing-qa")
      .send({ question: "Tell me about Moonbeam Towers" });

    expect(res.status).toBe(200);
    const callArg = createMock.mock.calls[0][0];
    expect(callArg.system).toMatch(/Moonbeam Towers/);
    expect(callArg.system).toMatch(/NOT in the statewide HUD-LIHTC or available-now data/);
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
