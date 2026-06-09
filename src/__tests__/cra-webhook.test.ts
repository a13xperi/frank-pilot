/**
 * Webhook tests for the consumer-report CRA receiver (src/modules/screening/
 * cra-webhook.ts). Synthetic payloads only — the real Checkr / TransUnion
 * signature scheme + envelope shape are credentialing-gated, so these exercise
 * the receiver's routing / persistence / HOLD / idempotency behavior against the
 * internal synthetic envelope the parser accepts.
 *
 * Mocked: DB (SQL-routed), state-machine transition, audit, the screening
 * pipeline. The real (pure) BackgroundCheck/CreditCheck mappers run so the
 * webhook's map→persist integration is exercised.
 */

import crypto from "crypto";
import express from "express";
import request from "supertest";

const mockTransition = jest.fn();
const mockRunFullScreening = jest.fn();

jest.mock("../config/database", () => ({ query: jest.fn() }));
jest.mock("../utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock("../middleware/audit", () => ({ writeAuditLog: jest.fn().mockResolvedValue(undefined) }));
jest.mock("../modules/screening/state-machine", () => ({
  transitionApplicationStatus: (...a: unknown[]) => mockTransition(...a),
}));
jest.mock("../modules/screening/service", () => ({
  ScreeningService: jest.fn().mockImplementation(() => ({ runFullScreening: mockRunFullScreening })),
}));

import { query } from "../config/database";
import craWebhookRouter from "../modules/screening/cra-webhook";

const mockQuery = query as jest.MockedFunction<typeof query>;
const flush = () => new Promise((resolve) => setImmediate(resolve));

const SECRET = "test_cra_secret";
const APP_ID = "11111111-2222-3333-4444-555555555555";

function buildApp() {
  const app = express();
  app.use("/webhook", craWebhookRouter);
  return app;
}
const app = buildApp();

function bgEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: "cra_evt_bg_1",
    domain: "background",
    applicationId: APP_ID,
    reportId: "rep_1",
    status: "complete",
    report: {
      sex_offender_search: { records: [] },
      national_criminal_search: { records: [] },
      county_criminal_searches: [],
    },
    ...overrides,
  };
}
function creditEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: "cra_evt_cr_1",
    domain: "credit",
    applicationId: APP_ID,
    reportId: "tu_1",
    status: "complete",
    report: { creditScore: 700, evictions: [], bankruptcies: [], collections: [] },
    ...overrides,
  };
}

function post(event: object, opts: { sig?: boolean } = {}) {
  const req = request(app)
    .post("/webhook")
    .set("Content-Type", "application/json");
  if (opts.sig !== false) req.set("x-cra-signature", "sig-present");
  return req.send(JSON.stringify(event));
}

const originalSecret = process.env.CRA_WEBHOOK_SECRET;
const originalScreenFlag = process.env.SCREENING_ON_SUBMIT_ENABLED;

afterAll(() => {
  process.env.CRA_WEBHOOK_SECRET = originalSecret;
  process.env.SCREENING_ON_SUBMIT_ENABLED = originalScreenFlag;
});

beforeEach(() => {
  jest.clearAllMocks();
  process.env.CRA_WEBHOOK_SECRET = SECRET;
  delete process.env.SCREENING_ON_SUBMIT_ENABLED;

  // SQL-routed DB mock. Default: not a duplicate; persist guarded UPDATE hits a
  // row (app is awaiting_consumer_report); the both-reports-in ctx says only the
  // current report has landed (so no advance unless a test overrides it).
  mockQuery.mockImplementation((sql: any) => {
    const s = String(sql);
    if (/cra_processed_events/i.test(s) && /SELECT/i.test(s)) {
      return Promise.resolve({ rows: [] }) as any; // alreadyProcessed → not a dup
    }
    if (/UPDATE applications SET/i.test(s) && /RETURNING id/i.test(s)) {
      return Promise.resolve({ rows: [{ id: APP_ID }] }) as any; // persist in awaiting_consumer_report
    }
    if (/FROM applications a/i.test(s) && /LEFT JOIN users/i.test(s)) {
      // advanceIfBothReportsIn ctx — only ONE report in by default.
      return Promise.resolve({
        rows: [
          {
            status: "awaiting_consumer_report",
            background_check_completed_at: new Date(),
            credit_check_completed_at: null,
            submitted_by: "99999999-8888-7777-6666-555555555555",
            submitter_role: "applicant",
          },
        ],
      }) as any;
    }
    return Promise.resolve({ rows: [] }) as any; // markProcessed, overall update
  });

  mockTransition.mockResolvedValue({ changed: true, status: "screening" });
  mockRunFullScreening.mockResolvedValue({});
});

