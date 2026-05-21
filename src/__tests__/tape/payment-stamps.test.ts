/**
 * BP-03b.1 — Payment Wizard scaffold tape beacons (Lane W4).
 *
 * Frozen Contract 4:
 *   POST /api/tape/payment-init    → bp03b.payment_initiated   (HUD 4350.3 Ch. 4-6)
 *   POST /api/tape/payment-success → bp03b.payment_succeeded   (HUD 4350.3 Ch. 4-6)
 * Both accept { session_id, adults, total } and are idempotent per session_id.
 */
import express from "express";
import request from "supertest";
import * as os from "os";
import * as path from "path";
import { promises as fs } from "fs";

jest.mock("../../utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import tapeRouter from "../../modules/tape/routes";
import {
  configureTapeLedgerPath,
  getTapeLedgerPath,
  readTapeLedger,
  resetTapeStateForTests,
  TAPE_STAMP_KINDS,
  TAPE_CITATIONS,
} from "../../modules/tape";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/tape", tapeRouter);
  return app;
}

async function waitForStamp(
  kindKey: keyof typeof TAPE_STAMP_KINDS,
  attempts = 20
) {
  for (let i = 0; i < attempts; i++) {
    const records = await readTapeLedger();
    const hit = records.find((r) => r.kind === kindKey);
    if (hit) return { hit, records };
    await new Promise((r) => setTimeout(r, 25));
  }
  return { hit: null, records: await readTapeLedger() };
}

describe("BP-03b.1 — Payment Wizard tape beacons (Lane W4)", () => {
  let tmpLedger: string;
  let app: express.Express;

  beforeEach(() => {
    tmpLedger = path.join(
      os.tmpdir(),
      `bp03b1-payment-${Date.now()}-${Math.random()}.ndjson`
    );
    configureTapeLedgerPath(tmpLedger);
    resetTapeStateForTests();
    app = buildApp();
  });

  afterEach(async () => {
    try {
      await fs.unlink(getTapeLedgerPath());
    } catch {
      /* ignore */
    }
  });

  test("contract: stamp kind values match the frozen contract literals", () => {
    expect(TAPE_STAMP_KINDS.BP03B_PAYMENT_INITIATED).toBe("bp03b.payment_initiated");
    expect(TAPE_STAMP_KINDS.BP03B_PAYMENT_SUCCEEDED).toBe("bp03b.payment_succeeded");
    expect(TAPE_CITATIONS.BP03B_PAYMENT_INITIATED).toBe("HUD 4350.3 Ch. 4-6");
    expect(TAPE_CITATIONS.BP03B_PAYMENT_SUCCEEDED).toBe("HUD 4350.3 Ch. 4-6");
  });

  test("POST /api/tape/payment-init → stamps bp03b.payment_initiated with payload + HUD cite", async () => {
    const res = await request(app)
      .post("/api/tape/payment-init")
      .send({ session_id: "sess-pay-init-1", adults: 2, total: 95 });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.kind).toBe("bp03b.payment_initiated");
    expect(res.body.idempotent).toBe(false);

    const { hit } = await waitForStamp("BP03B_PAYMENT_INITIATED");
    expect(hit).not.toBeNull();
    expect(hit!.citation).toBe("HUD 4350.3 Ch. 4-6");
    expect(hit!.actor).toBe("tenant");
    expect(hit!.payload).toMatchObject({ adults: 2, total: 95 });
    expect(hit!.session_id).toBe("sess-pay-init-1");
  });

  test("POST /api/tape/payment-success → stamps bp03b.payment_succeeded with payload + HUD cite", async () => {
    const res = await request(app)
      .post("/api/tape/payment-success")
      .send({ session_id: "sess-pay-ok-1", adults: 3, total: 145 });

    expect(res.status).toBe(200);
    expect(res.body.kind).toBe("bp03b.payment_succeeded");

    const { hit } = await waitForStamp("BP03B_PAYMENT_SUCCEEDED");
    expect(hit).not.toBeNull();
    expect(hit!.citation).toBe("HUD 4350.3 Ch. 4-6");
    expect(hit!.actor).toBe("tenant");
    expect(hit!.payload).toMatchObject({ adults: 3, total: 145 });
    expect(hit!.session_id).toBe("sess-pay-ok-1");
  });

  test("idempotent: repeat calls with the same session_id do not duplicate the stamp", async () => {
    const body = { session_id: "sess-dedupe-pay", adults: 1, total: 50 };

    const r1 = await request(app).post("/api/tape/payment-init").send(body);
    const r2 = await request(app).post("/api/tape/payment-init").send(body);
    const r3 = await request(app).post("/api/tape/payment-init").send(body);

    expect(r1.status).toBe(200);
    expect(r1.body.idempotent).toBe(false);
    expect(r2.status).toBe(200);
    expect(r2.body.idempotent).toBe(true);
    expect(r3.status).toBe(200);
    expect(r3.body.idempotent).toBe(true);

    await new Promise((r) => setTimeout(r, 100));
    const records = await readTapeLedger();
    const initStamps = records.filter((r) => r.kind === "BP03B_PAYMENT_INITIATED");
    expect(initStamps.length).toBe(1);
  });

  test("idempotency is per-kind: init and success can both fire for the same session_id", async () => {
    const session_id = "sess-mixed";
    await request(app).post("/api/tape/payment-init").send({ session_id, adults: 2, total: 95 });
    await request(app).post("/api/tape/payment-success").send({ session_id, adults: 2, total: 95 });

    await new Promise((r) => setTimeout(r, 100));
    const records = await readTapeLedger();
    expect(records.find((r) => r.kind === "BP03B_PAYMENT_INITIATED")).toBeDefined();
    expect(records.find((r) => r.kind === "BP03B_PAYMENT_SUCCEEDED")).toBeDefined();
  });

  test("missing session_id → 400", async () => {
    const r1 = await request(app).post("/api/tape/payment-init").send({ adults: 1, total: 50 });
    expect(r1.status).toBe(400);

    const r2 = await request(app).post("/api/tape/payment-success").send({ adults: 1, total: 50 });
    expect(r2.status).toBe(400);
  });

  test("empty-string session_id → 400", async () => {
    const r1 = await request(app)
      .post("/api/tape/payment-init")
      .send({ session_id: "", adults: 1, total: 50 });
    expect(r1.status).toBe(400);

    const r2 = await request(app)
      .post("/api/tape/payment-success")
      .send({ session_id: "", adults: 1, total: 50 });
    expect(r2.status).toBe(400);
  });

  test("non-string session_id → 400", async () => {
    const r1 = await request(app)
      .post("/api/tape/payment-init")
      .send({ session_id: 12345, adults: 1, total: 50 });
    expect(r1.status).toBe(400);
  });
});
