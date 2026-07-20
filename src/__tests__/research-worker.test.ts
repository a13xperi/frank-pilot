/**
 * Research worker — the middle of the Frank loop. Mocks the Anthropic SDK + the
 * service layer so we test the orchestration (claim -> ground -> write back) and
 * the gates (flag off, no key, empty queue, model failure) without a real call.
 */

const mockCreate = jest.fn();
jest.mock("@anthropic-ai/sdk", () => ({
  __esModule: true,
  default: class {
    messages = { create: (...a: unknown[]) => mockCreate(...a) };
  },
}));

const mockClaim = jest.fn();
const mockWrite = jest.fn();
jest.mock("../modules/follow-ups/service", () => ({
  claimNextResearchTask: () => mockClaim(),
  writeResearchAnswer: (...a: unknown[]) => mockWrite(...a),
}));
jest.mock("../config/database", () => ({ query: jest.fn().mockResolvedValue({ rows: [] }) }));
jest.mock("../utils/logger", () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));

import { runResearchTick } from "../modules/follow-ups/research-worker";

const TASK = { id: "fu-1", phone_e164: "+17025551234", reason: "callback_requested", question: "RTC route Donna Louise to Aliante", checkpoint: null };

beforeEach(() => {
  jest.clearAllMocks();
  process.env.FRANK_RESEARCH_ENABLED = "true";
  process.env.ANTHROPIC_API_KEY = "sk-test";
});

it("no-op (disabled) when the flag is off", async () => {
  delete process.env.FRANK_RESEARCH_ENABLED;
  const r = await runResearchTick();
  expect(r.action).toBe("disabled");
  expect(mockClaim).not.toHaveBeenCalled();
});

it("no-op (no_key) without ANTHROPIC_API_KEY", async () => {
  delete process.env.ANTHROPIC_API_KEY;
  const r = await runResearchTick();
  expect(r.action).toBe("no_key");
  expect(mockClaim).not.toHaveBeenCalled();
});

it("queue_empty when nothing is queued", async () => {
  mockClaim.mockResolvedValueOnce(null);
  const r = await runResearchTick();
  expect(r.action).toBe("queue_empty");
});

it("grounds an answer and writes it ready_for_review", async () => {
  mockClaim.mockResolvedValueOnce(TASK);
  mockCreate.mockResolvedValueOnce({
    content: [{ type: "text", text: '{"answer":"RTC Route 215 connects the area.","source":"rtcsnv.com","confidence":"high"}' }],
  });
  const r = await runResearchTick();
  expect(r.action).toBe("answered");
  expect(mockWrite).toHaveBeenCalledTimes(1);
  const [id, answer, source, status] = mockWrite.mock.calls[0];
  expect(id).toBe("fu-1");
  expect(answer).toMatch(/RTC Route 215/);
  expect(source).toMatch(/confidence: high/);
  expect(status).toBe("ready_for_review");
});

it("marks failed (not requeued) when the model errors", async () => {
  mockClaim.mockResolvedValueOnce(TASK);
  mockCreate.mockRejectedValueOnce(new Error("rate limited"));
  const r = await runResearchTick();
  expect(r.action).toBe("failed");
  expect(mockWrite.mock.calls[0][3]).toBe("failed");
});

it("strips ```json fences before parsing", async () => {
  mockClaim.mockResolvedValueOnce(TASK);
  mockCreate.mockResolvedValueOnce({
    content: [{ type: "text", text: '```json\n{"answer":"Yes, served by RTC.","source":"rtcsnv.com","confidence":"medium"}\n```' }],
  });
  const r = await runResearchTick();
  expect(r.action).toBe("answered");
  expect(mockWrite.mock.calls[0][1]).toMatch(/served by RTC/);
});

it("auto-approves a HIGH-confidence answer when FRANK_RESEARCH_AUTO_APPROVE=true", async () => {
  process.env.FRANK_RESEARCH_AUTO_APPROVE = "true";
  mockClaim.mockResolvedValueOnce(TASK);
  mockCreate.mockResolvedValueOnce({
    content: [{ type: "text", text: '{"answer":"RTC Route 215.","source":"rtcsnv.com","confidence":"high"}' }],
  });
  const r = await runResearchTick();
  expect(r.action).toBe("auto_approved");
  expect(mockWrite.mock.calls[0][3]).toBe("approved"); // skips review
  delete process.env.FRANK_RESEARCH_AUTO_APPROVE;
});

it("a medium-confidence answer still queues for review even with auto-approve on", async () => {
  process.env.FRANK_RESEARCH_AUTO_APPROVE = "true";
  mockClaim.mockResolvedValueOnce(TASK);
  mockCreate.mockResolvedValueOnce({
    content: [{ type: "text", text: '{"answer":"Probably RTC.","source":"web","confidence":"medium"}' }],
  });
  const r = await runResearchTick();
  expect(r.action).toBe("answered");
  expect(mockWrite.mock.calls[0][3]).toBe("ready_for_review");
  delete process.env.FRANK_RESEARCH_AUTO_APPROVE;
});
