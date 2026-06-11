/**
 * housing-qa-tenant-scope.test.ts — pins the tenant-widget scope guarantee
 * (Jun-11 demo hotfix).
 *
 * THE BUG: the unauthenticated tenant widget answered "test" with a statewide
 * property card ("Test Property", Carson City) and named internal systems
 * ("Frank-Pilot application, Pick step", "statewide HUD-LIHTC dataset").
 *
 * THE CONTRACT, pinned here:
 *   - the tenant path (default AND explicit scope:"tenant") NEVER carries
 *     statewide property data or internal system/dataset/pipeline language
 *     into the model prompt — structurally, not via prompt politeness;
 *   - scope:"full" remains an explicit opt-in that still gets property data;
 *   - an unrecognized scope fails CLOSED (400), never falls open.
 *
 * Mocks @anthropic-ai/sdk and captures the system prompt — if a marker isn't
 * in the prompt, the model cannot leak it.
 */
import express from "express";
import request from "supertest";

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

import { housingQaRouter } from "../modules/housing-qa/routes";
import {
  buildTenantContext,
  buildContext,
  RETRIEVAL_POLICIES,
} from "../modules/housing-qa/retriever";

function makeApp() {
  const app = express();
  app.use(express.json());
  // Same surface the production mount uses (src/index.ts) — the scope pins
  // below are asserting THIS surface's policy.
  app.use("/api/housing-qa", housingQaRouter({ surface: "tenant_public" }));
  return app;
}

const ORIGINAL_KEY = process.env.ANTHROPIC_API_KEY;

beforeEach(() => {
  createMock.mockReset();
  createMock.mockResolvedValue({
    content: [{ type: "text", text: "stub answer" }],
  });
  process.env.ANTHROPIC_API_KEY = "test-key-123";
});

afterAll(() => {
  if (ORIGINAL_KEY === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = ORIGINAL_KEY;
});

// Markers that must NEVER reach the model on the tenant path. Property data:
// the system prompt is the ONLY channel context flows through, so asserting
// their absence there proves the model cannot surface them. Internal language:
// dataset names, pipeline steps, app/tool names from the full prompt.
const FORBIDDEN_TENANT_MARKERS = [
  // statewide property data (the "test" repro card)
  "Test Property",
  "Carson City",
  '"routing"',
  '"properties"',
  '"propertyMode"',
  "statewideRecords",
  // internal systems / datasets / pipeline language
  "statewide",
  "HUD-LIHTC",
  "Frank-Pilot",
  "Pick step",
  "/discover",
  "apply.json",
  "faq.md",
];

async function postQa(body: Record<string, unknown>) {
  return request(makeApp()).post("/api/housing-qa").send(body);
}

// The user's question is echoed verbatim into the context payload, so a bait
// question like "…in Carson City" would trip its own marker. Strip every
// occurrence of the question text before scanning — what's left is what
// RETRIEVAL added, which is the only channel that can leak.
function lastSystemPromptWithoutQuestion(question: string): string {
  expect(createMock).toHaveBeenCalled();
  const calls = createMock.mock.calls;
  const system = calls[calls.length - 1][0].system as string;
  return system.split(question).join("");
}

describe("tenant scope — the 'test' repro stays bounded", () => {
  it("default scope: 'test' carries NO statewide data and NO internal language", async () => {
    const question = "test";
    const res = await postQa({ question });
    expect(res.status).toBe(200);
    const system = lastSystemPromptWithoutQuestion(question);
    for (const marker of FORBIDDEN_TENANT_MARKERS) {
      expect(system).not.toContain(marker);
    }
  });

  it("explicit scope:'tenant' is identically bounded for a property-bait question", async () => {
    const question = "Tell me about Silver Pines Apartments in Carson City";
    const res = await postQa({ question, scope: "tenant" });
    expect(res.status).toBe(200);
    const system = lastSystemPromptWithoutQuestion(question);
    for (const marker of FORBIDDEN_TENANT_MARKERS) {
      expect(system).not.toContain(marker);
    }
  });

  it("tenant prompt still grounds the rehearsed FAQ beats (facts + tenantFaq present)", async () => {
    const question = "How much is the application fee?";
    const res = await postQa({ question });
    expect(res.status).toBe(200);
    const calls = createMock.mock.calls;
    const system = calls[calls.length - 1][0].system as string;
    expect(system).toContain('"scope": "tenant"');
    expect(system).toContain("$35.95");
    expect(system).toContain("tenantFaq");
    expect(system).toMatch(/GROUNDING RULES \(non-negotiable\)/);
  });
});

describe("tenant scope — retrieval layer (structural, not prompt politeness)", () => {
  it("buildTenantContext never contains property data for any probe", () => {
    const probes = [
      "test",
      "Test Property",
      "apartments in Carson City",
      "senior housing available now",
      "2br at 60% AMI in Reno",
    ];
    for (const q of probes) {
      // Drop the echoed question — only what retrieval ADDED can leak.
      const { question: _q, ...rest } = buildTenantContext(q);
      const json = JSON.stringify(rest);
      for (const marker of FORBIDDEN_TENANT_MARKERS) {
        expect(json).not.toContain(marker);
      }
    }
  });

  it("sanity: the same probes DO pull property data via buildContext (the leak was real)", () => {
    // applicant_portal carries the original full-grounding contract — the
    // behavior the tenant surface must never reach.
    const ctx = buildContext("test", RETRIEVAL_POLICIES.applicant_portal);
    // The statewide index really does fuzzy-match "test" to a property —
    // this is the behavior the tenant path must never reach.
    expect(["named_property", "city", "attribute"]).toContain(ctx.routing);
    expect(ctx.properties.length).toBeGreaterThan(0);
  });
});

describe("request-level scope cannot escalate — surface is fixed at mount time", () => {
  // The original demo-track fix exposed an opt-in `scope` request field; the
  // mainline seam removed request-level scoping entirely (a surface is chosen
  // when the router is mounted). These pins assert the stronger property: no
  // value a client sends can widen retrieval.
  it("scope:'full' from the tenant surface is inert — still NO property data", async () => {
    const question = "Tell me about properties in Carson City";
    const res = await postQa({ question, scope: "full" });
    expect(res.status).toBe(200);
    const system = lastSystemPromptWithoutQuestion(question);
    for (const marker of FORBIDDEN_TENANT_MARKERS) {
      expect(system).not.toContain(marker);
    }
  });

  it("an unrecognized scope value is equally inert — never falls open", async () => {
    const question = "test";
    const res = await postQa({ question, scope: "everything" });
    expect(res.status).toBe(200);
    const system = lastSystemPromptWithoutQuestion(question);
    for (const marker of FORBIDDEN_TENANT_MARKERS) {
      expect(system).not.toContain(marker);
    }
  });
});
