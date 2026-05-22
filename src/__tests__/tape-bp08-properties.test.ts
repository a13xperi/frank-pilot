/**
 * Property-based tests for the BP-08 compliance-tape NDJSON ledger.
 *
 * Contract under test (`src/modules/tape/index.ts`):
 *   - stampTape routes by kind VALUE: kinds whose value starts with `bp08.`
 *     land in `bp08LedgerPath`; everything else lands in `ledgerPath`.
 *   - sessionId dedupe is keyed `${kind}:${sessionId}` and is process-local.
 *   - Records carry: timestamp (ISO8601), kind, citation, actor, payload.
 *   - resetTapeStateForTests() clears the dedupe Set AND unlinks both ledgers.
 *
 * fast-check generators sweep payload shapes and kind combinations. Each
 * property runs 100 iterations by default (numRuns boosted where the
 * search space is wider than the default).
 *
 * NOTE: tests use temp ledger paths via configureTapeLedgerPath /
 * configureBp08LedgerPath. The original paths are captured in beforeAll
 * and restored in afterAll so we never touch server/tape/* in-tree.
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import fc from "fast-check";

jest.mock("../utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import {
  TAPE_STAMP_KINDS,
  TAPE_CITATIONS,
  stampTape,
  readTapeLedger,
  configureTapeLedgerPath,
  configureBp08LedgerPath,
  getTapeLedgerPath,
  getBp08LedgerPath,
  resetTapeStateForTests,
  TapeStampKind,
} from "../modules/tape";

// ── Test helpers ───────────────────────────────────────────────────────────

const BP08_KINDS: TapeStampKind[] = [
  "BP08_PAYMENT_INTENT_CREATED",
  "BP08_PAYMENT_SUCCEEDED",
  "BP08_PAYMENT_FAILED",
  "BP08_PAYMENT_REPLAY_BLOCKED",
];

const NON_BP08_KINDS: TapeStampKind[] = [
  "WELCOME_LETTER_DELIVERED",
  "HUD_928_1_FAIR_HOUSING_POSTED",
  "WAITING_LIST_APP_CAPTURED",
  "HUD_92006_SUPPLEMENT_CAPTURED",
  "POSITION_LETTER_SENT",
  "BP03B_PAYMENT_INITIATED",
  "BP03B_PAYMENT_SUCCEEDED",
];

const ALL_KINDS: TapeStampKind[] = [...BP08_KINDS, ...NON_BP08_KINDS];

function tempLedger(label: string): string {
  return path.join(
    os.tmpdir(),
    `bp08-test-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.ndjson`
  );
}

function safeUnlink(p: string): void {
  try {
    if (fs.existsSync(p)) fs.unlinkSync(p);
  } catch {
    /* ignore */
  }
}

// Capture original ledger paths so we can restore them after the suite.
let originalBp03bPath: string;
let originalBp08Path: string;

beforeAll(() => {
  originalBp03bPath = getTapeLedgerPath();
  originalBp08Path = getBp08LedgerPath();
});

afterAll(() => {
  configureTapeLedgerPath(originalBp03bPath);
  configureBp08LedgerPath(originalBp08Path);
});

// Per-test: fresh ledger paths + cleared dedupe.
let bp03bPath: string;
let bp08Path: string;

beforeEach(() => {
  bp03bPath = tempLedger("bp03b");
  bp08Path = tempLedger("bp08");
  configureTapeLedgerPath(bp03bPath);
  configureBp08LedgerPath(bp08Path);
  resetTapeStateForTests();
});

afterEach(() => {
  // resetTapeStateForTests unlinks the *currently configured* paths; we just
  // need to make sure no scratch files leak.
  safeUnlink(bp03bPath);
  safeUnlink(bp08Path);
});

// Generators ----------------------------------------------------------------

const payloadArb = fc.dictionary(
  fc.string({ minLength: 1, maxLength: 10 }),
  fc.oneof(
    fc.string(),
    fc.integer(),
    fc.boolean(),
    fc.constant(null),
    fc.array(fc.integer(), { maxLength: 5 })
  ),
  { maxKeys: 5 }
);

const actorArb = fc.option(fc.string({ maxLength: 30 }), { nil: null });

const sessionIdArb = fc.string({ minLength: 1, maxLength: 20 });