describe("POST /webhook — secret + signature gating", () => {
  it("503 when CRA_WEBHOOK_SECRET unset (fail-closed)", async () => {
    delete process.env.CRA_WEBHOOK_SECRET;
    const res = await post(bgEvent());
    expect(res.status).toBe(503);
  });

  it("503 when secret is the placeholder", async () => {
    process.env.CRA_WEBHOOK_SECRET = "changeme";
    const res = await post(bgEvent());
    expect(res.status).toBe(503);
  });

  it("400 when signature header missing", async () => {
    const res = await post(bgEvent(), { sig: false });
    expect(res.status).toBe(400);
  });

  it("400 on unparseable envelope (unknown domain)", async () => {
    const res = await post(bgEvent({ domain: "nonsense" }));
    expect(res.status).toBe(400);
  });
});

describe("POST /webhook — background report completed", () => {
  it("persists the mapped verdict guarded to awaiting_consumer_report, 200", async () => {
    const res = await post(bgEvent());
    expect(res.status).toBe(200);
    const persist = mockQuery.mock.calls.find(
      (c) => /UPDATE applications SET/i.test(String(c[0])) && /background_check_details/i.test(String(c[0]))
    );
    expect(persist).toBeTruthy();
    expect(String(persist![0])).toMatch(/status = 'awaiting_consumer_report'/);
    // Persisted detail is categorical-only (mapped response under rawResponse).
    const detailJson = (persist![1] as any[])[2] as string;
    expect(detailJson).toContain("rawResponse");
    expect(detailJson).toContain("rep_1");
  });

  it("does NOT advance when only one report has landed", async () => {
    await post(bgEvent());
    await flush();
    expect(mockTransition).not.toHaveBeenCalled();
  });

  it("verdict ignored (no advance) when persist guard matches 0 rows", async () => {
    mockQuery.mockImplementation((sql: any) => {
      const s = String(sql);
      if (/cra_processed_events/i.test(s) && /SELECT/i.test(s)) return Promise.resolve({ rows: [] }) as any;
      if (/UPDATE applications SET/i.test(s) && /RETURNING id/i.test(s)) return Promise.resolve({ rows: [] }) as any; // CAS miss
      return Promise.resolve({ rows: [] }) as any;
    });
    const res = await post(bgEvent());
    expect(res.status).toBe(200);
    expect(mockTransition).not.toHaveBeenCalled();
  });
});

describe("POST /webhook — both reports in → advance", () => {
  beforeEach(() => {
    mockQuery.mockImplementation((sql: any) => {
      const s = String(sql);
      if (/cra_processed_events/i.test(s) && /SELECT/i.test(s)) return Promise.resolve({ rows: [] }) as any;
      if (/UPDATE applications SET/i.test(s) && /RETURNING id/i.test(s)) return Promise.resolve({ rows: [{ id: APP_ID }] }) as any;
      if (/FROM applications a/i.test(s) && /LEFT JOIN users/i.test(s)) {
        return Promise.resolve({
          rows: [
            {
              status: "awaiting_consumer_report",
              background_check_completed_at: new Date(),
              credit_check_completed_at: new Date(), // BOTH in
              submitted_by: "99999999-8888-7777-6666-555555555555",
              submitter_role: "applicant",
            },
          ],
        }) as any;
      }
      return Promise.resolve({ rows: [] }) as any;
    });
  });

  it("transitions awaiting_consumer_report → screening (consumer_report_resolved)", async () => {
    const res = await post(creditEvent());
    expect(res.status).toBe(200);
    await flush();
    expect(mockTransition).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "awaiting_consumer_report",
        to: "screening",
        trigger: "consumer_report_resolved",
      })
    );
  });

  it("kicks runFullScreening only when SCREENING_ON_SUBMIT_ENABLED", async () => {
    await post(creditEvent());
    await flush();
    expect(mockRunFullScreening).not.toHaveBeenCalled();

    jest.clearAllMocks();
    mockTransition.mockResolvedValue({ changed: true, status: "screening" });
    process.env.SCREENING_ON_SUBMIT_ENABLED = "true";
    await post(creditEvent({ id: "cra_evt_cr_2" }));
    await flush();
    expect(mockRunFullScreening).toHaveBeenCalledWith(
      APP_ID,
      "99999999-8888-7777-6666-555555555555",
      "applicant"
    );
  });

  it("does not kick screening when the CAS transition is a no-op", async () => {
    process.env.SCREENING_ON_SUBMIT_ENABLED = "true";
    mockTransition.mockResolvedValue({ changed: false, status: "screening" });
    await post(creditEvent());
    await flush();
    expect(mockRunFullScreening).not.toHaveBeenCalled();
  });
});

