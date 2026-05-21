/**
 * BP-02 Compliance Tape — minimal placeholder.
 *
 * IMPORTANT: This is a stub. Canonical BP-02 has not landed. When it does,
 * replace `stampTape` with the real helper and migrate the NDJSON ledger.
 *
 * Until then this module ships an append-only NDJSON ledger so BP-03b
 * touchpoints can wire stamps now without blocking on BP-02.
 *
 * Ledger format (one JSON object per line):
 *   { timestamp, kind, citation, actor, payload, session_id? }
 *
 * Stamps wired by BP-03b (HUD-cited):
 *   - WELCOME_LETTER_DELIVERED        HUD 4350.3 Ch. 4-4
 *   - HUD_928_1_FAIR_HOUSING_POSTED   24 CFR Part 110
 *   - WAITING_LIST_APP_CAPTURED       HUD 4350.3 Ch. 4-6
 *   - HUD_92006_SUPPLEMENT_CAPTURED   HUD-92006
 *   - POSITION_LETTER_SENT            HUD 4350.3 Ch. 4-14 + 4-16
 */

import { promises as fs } from "fs";
import * as fsSync from "fs";
import * as path from "path";
import { logger } from "../../utils/logger";

export const TAPE_STAMP_KINDS = {
  WELCOME_LETTER_DELIVERED: "WELCOME_LETTER_DELIVERED",
  HUD_928_1_FAIR_HOUSING_POSTED: "HUD_928_1_FAIR_HOUSING_POSTED",
  WAITING_LIST_APP_CAPTURED: "WAITING_LIST_APP_CAPTURED",
  HUD_92006_SUPPLEMENT_CAPTURED: "HUD_92006_SUPPLEMENT_CAPTURED",
  POSITION_LETTER_SENT: "POSITION_LETTER_SENT",
} as const;

export type TapeStampKind = keyof typeof TAPE_STAMP_KINDS;

export const TAPE_CITATIONS: Record<TapeStampKind, string> = {
  WELCOME_LETTER_DELIVERED: "HUD 4350.3 Ch. 4-4",
  HUD_928_1_FAIR_HOUSING_POSTED: "24 CFR Part 110",
  WAITING_LIST_APP_CAPTURED: "HUD 4350.3 Ch. 4-6",
  HUD_92006_SUPPLEMENT_CAPTURED: "HUD-92006",
  POSITION_LETTER_SENT: "HUD 4350.3 Ch. 4-14 + 4-16",
};

export interface TapeStampInput {
  kind: TapeStampKind;
  actor: string | null;
  payload?: Record<string, unknown>;
  /** Idempotency key — if provided, dedupes within the session/process lifetime. */
  sessionId?: string;
}

export interface TapeStampRecord {
  timestamp: string;
  kind: TapeStampKind;
  citation: string;
  actor: string | null;
  payload: Record<string, unknown>;
  session_id?: string;
}

const DEFAULT_LEDGER_PATH = path.resolve(
  process.cwd(),
  "server",
  "tape",
  "bp03b.ndjson"
);

let ledgerPath = process.env.TAPE_LEDGER_PATH || DEFAULT_LEDGER_PATH;

/** Idempotency cache: `${kind}:${sessionId}` → true. In-process only. */
const sessionDedupe = new Set<string>();

export function configureTapeLedgerPath(p: string): void {
  ledgerPath = p;
}

export function getTapeLedgerPath(): string {
  return ledgerPath;
}

export function resetTapeStateForTests(): void {
  sessionDedupe.clear();
  try {
    if (fsSync.existsSync(ledgerPath)) fsSync.unlinkSync(ledgerPath);
  } catch {
    /* ignore */
  }
}

async function ensureLedgerDir(): Promise<void> {
  const dir = path.dirname(ledgerPath);
  await fs.mkdir(dir, { recursive: true });
}

/**
 * Append a stamp to the BP-03b compliance ledger. Best-effort: a write
 * failure is logged but does not throw. Touchpoint code MUST NOT depend on
 * this succeeding (we are not blocking applicant flow on the tape stub).
 *
 * If `sessionId` is set and a stamp of the same `kind` has already been
 * emitted for that session in this process, the call is a no-op (returns
 * the prior record). Used for HUD-928.1 page-view idempotency.
 */
export async function stampTape(input: TapeStampInput): Promise<TapeStampRecord | null> {
  try {
    if (input.sessionId) {
      const key = `${input.kind}:${input.sessionId}`;
      if (sessionDedupe.has(key)) return null;
      sessionDedupe.add(key);
    }

    const record: TapeStampRecord = {
      timestamp: new Date().toISOString(),
      kind: input.kind,
      citation: TAPE_CITATIONS[input.kind],
      actor: input.actor,
      payload: input.payload ?? {},
      ...(input.sessionId ? { session_id: input.sessionId } : {}),
    };

    await ensureLedgerDir();
    await fs.appendFile(ledgerPath, JSON.stringify(record) + "\n", "utf8");
    logger.info("Tape stamp written", { kind: record.kind, citation: record.citation });
    return record;
  } catch (err) {
    logger.error("Tape stamp failed", {
      kind: input.kind,
      error: (err as Error).message,
    });
    return null;
  }
}

/** Read every stamp written so far. Test/audit helper — do not call in hot paths. */
export async function readTapeLedger(): Promise<TapeStampRecord[]> {
  try {
    const raw = await fs.readFile(ledgerPath, "utf8");
    return raw
      .split("\n")
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l) as TapeStampRecord);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}
