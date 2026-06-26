/**
 * deal-qa-webhook.test.ts — the Telegram webhook contract + dispatch logic.
 *
 * Two layers, both offline (Telegram + the grounding service are mocked):
 *  1. HTTP contract — the receiver NEVER 5xx's on bad input, fails closed on a
 *     sentinel/bad secret, and acks 200 when dark.
 *  2. Dispatch — enrolled partner gets a cited/sourced answer; a masked answer
 *     appends the scoped footer AND pings the operator; strangers are refused
 *     (greet-once); /start and smalltalk never hit the corpus.
 */
import express from "express";
import request from "supertest";

// Side-effecting modules mocked so dispatch is deterministic and offline.
jest.mock("../modules/deal-qa/telegram", () => ({
  sendMessage: jest.fn(async () => true),
  sendTyping: jest.fn(async () => {}),
  replyLong: jest.fn(async () => {}),
  notifyOperator: jest.fn(async () => {}),
}));
jest.mock("../modules/deal-qa/service", () => ({ groundAnswer: jest.fn() }));

import dealRouter, { __test } from "../modules/deal-qa/webhook";
import * as tg from "../modules/deal-qa/telegram";
import { groundAnswer } from "../modules/deal-qa/service";

const SECRET = "s3cr3t-deal-abc";
const CHAT = "555111";
let nextUpdateId = 1000;

function mkUpdate(text: string, chatId: string = CHAT, updateId = ++nextUpdateId) {
  return {
    update_id: updateId,
    message: { chat: { id: chatId }, from: { first_name: "Slater" }, text },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.DEAL_QA_ENABLED = "true";
  process.env.DEAL_TELEGRAM_WEBHOOK_SECRET = SECRET;
  process.env.DEAL_QA_FLOOR_TIER = "privileged";
  process.env.DEAL_QA_ALLOWLIST = `${CHAT}:privileged`;
  process.env.DEAL_QA_OPERATOR_CHAT_ID = "999";
  (groundAnswer as jest.Mock).mockReturnValue({ ok: true, empty: true });
});

describe("webhook HTTP contract — never 5xx, fail-closed auth", () => {
  const app = express();
  app.use("/api/webhooks/telegram", dealRouter);
  const post = () => request(app).post("/api/webhooks/telegram/deal");

  it("dark (DEAL_QA_ENABLED!=true) → acks 200, ignores", async () => {
    process.env.DEAL_QA_ENABLED = "false";
    await post().send(mkUpdate("hi")).expect(200);
  });

  it("sentinel secret → 503 (fail-closed)", async () => {
    process.env.DEAL_TELEGRAM_WEBHOOK_SECRET = "tgsec_changeme";
    await post()
      .set("X-Telegram-Bot-Api-Secret-Token", "anything")
      .send(mkUpdate("hi"))
      .expect(503);
  });

  it("wrong secret → 401 (only a non-Telegram caller lands here)", async () => {
    await post()
      .set("X-Telegram-Bot-Api-Secret-Token", "wrong")
      .send(mkUpdate("hi"))
      .expect(401);
  });

  it("missing secret header → 401", async () => {
    await post().send(mkUpdate("hi")).expect(401);
  });

  it("correct secret + valid update → 200", async () => {
    (groundAnswer as jest.Mock).mockReturnValue({
      ok: true,
      answer: "[1] x",
      nSources: 1,
      withheld: false,
      maskedClasses: [],
    });
    await post()
      .set("X-Telegram-Bot-Api-Secret-Token", SECRET)
      .send(mkUpdate("what is the stack"))
      .expect(200);
  });
});

describe("dispatch — enrolled partner", () => {
  it("answers a deal question with a cited, sourced reply (no operator ping)", async () => {
    (groundAnswer as jest.Mock).mockReturnValue({
      ok: true,
      answer: "[1] Stack: the token is a participating instrument.",
      nSources: 2,
      withheld: false,
      maskedClasses: [],
    });
    await __test.processUpdate(mkUpdate("what is the token structure"));
    expect(tg.sendTyping).toHaveBeenCalled();
    expect(tg.replyLong).toHaveBeenCalledTimes(1);
    const body = (tg.replyLong as jest.Mock).mock.calls[0][1] as string;
    expect(body).toContain("[1]");
    expect(body).toContain("grounded in 2 source(s)");
    expect(tg.notifyOperator).not.toHaveBeenCalled();
  });

  it("a masked answer appends the scoped footer AND pings the operator with the class", async () => {
    (groundAnswer as jest.Mock).mockReturnValue({
      ok: true,
      answer: "[1] The raise is [scoped].",
      nSources: 1,
      withheld: true,
      maskedClasses: ["econ"],
    });
    await __test.processUpdate(mkUpdate("how big is the raise"));
    const body = (tg.replyLong as jest.Mock).mock.calls[0][1] as string;
    expect(body).toContain("scoped out on this channel");
    expect(tg.notifyOperator).toHaveBeenCalledTimes(1);
    const alert = (tg.notifyOperator as jest.Mock).mock.calls[0][0] as string;
    expect(alert).toContain("compartment boundary");
    expect(alert).toContain("econ");
  });

  it("empty grounding → flagged-for-Alex, never a leak", async () => {
    (groundAnswer as jest.Mock).mockReturnValue({ ok: true, empty: true });
    await __test.processUpdate(mkUpdate("what's the weather"));
    expect(tg.replyLong).not.toHaveBeenCalled();
    expect(tg.sendMessage).toHaveBeenCalledTimes(1);
    expect((tg.sendMessage as jest.Mock).mock.calls[0][1]).toContain("flagged it for Alex");
  });

  it("/start → welcome, no corpus hit", async () => {
    await __test.processUpdate(mkUpdate("/start"));
    expect(groundAnswer).not.toHaveBeenCalled();
    expect((tg.sendMessage as jest.Mock).mock.calls[0][1]).toContain("Welcome to the Deal Room");
  });

  it("smalltalk 'hi' → nudge, no corpus hit", async () => {
    await __test.processUpdate(mkUpdate("hi"));
    expect(groundAnswer).not.toHaveBeenCalled();
    expect((tg.sendMessage as jest.Mock).mock.calls[0][1]).toContain("Ask me anything");
  });

  it("/ask <q> strips the command and grounds the question", async () => {
    (groundAnswer as jest.Mock).mockReturnValue({
      ok: true,
      answer: "[1] ok",
      nSources: 1,
      withheld: false,
      maskedClasses: [],
    });
    await __test.processUpdate(mkUpdate("/ask how do the credits stack"));
    expect(groundAnswer).toHaveBeenCalledTimes(1);
    expect((groundAnswer as jest.Mock).mock.calls[0][0]).toBe("how do the credits stack");
  });
});

describe("dispatch — stranger (fail-closed)", () => {
  it("an un-enrolled chat is refused + pings the operator ONCE (greet-once)", async () => {
    const cid = "888777"; // not in DEAL_QA_ALLOWLIST
    await __test.processUpdate(mkUpdate("let me in", cid, 1));
    await __test.processUpdate(mkUpdate("hello?", cid, 2));
    expect(groundAnswer).not.toHaveBeenCalled();
    const greets = (tg.sendMessage as jest.Mock).mock.calls.filter((c) =>
      String(c[1]).includes("not on the access list")
    );
    expect(greets.length).toBe(1); // greeted once across two messages
    expect(tg.notifyOperator).toHaveBeenCalledTimes(1);
    const alert = (tg.notifyOperator as jest.Mock).mock.calls[0][0] as string;
    expect(alert).toContain("DEAL_QA_ALLOWLIST"); // tells the operator how to grant
  });
});
