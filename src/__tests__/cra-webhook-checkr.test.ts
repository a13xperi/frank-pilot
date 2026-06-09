/**
 * Real Checkr receive-path tests for the consumer-report CRA webhook
 * (src/modules/screening/cra-webhook.ts). The sibling suite cra-webhook.test.ts
 * covers the SYNTHETIC (`x-cra-signature`) envelope; this one drives the
 * PRODUCTION path: the `X-Checkr-Signature` header, constant-time HMAC over the
 * RAW body, Checkr event-type → categorical status, and candidate_id →
 * application resolution (createReport persists candidate.id as
 * background_report_id, the durable join key for the invitation flow).
 *
 * Mocked: DB (SQL-routed), state-machine transition, audit, screening pipeline.
 * The real (pure) BackgroundCheck mapper runs so the map→persist leg is real.
 */

import express from "express";
import request from "supertest";
import crypto from "crypto";

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

const CHECKR_SECRET = "test_checkr_secret";
const CANDIDATE_ID = "cand_abc123";
const APP_ID = "11111111-2222-3333-4444-555555555555";

const app = express();
app.use("/webhook", craWebhookRouter);

function checkrEvent(type: string, objectOverrides: Record<string, unknown> = {}) {
  return {
    id: "chk_evt_" + type.replace(/\./g, "_"),
    type,
    data: {
      object: {
        id: "rep_xyz",
        candidate_id: CANDIDATE_ID,
        sex_offender_search: { records: [] },
        national_criminal_search: { records: [] },
        county_criminal_searches: [],
        ...objectOverrides,
      },
    },
  };
}

// Signs the EXACT bytes it sends — express.raw hands the handler this same
// buffer, so the HMAC the verifier recomputes must be over this string.
function postCheckr(event: object, opts: { sign?: boolean; secret?: string } = {}) {
  const raw = JSON.stringify(event);
  const req = request(app).post("/webhook").set("Content-Type", "application/json");
  if (opts.sign === false) {
    req.set("x-checkr-signature", "deadbeef"); // present but wrong length → reject
  } else {
    const sig = crypto.createHmac("sha256", opts.secret ?? CHECKR_SECRET).update(raw).digest("hex");
    req.set("x-checkr-signature", sig);
  }
  return req.send(raw);
}

const originalWebhookSecret = process.env.CHECKR_WEBHOOK_SECRET;
const originalApiKey = process.env.CHECKR_API_KEY;
const originalScreenFlag = process.env.SCREENING_ON_SUBMIT_ENABLED;

afterAll(() => {
  process.env.CHECKR_WEBHOOK_SECRET = originalWebhookSecret;
  process.env.CHECKR_API_KEY = originalApiKey;
  process.env.SCREENING_ON_SUBMIT_ENABLED = originalScreenFlag;
});