const bp08KindArb = fc.constantFrom(...BP08_KINDS);
const nonBp08KindArb = fc.constantFrom(...NON_BP08_KINDS);

// ── Property 1: BP-08 kinds always route to bp08 ledger ─────────────────────

describe("Property 1: BP-08 kinds route to bp08.ndjson only", () => {
  it("any (bp08 kind, payload) lands in bp08 ledger, never in bp03b ledger", async () => {
    await fc.assert(
      fc.asyncProperty(bp08KindArb, payloadArb, actorArb, async (kind, payload, actor) => {
        // Fresh state per sample to keep assertions tight.
        resetTapeStateForTests();
        const record = await stampTape({ kind, actor, payload });
        expect(record).not.toBeNull();
        expect(record!.kind).toBe(kind);

        const bp08Records = await readTapeLedger(bp08Path);
        const bp03bRecords = await readTapeLedger(bp03bPath);
        expect(bp08Records.length).toBe(1);
        expect(bp03bRecords.length).toBe(0);
        expect(bp08Records[0].kind).toBe(kind);
      }),
      { numRuns: 100 }
    );
  });
});

// ── Property 2: non-BP-08 kinds never leak into bp08 ledger ─────────────────

describe("Property 2: non-BP-08 kinds route to bp03b.ndjson only", () => {
  it("any (non-bp08 kind, payload) lands in bp03b ledger, never in bp08 ledger", async () => {
    await fc.assert(
      fc.asyncProperty(nonBp08KindArb, payloadArb, actorArb, async (kind, payload, actor) => {
        resetTapeStateForTests();
        const record = await stampTape({ kind, actor, payload });
        expect(record).not.toBeNull();

        const bp08Records = await readTapeLedger(bp08Path);
        const bp03bRecords = await readTapeLedger(bp03bPath);
        expect(bp03bRecords.length).toBe(1);
        expect(bp08Records.length).toBe(0);
        expect(bp03bRecords[0].kind).toBe(kind);
      }),
      { numRuns: 100 }
    );
  });
});

// ── Property 3: session-id dedupe is per-kind ───────────────────────────────

describe("Property 3: session-id dedupe is per-(kind, sessionId)", () => {
  it("two distinct kinds with same sessionId both write; same (kind, sessionId) twice writes only once", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...ALL_KINDS),
        fc.constantFrom(...ALL_KINDS),
        sessionIdArb,
        async (k1, k2, sid) => {
          fc.pre(k1 !== k2);
          resetTapeStateForTests();

          const r1 = await stampTape({ kind: k1, actor: "a", sessionId: sid, payload: {} });
          const r2 = await stampTape({ kind: k2, actor: "a", sessionId: sid, payload: {} });
          expect(r1).not.toBeNull();
          expect(r2).not.toBeNull();

          // Re-stamp k1 with same sessionId → dedupe → null.
          const r3 = await stampTape({ kind: k1, actor: "a", sessionId: sid, payload: {} });
          expect(r3).toBeNull();

          // Re-stamp k2 with same sessionId → dedupe → null.
          const r4 = await stampTape({ kind: k2, actor: "a", sessionId: sid, payload: {} });
          expect(r4).toBeNull();

          // Combined ledger counts should equal exactly 2.
          const combined =
            (await readTapeLedger(bp08Path)).length + (await readTapeLedger(bp03bPath)).length;
          expect(combined).toBe(2);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ── Property 4: NDJSON file integrity under parallel writes ─────────────────

describe("Property 4: NDJSON file integrity under parallel writes", () => {
  it("N concurrent stamps → file has N parseable lines, none interleaved", async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 2, max: 50 }), async (n) => {
        resetTapeStateForTests();

        const idxs = Array.from({ length: n }, (_, i) => i);
        await Promise.all(
          idxs.map((i) =>
            stampTape({
              kind: "BP08_PAYMENT_INTENT_CREATED",
              actor: "test",
              sessionId: `s${i}`,
              payload: { i, blob: `payload-${i}` },
            })
          )
        );

        // Raw read + parse line-by-line. Confirms no interleaving:
        // every line must independently parse as JSON.
        const raw = fs.readFileSync(bp08Path, "utf8");
        const lines = raw.split("\n").filter((l) => l.trim().length > 0);
        expect(lines.length).toBe(n);

        const parsed = lines.map((l) => JSON.parse(l));
        for (const r of parsed) {
          expect(r.kind).toBe("BP08_PAYMENT_INTENT_CREATED");
          expect(typeof r.payload.i).toBe("number");
        }

        // Every "i" 0..n-1 should be present exactly once (no lost writes).
        const seen = new Set<number>(parsed.map((r: { payload: { i: number } }) => r.payload.i));
        expect(seen.size).toBe(n);

        // bp03b ledger stays empty.
        expect((await readTapeLedger(bp03bPath)).length).toBe(0);
      }),
      { numRuns: 20 } // wider per-iteration work; 20 × 50 = 1000 writes max
    );
  }, 30000);
});

