import { FieldTrailEmitter } from "../modules/integrations/field-trail-emit";

jest.mock("../utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

describe("FieldTrailEmitter", () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    process.env = { ...OLD_ENV, SAGE_URL: "https://sage.test/", SAGE_SERVICE_ROLE_KEY: "k-svc" };
  });
  afterEach(() => {
    process.env = OLD_ENV;
  });

  it("POSTs a truth_tokens row best-effort and returns true on 2xx", async () => {
    const fetchStub = jest.fn().mockResolvedValue({ ok: true, status: 201 }) as unknown as typeof fetch;
    const em = new FieldTrailEmitter(fetchStub);

    const ok = await em.emit({
      actor: "user:abc",
      eventType: "onboarding.call_placed",
      summary: "outbound call placed",
      detail: { number: "+1725..." },
    });

    expect(ok).toBe(true);
    expect(fetchStub).toHaveBeenCalledTimes(1);
    const [url, opts] = (fetchStub as jest.Mock).mock.calls[0];
    expect(url).toBe("https://sage.test/rest/v1/truth_tokens"); // trailing slash normalized
    const body = JSON.parse((opts as { body: string }).body);
    expect(body.event_type).toBe("onboarding.call_placed");
    expect(body.actor).toBe("user:abc");
    expect(body.answer).toBe("outbound call placed");
    expect(body.answer_hash).toHaveLength(64); // sha-256 hex
    expect(body.query_hash).toHaveLength(64);
    expect(body.is_current).toBe(true);
    const headers = (opts as { headers: Record<string, string> }).headers;
    expect(headers.apikey).toBe("k-svc");
    expect(headers.Authorization).toBe("Bearer k-svc");
  });

  it("no-ops (returns false, never fetches) when SAGE is not configured", async () => {
    process.env = { ...OLD_ENV };
    delete process.env.SAGE_URL;
    delete process.env.SAGE_SERVICE_ROLE_KEY;
    delete process.env.SAGE_ANON_KEY;
    const fetchStub = jest.fn() as unknown as typeof fetch;
    const em = new FieldTrailEmitter(fetchStub);

    const ok = await em.emit({ actor: "user:abc", eventType: "x", summary: "y" });

    expect(ok).toBe(false);
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it("never throws on a non-2xx (e.g. 404 table absent pre-migration) — INERT", async () => {
    const fetchStub = jest.fn().mockResolvedValue({ ok: false, status: 404 }) as unknown as typeof fetch;
    const em = new FieldTrailEmitter(fetchStub);
    await expect(em.emit({ actor: "user:abc", eventType: "x", summary: "y" })).resolves.toBe(false);
  });

  it("never throws on a network error", async () => {
    const fetchStub = jest.fn().mockRejectedValue(new Error("ECONNREFUSED")) as unknown as typeof fetch;
    const em = new FieldTrailEmitter(fetchStub);
    await expect(em.emit({ actor: "user:abc", eventType: "x", summary: "y" })).resolves.toBe(false);
  });

  it("falls back to the anon key when no service-role key is set", async () => {
    process.env = { ...OLD_ENV, SAGE_URL: "https://sage.test", SAGE_ANON_KEY: "k-anon" };
    delete process.env.SAGE_SERVICE_ROLE_KEY;
    const fetchStub = jest.fn().mockResolvedValue({ ok: true, status: 201 }) as unknown as typeof fetch;
    const em = new FieldTrailEmitter(fetchStub);

    await em.emit({ actor: "user:abc", eventType: "x", summary: "y" });

    const headers = (fetchStub as jest.Mock).mock.calls[0][1].headers;
    expect(headers.apikey).toBe("k-anon");
  });
});
