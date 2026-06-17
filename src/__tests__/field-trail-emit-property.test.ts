/**
 * Property test for the field-trail emitter: across many random inputs (incl. unicode/quotes/
 * emoji actors, events, summaries, and cross-actor edges), the POSTed truth_tokens row is always
 * well-formed — 64-hex hashes, faithful passthrough of actor/event_type/event_detail/
 * depends_on_token_id, and it never throws. Mirrors the battlestation fuzz validator, TS-side.
 */
import { FieldTrailEmitter } from "../modules/integrations/field-trail-emit";

jest.mock("../utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const WEIRD = ["", "a", "O'Brien", 'q"x', "back\\slash", "tab\ty", "新規", "café", "😀🔒", "{}", "::"];
const pick = <T,>(xs: T[]): T => xs[Math.floor(Math.random() * xs.length)];
const rs = (n = 8) => Math.random().toString(36).slice(2, 2 + n);

describe("FieldTrailEmitter — property (random inputs always well-formed)", () => {
  const OLD = process.env;
  beforeEach(() => {
    process.env = { ...OLD, SAGE_URL: "https://sage.test", SAGE_SERVICE_ROLE_KEY: "k" };
  });
  afterEach(() => {
    process.env = OLD;
  });

  it("builds a well-formed row for 200 random events and never throws", async () => {
    for (let i = 0; i < 200; i++) {
      const captured: { body?: string } = {};
      const fetchStub = jest.fn(async (_url: string, opts: { body: string }) => {
        captured.body = opts.body;
        return { ok: true, status: 201 } as Response;
      }) as unknown as typeof fetch;

      const actorKind = pick(["user", "email", "phone", "agent"]);
      const ev = {
        actor: `${actorKind}:${pick(WEIRD)}${rs()}`,
        eventType: pick(["onboarding.call_placed", "onboarding.text_sent", "user-action", pick(WEIRD)]),
        summary: pick(WEIRD) + " " + rs(),
        detail: { k: pick(WEIRD), n: i, nested: { x: pick(WEIRD) } },
        dependsOnTokenId: Math.random() < 0.5 ? rs(12) : undefined,
      };

      // must never throw, whatever the input
      const ok = await new FieldTrailEmitter(fetchStub).emit(ev);
      expect(ok).toBe(true);

      const body = JSON.parse(captured.body as string);
      // hashes are sha-256 hex
      expect(body.query_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(body.answer_hash).toMatch(/^[0-9a-f]{64}$/);
      // faithful passthrough
      expect(body.actor).toBe(ev.actor);
      expect(body.event_type).toBe(ev.eventType);
      expect(body.answer).toBe(ev.summary);
      expect(body.event_detail).toEqual(ev.detail);
      expect(body.depends_on_token_id).toBe(ev.dependsOnTokenId ?? null);
      // invariants
      expect(body.is_current).toBe(true);
      expect(body.app).toBe("frank-onboarding");
      // the body must round-trip as JSON (no encoding breakage on weird strings)
      expect(typeof captured.body).toBe("string");
    }
  });

  it("never throws on a rejecting/erroring fetch across random inputs", async () => {
    for (let i = 0; i < 50; i++) {
      const mode = i % 3;
      const fetchStub = jest.fn(async () => {
        if (mode === 0) throw new Error("network");
        return { ok: false, status: pick([400, 404, 429, 500]) } as Response;
      }) as unknown as typeof fetch;
      await expect(
        new FieldTrailEmitter(fetchStub).emit({ actor: `user:${rs()}`, eventType: pick(WEIRD), summary: pick(WEIRD) })
      ).resolves.toBe(false);
    }
  });
});