// ── Property 5: record schema invariant ─────────────────────────────────────

describe("Property 5: record schema invariant", () => {
  const ISO8601_RE =
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

  it("every persisted record has timestamp/kind/citation/actor/payload with correct shapes", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...ALL_KINDS),
        payloadArb,
        actorArb,
        async (kind, payload, actor) => {
          resetTapeStateForTests();
          const r = await stampTape({ kind, actor, payload });
          expect(r).not.toBeNull();

          // timestamp: valid ISO8601 (Date.toISOString format).
          expect(typeof r!.timestamp).toBe("string");
          expect(ISO8601_RE.test(r!.timestamp)).toBe(true);
          expect(Number.isFinite(Date.parse(r!.timestamp))).toBe(true);

          // kind: must be a known TAPE_STAMP_KINDS key.
          expect(Object.keys(TAPE_STAMP_KINDS)).toContain(r!.kind);

          // citation: must match the registry exactly.
          expect(r!.citation).toBe(TAPE_CITATIONS[r!.kind]);

          // actor: string | null.
          expect(r!.actor === null || typeof r!.actor === "string").toBe(true);

          // payload: object (never array, never null, never primitive).
          expect(typeof r!.payload).toBe("object");
          expect(r!.payload).not.toBeNull();
          expect(Array.isArray(r!.payload)).toBe(false);
        }
      ),
      { numRuns: 200 }
    );
  });
});

// ── Property 6: in-memory dedupe lifetime ───────────────────────────────────

describe("Property 6: sessionDedupe is in-memory and resetTapeStateForTests clears it", () => {
  it("after reset, the same (kind, sessionId) stamps again successfully", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...BP08_KINDS),
        sessionIdArb,
        async (kind, sid) => {
          resetTapeStateForTests();
          const r1 = await stampTape({ kind, actor: "x", sessionId: sid, payload: { v: 1 } });
          expect(r1).not.toBeNull();
          const dup = await stampTape({ kind, actor: "x", sessionId: sid, payload: { v: 2 } });
          expect(dup).toBeNull();

          // Reset clears the dedupe Set (and unlinks the ledger).
          resetTapeStateForTests();
          const r2 = await stampTape({ kind, actor: "x", sessionId: sid, payload: { v: 3 } });
          expect(r2).not.toBeNull();
          expect(r2!.payload).toEqual({ v: 3 });
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ── Property 7: ledger path runtime reconfig ────────────────────────────────

describe("Property 7: configureBp08LedgerPath redirects bp08.* writes", () => {
  it("for any custom path, bp08 stamps land there and original bp08 path stays untouched", async () => {
    await fc.assert(
      fc.asyncProperty(fc.constantFrom(...BP08_KINDS), payloadArb, async (kind, payload) => {
        resetTapeStateForTests();

        const customPath = tempLedger("bp08-custom");
        const previousBp08 = getBp08LedgerPath();
        configureBp08LedgerPath(customPath);

        try {
          const r = await stampTape({ kind, actor: "router", payload });
          expect(r).not.toBeNull();

          const customRecords = await readTapeLedger(customPath);
          expect(customRecords.length).toBe(1);
          expect(customRecords[0].kind).toBe(kind);

          // previous bp08 path must not have been written to.
          expect(fs.existsSync(previousBp08)).toBe(false);
        } finally {
          // restore + cleanup
          configureBp08LedgerPath(previousBp08);
          safeUnlink(customPath);
        }
      }),
      { numRuns: 50 }
    );
  });
});
