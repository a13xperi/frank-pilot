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
