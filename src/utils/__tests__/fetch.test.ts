/**
 * Shared outbound-HTTP helpers (backlog #10).
 *
 * Every external fetch must carry a hard deadline so a hung vendor / EL / Sage
 * socket can never stall a screening run or dialer tick indefinitely. These
 * tests pin the contract: a signal is always attached, the deadline actually
 * fires, caller-supplied signals compose instead of replacing the timeout, and
 * fetchJson's throw carries status but never the query string (keys/PII).
 */
import { fetchWithTimeout, fetchJson } from "../fetch";

const realFetch = global.fetch;

afterEach(() => {
  global.fetch = realFetch;
  jest.restoreAllMocks();
});

/** Stub fetch that never resolves on its own — only the abort signal ends it. */
function hangingFetch(): jest.Mock {
  return jest.fn(
    (_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal!.addEventListener("abort", () => reject(init.signal!.reason));
      })
  );
}

describe("fetchWithTimeout", () => {
  it("always attaches an abort signal", async () => {
    const spy = jest.fn().mockResolvedValue(new Response("{}"));
    global.fetch = spy as unknown as typeof fetch;

    await fetchWithTimeout("https://vendor.test/api");

    const init = spy.mock.calls[0][1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("rejects with TimeoutError once timeoutMs elapses on a hung socket", async () => {
    global.fetch = hangingFetch() as unknown as typeof fetch;

    await expect(
      fetchWithTimeout("https://vendor.test/hang", { timeoutMs: 25 })
    ).rejects.toMatchObject({ name: "TimeoutError" });
  });

  it("composes a caller-supplied signal with the timeout instead of replacing it", async () => {
    global.fetch = hangingFetch() as unknown as typeof fetch;
    const controller = new AbortController();

    const pending = fetchWithTimeout("https://vendor.test/hang", {
      signal: controller.signal,
      timeoutMs: 60_000,
    });
    controller.abort(new Error("caller cancelled"));

    await expect(pending).rejects.toMatchObject({ message: "caller cancelled" });
  });

  it("passes method/headers/body through untouched", async () => {
    const spy = jest.fn().mockResolvedValue(new Response("{}"));
    global.fetch = spy as unknown as typeof fetch;

    await fetchWithTimeout("https://vendor.test/api", {
      method: "POST",
      headers: { "x-k": "v" },
      body: "{}",
    });

    const init = spy.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "x-k": "v" });
    expect(init.body).toBe("{}");
    expect(init).not.toHaveProperty("timeoutMs");
  });
});

describe("fetchJson", () => {
  it("returns the parsed body on 2xx", async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ ok: 1 }), { status: 200 })
      ) as unknown as typeof fetch;

    await expect(fetchJson("https://vendor.test/api")).resolves.toEqual({ ok: 1 });
  });

  it("throws on non-2xx with status + body slice, without the query string", async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve(new Response("upstream sad", { status: 502 }))
    ) as unknown as typeof fetch;

    const err = (await fetchJson("https://vendor.test/api?apikey=SECRET", {
      method: "POST",
    }).catch((e) => e)) as Error;

    expect(err.message).toMatch(/POST https:\/\/vendor\.test\/api failed: 502 upstream sad/);
    expect(err.message).not.toContain("SECRET");
  });
});