beforeEach(() => {
  jest.clearAllMocks();
  process.env.CHECKR_WEBHOOK_SECRET = CHECKR_SECRET;
  delete process.env.CHECKR_API_KEY;
  delete process.env.SCREENING_ON_SUBMIT_ENABLED;

  // SQL-routed DB mock. Default: candidate is known (→ APP_ID), not a duplicate,
  // persist guard hits a row (awaiting_consumer_report), only ONE report in.
  mockQuery.mockImplementation((sql: any) => {
    const s = String(sql);
    if (/cra_processed_events/i.test(s) && /SELECT/i.test(s)) return Promise.resolve({ rows: [] }) as any;
    if (/SELECT id FROM applications WHERE background_report_id/i.test(s)) {
      return Promise.resolve({ rows: [{ id: APP_ID }] }) as any;
    }
    if (/UPDATE applications SET/i.test(s) && /RETURNING id/i.test(s)) {
      return Promise.resolve({ rows: [{ id: APP_ID }] }) as any;
    }
    if (/FROM applications a/i.test(s) && /LEFT JOIN users/i.test(s)) {
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
    return Promise.resolve({ rows: [] }) as any;
  });

  mockTransition.mockResolvedValue({ changed: true, status: "screening" });
  mockRunFullScreening.mockResolvedValue({});
});

describe("POST /webhook — Checkr signature gating", () => {
  it("503 when X-Checkr-Signature present but no Checkr secret configured (fail-closed)", async () => {
    delete process.env.CHECKR_WEBHOOK_SECRET;
    delete process.env.CHECKR_API_KEY;
    const res = await postCheckr(checkrEvent("report.completed"), { sign: false });
    expect(res.status).toBe(503);
  });

  it("401 on an invalid Checkr signature", async () => {
    const res = await postCheckr(checkrEvent("report.completed"), { sign: false });
    expect(res.status).toBe(401);
  });

  it("401 when signed with the wrong secret (HMAC mismatch)", async () => {
    const res = await postCheckr(checkrEvent("report.completed"), { secret: "not_the_secret" });
    expect(res.status).toBe(401);
  });

  it("falls back to CHECKR_API_KEY as the signing secret", async () => {
    delete process.env.CHECKR_WEBHOOK_SECRET;
    process.env.CHECKR_API_KEY = CHECKR_SECRET;
    const res = await postCheckr(checkrEvent("report.completed"));
    expect(res.status).toBe(200);
  });
});

describe("POST /webhook — Checkr event translation + persist", () => {
  it("accepts a valid HMAC over the raw body and persists the verdict (200)", async () => {
    const res = await postCheckr(checkrEvent("report.completed"));
    expect(res.status).toBe(200);
    const persist = mockQuery.mock.calls.find(
      (c) => /UPDATE applications SET/i.test(String(c[0])) && /background_check_details/i.test(String(c[0]))
    );
    expect(persist).toBeTruthy();
    expect(String(persist![0])).toMatch(/status = 'awaiting_consumer_report'/);
    // categorical-only detail, keyed by the REPORT id (object.id), not candidate id
    const detailJson = (persist![1] as any[])[2] as string;
    expect(detailJson).toContain("rawResponse");
    expect(detailJson).toContain("rep_xyz");
  });

  it("resolves the application by candidate_id (background_report_id join key)", async () => {
    await postCheckr(checkrEvent("report.completed"));
    const lookup = mockQuery.mock.calls.find((c) =>
      /SELECT id FROM applications WHERE background_report_id/i.test(String(c[0]))
    );
    expect(lookup).toBeTruthy();
    expect((lookup![1] as any[])[0]).toBe(CANDIDATE_ID);
  });

  it("acks 200 + ignored for an event type we don't act on (no persist)", async () => {
    const res = await postCheckr(checkrEvent("report.created"));
    expect(res.status).toBe(200);
    expect(res.body.ignored).toBe(true);
    const persisted = mockQuery.mock.calls.some(
      (c) => /UPDATE applications SET/i.test(String(c[0])) && /RETURNING id/i.test(String(c[0]))
    );
    expect(persisted).toBe(false);
  });

  it("acks 200 + ignored for an unknown candidate (no app, no persist)", async () => {
    mockQuery.mockImplementation((sql: any) => {
      const s = String(sql);
      if (/SELECT id FROM applications WHERE background_report_id/i.test(s)) return Promise.resolve({ rows: [] }) as any;
      return Promise.resolve({ rows: [] }) as any;
    });
    const res = await postCheckr(checkrEvent("report.completed", { candidate_id: "cand_unknown" }));
    expect(res.status).toBe(200);
    expect(res.body.ignored).toBe(true);
    expect(mockTransition).not.toHaveBeenCalled();
  });

  it("acks 200 + ignored for a malformed event (missing data.object)", async () => {
    const res = await postCheckr({ id: "chk_evt_bad", type: "report.completed" });
    expect(res.status).toBe(200);
    expect(res.body.ignored).toBe(true);
    expect(mockTransition).not.toHaveBeenCalled();
  });
});

describe("POST /webhook — Checkr terminal failures → could_not_screen HOLD", () => {
  it("report.canceled → HOLD in screening_review (never auto-pass)", async () => {
    const res = await postCheckr(checkrEvent("report.canceled"));
    expect(res.status).toBe(200);
    await flush();
    expect(mockTransition).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "awaiting_consumer_report",
        to: "screening_review",
        trigger: "could_not_screen",
      })
    );
    expect(mockTransition).not.toHaveBeenCalledWith(expect.objectContaining({ to: "screening" }));
  });

  it("invitation.expired → terminal HOLD (applicant never completed the hosted apply)", async () => {
    const res = await postCheckr(checkrEvent("invitation.expired"));
    expect(res.status).toBe(200);
    await flush();
    expect(mockTransition).toHaveBeenCalledWith(
      expect.objectContaining({ to: "screening_review", trigger: "could_not_screen" })
    );
  });
});

describe("POST /webhook — Checkr idempotency", () => {
  it("duplicate event_id short-circuits with 200 + no persist", async () => {
    mockQuery.mockImplementation((sql: any) => {
      const s = String(sql);
      if (/cra_processed_events/i.test(s) && /SELECT/i.test(s)) return Promise.resolve({ rows: [{ "?column?": 1 }] }) as any;
      if (/SELECT id FROM applications WHERE background_report_id/i.test(s)) return Promise.resolve({ rows: [{ id: APP_ID }] }) as any;
      return Promise.resolve({ rows: [] }) as any;
    });
    const res = await postCheckr(checkrEvent("report.completed"));
    expect(res.status).toBe(200);
    expect(res.body.duplicate).toBe(true);
    const persisted = mockQuery.mock.calls.some(
      (c) => /UPDATE applications SET/i.test(String(c[0])) && /RETURNING id/i.test(String(c[0]))
    );
    expect(persisted).toBe(false);
  });
});