describe("POST /webhook — terminal failure → could_not_screen HOLD", () => {
  it("canceled status → HOLD in screening_review (never auto-pass)", async () => {
    const res = await post(bgEvent({ status: "canceled", id: "cra_evt_bg_cancel" }));
    expect(res.status).toBe(200);
    await flush();
    expect(mockTransition).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "awaiting_consumer_report",
        to: "screening_review",
        trigger: "could_not_screen",
      })
    );
    // It must NOT have persisted a background verdict / advanced to screening.
    expect(mockTransition).not.toHaveBeenCalledWith(
      expect.objectContaining({ to: "screening" })
    );
  });
});

describe("POST /webhook — idempotency", () => {
  it("duplicate event_id short-circuits with 200 + no persist", async () => {
    mockQuery.mockImplementation((sql: any) => {
      const s = String(sql);
      if (/cra_processed_events/i.test(s) && /SELECT/i.test(s)) return Promise.resolve({ rows: [{ "?column?": 1 }] }) as any; // already processed
      return Promise.resolve({ rows: [] }) as any;
    });
    const res = await post(bgEvent());
    expect(res.status).toBe(200);
    expect(res.body.duplicate).toBe(true);
    const persisted = mockQuery.mock.calls.some(
      (c) => /UPDATE applications SET/i.test(String(c[0])) && /RETURNING id/i.test(String(c[0]))
    );
    expect(persisted).toBe(false);
  });
});

describe("POST /webhook — real TransUnion ShareAble path (X-ShareAble-Signature)", () => {
  const SHAREABLE_SECRET = "shareable_whsec_test";
  const REQUEST_ID = "req_abc123";
  const originalSecret = process.env.TRANSUNION_SHAREABLE_WEBHOOK_SECRET;
  const originalKey = process.env.TRANSUNION_SHAREABLE_API_KEY;

  afterAll(() => {
    process.env.TRANSUNION_SHAREABLE_WEBHOOK_SECRET = originalSecret;
    process.env.TRANSUNION_SHAREABLE_API_KEY = originalKey;
  });

  beforeEach(() => {
    // Override the SQL mock so the ShareAble screening-request id resolves to our
    // application (via credit_report_id), dedup misses, persist hits, and only the
    // credit report has landed (no advance) by default.
    process.env.TRANSUNION_SHAREABLE_WEBHOOK_SECRET = SHAREABLE_SECRET;
    delete process.env.TRANSUNION_SHAREABLE_API_KEY;
    mockQuery.mockImplementation((sql: any, params?: any) => {
      const s = String(sql);
      if (/credit_report_id = \$1/i.test(s)) {
        // translateShareAbleEvent: request_id → application id.
        return Promise.resolve({
          rows: params?.[0] === REQUEST_ID ? [{ id: APP_ID }] : [],
        }) as any;
      }
      if (/cra_processed_events/i.test(s) && /SELECT/i.test(s)) return Promise.resolve({ rows: [] }) as any;
      if (/UPDATE applications SET/i.test(s) && /RETURNING id/i.test(s)) return Promise.resolve({ rows: [{ id: APP_ID }] }) as any;
      if (/FROM applications a/i.test(s) && /LEFT JOIN users/i.test(s)) {
        return Promise.resolve({
          rows: [
            {
              status: "awaiting_consumer_report",
              background_check_completed_at: null, // only the CREDIT report in
              credit_check_completed_at: new Date(),
              submitted_by: "99999999-8888-7777-6666-555555555555",
              submitter_role: "applicant",
            },
          ],
        }) as any;
      }
      return Promise.resolve({ rows: [] }) as any;
    });
  });

  // A real ShareAble event envelope: { id, type, data: { object } }. The object
  // carries request_id (our join key) + the categorical credit report fields.
  function shareAbleEvent(type: string, objectOverrides: Record<string, unknown> = {}) {
    return {
      id: `tu_evt_${type}`,
      type,
      data: {
        object: {
          report_id: "rep_tu_1",
          request_id: REQUEST_ID,
          creditScore: 700,
          evictions: [],
          bankruptcies: [],
          collections: [],
          ...objectOverrides,
        },
      },
    };
  }

  // Post on the ShareAble path. Default = a valid HMAC-SHA256 hex signature over
  // the raw body; `sign:false` sends a present-but-invalid signature.
  function shareAblePost(event: object, opts: { sign?: boolean } = {}) {
    const raw = JSON.stringify(event);
    const sig =
      opts.sign === false
        ? "deadbeef"
        : crypto.createHmac("sha256", SHAREABLE_SECRET).update(raw).digest("hex");
    return request(app)
      .post("/webhook")
      .set("Content-Type", "application/json")
      .set("x-shareable-signature", sig)
      .send(raw);
  }

  it("503 when neither webhook secret nor API key is set (fail-closed)", async () => {
    delete process.env.TRANSUNION_SHAREABLE_WEBHOOK_SECRET;
    delete process.env.TRANSUNION_SHAREABLE_API_KEY;
    const res = await shareAblePost(shareAbleEvent("report.completed"));
    expect(res.status).toBe(503);
  });

  it("401 on an invalid X-ShareAble-Signature (never trust an unverified payload)", async () => {
    const res = await shareAblePost(shareAbleEvent("report.completed"), { sign: false });
    expect(res.status).toBe(401);
  });

  it("accepts a sha256= prefixed signature", async () => {
    const raw = JSON.stringify(shareAbleEvent("report.completed"));
    const hex = crypto.createHmac("sha256", SHAREABLE_SECRET).update(raw).digest("hex");
    const res = await request(app)
      .post("/webhook")
      .set("Content-Type", "application/json")
      .set("x-shareable-signature", `sha256=${hex}`)
      .send(raw);
    expect(res.status).toBe(200);
  });

  it("report.completed + known request → resolves application, persists credit verdict, 200", async () => {
    const res = await shareAblePost(shareAbleEvent("report.completed"));
    expect(res.status).toBe(200);
    // request_id was looked up via credit_report_id...
    const resolved = mockQuery.mock.calls.find((c) => /credit_report_id = \$1/i.test(String(c[0])));
    expect(resolved).toBeTruthy();
    expect((resolved![1] as any[])[0]).toBe(REQUEST_ID);
    // ...and the mapped verdict persisted, guarded to awaiting_consumer_report.
    const persist = mockQuery.mock.calls.find(
      (c) => /UPDATE applications SET/i.test(String(c[0])) && /credit_check_details/i.test(String(c[0]))
    );
    expect(persist).toBeTruthy();
    expect(String(persist![0])).toMatch(/status = 'awaiting_consumer_report'/);
  });

  it("unknown request id → 200 ignored, no persist (ShareAble would otherwise retry)", async () => {
    const res = await shareAblePost(shareAbleEvent("report.completed", { request_id: "req_unknown" }));
    expect(res.status).toBe(200);
    expect(res.body.ignored).toBe(true);
    const persisted = mockQuery.mock.calls.some(
      (c) => /UPDATE applications SET/i.test(String(c[0])) && /RETURNING id/i.test(String(c[0]))
    );
    expect(persisted).toBe(false);
  });

  it("an unhandled event type (applicant.created) → 200 ignored, no side effects", async () => {
    const res = await shareAblePost(shareAbleEvent("applicant.created"));
    expect(res.status).toBe(200);
    expect(res.body.ignored).toBe(true);
    expect(mockTransition).not.toHaveBeenCalled();
  });

  // F1 regression lock (credit domain): a ShareAble dispute is a post-completion
  // FCRA §1681i reinvestigation of an EXISTING credit report, not a failure to
  // produce a verdict. It must NOT bounce the applicant to a could_not_screen
  // HOLD — it falls through to a 200 ack with no transition. Mirrors the Checkr
  // lock in cra-webhook-checkr.test.ts.
  it("report.disputed → 200 ignored, NO could_not_screen HOLD (§1681i reinvestigation)", async () => {
    const res = await shareAblePost(shareAbleEvent("report.disputed"));
    expect(res.status).toBe(200);
    expect(res.body.ignored).toBe(true);
    expect(mockTransition).not.toHaveBeenCalled();
  });

  it("report.canceled → terminal HOLD in screening_review (never auto-pass)", async () => {
    const res = await shareAblePost(shareAbleEvent("report.canceled"));
    expect(res.status).toBe(200);
    await flush();
    expect(mockTransition).toHaveBeenCalledWith(
      expect.objectContaining({ to: "screening_review", trigger: "could_not_screen" })
    );
    expect(mockTransition).not.toHaveBeenCalledWith(
      expect.objectContaining({ to: "screening" })
    );
  });
});
