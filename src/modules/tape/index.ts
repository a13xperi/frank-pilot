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
  BP03B_PAYMENT_INITIATED: "bp03b.payment_initiated",
  BP03B_PAYMENT_SUCCEEDED: "bp03b.payment_succeeded",
  BP08_PAYMENT_INTENT_CREATED: "bp08.payment_intent_created",
  BP08_PAYMENT_SUCCEEDED: "bp08.payment_succeeded",
  BP08_PAYMENT_FAILED: "bp08.payment_failed",
  BP08_PAYMENT_REPLAY_BLOCKED: "bp08.payment_replay_blocked",
  BP08_PAYMENT_REFUND_REQUESTED: "bp08.payment_refund_requested",
  BP08_PAYMENT_REFUNDED: "bp08.payment_refunded",
  // Voice intake — HUD fair-housing audit trail anchors. Every completed
  // ElevenLabs Conv. AI intake stamps VOICE_INTAKE_COMPLETED; every Frank
  // decision (skipped item, escalation, hangup, language) stamps
  // VOICE_INTAKE_DECISION; every outbound AI call attempt stamps
  // VOICE_INTAKE_OUTBOUND_ATTEMPTED with the consent record id (TCPA PEWC).
  VOICE_INTAKE_COMPLETED: "voice_intake.completed",
  VOICE_INTAKE_DECISION: "voice_intake.decision",
  VOICE_INTAKE_OUTBOUND_ATTEMPTED: "voice_intake.outbound_attempted",
  // Outbound waitlist-validation call results (DM-FRANK-029): every post-call
  // webhook for the outbound validation agent stamps one of these with the
  // conversation id + mapped outcome — the audit anchor for "we called this
  // wait-list applicant and here is what came back".
  OUTBOUND_VALIDATION_CALL_COMPLETED: "outbound_validation.call_completed",
  // Voice agent in-call server-tool invocations. Every tool the agent fires
  // mid-call (send_app_link, lookup_tenant, file_maintenance_request,
  // file_compliance_report) stamps VOICE_TOOL_INVOKED with the tool name +
  // conversation id so the audit trail catches actions taken DURING the call,
  // not just the post-call summary.
  VOICE_TOOL_INVOKED: "voice_intake.tool_invoked",
  // "Talk to Frank" — in-browser WebRTC session lifecycle. STARTED stamps on
  // every successful signed-URL mint; DENIED stamps on rate-limit or daily
  // budget trip (mirrors the deny audit trail of the BP-08 payment loop).
  VOICE_BROWSER_SESSION_STARTED: "voice_intake.browser_session_started",
  VOICE_BROWSER_SESSION_DENIED: "voice_intake.browser_session_denied",
  // Concierge co-browse (Phase 2): consent + session lifecycle audit anchors.
  COBROWSE_CONSENT_CAPTURED: "cobrowse.consent_captured",
  COBROWSE_SESSION_STARTED: "cobrowse.session_started",
  COBROWSE_FIELD_FILLED: "cobrowse.field_filled",
  COBROWSE_CONFIRMED: "cobrowse.confirmed",
  COBROWSE_DENIED: "cobrowse.denied",
  COBROWSE_HANDED_OFF: "cobrowse.handed_off",
} as const;

export type TapeStampKind = keyof typeof TAPE_STAMP_KINDS;
export type TapeStampKindValue = (typeof TAPE_STAMP_KINDS)[TapeStampKind];

export const TAPE_CITATIONS: Record<TapeStampKind, string> = {
  WELCOME_LETTER_DELIVERED: "HUD 4350.3 Ch. 4-4",
  HUD_928_1_FAIR_HOUSING_POSTED: "24 CFR Part 110",
  WAITING_LIST_APP_CAPTURED: "HUD 4350.3 Ch. 4-6",
  HUD_92006_SUPPLEMENT_CAPTURED: "HUD-92006",
  POSITION_LETTER_SENT: "HUD 4350.3 Ch. 4-14 + 4-16",
  BP03B_PAYMENT_INITIATED: "HUD 4350.3 Ch. 4-6",
  BP03B_PAYMENT_SUCCEEDED: "HUD 4350.3 Ch. 4-6",
  BP08_PAYMENT_INTENT_CREATED: "HUD 4350.3 Ch. 4-6",
  BP08_PAYMENT_SUCCEEDED: "HUD 4350.3 Ch. 4-6",
  BP08_PAYMENT_FAILED: "HUD 4350.3 Ch. 4-6",
  BP08_PAYMENT_REPLAY_BLOCKED: "HUD 4350.3 Ch. 4-6",
  BP08_PAYMENT_REFUND_REQUESTED: "HUD 4350.3 Ch. 4-6",
  BP08_PAYMENT_REFUNDED: "HUD 4350.3 Ch. 4-6",
  // HUD 4350.3 Ch. 4-6 governs waiting-list application capture; FCC AI
  // disclosure + Nevada NRS 200.620 two-party consent share the same audit
  // anchor for the voice-channel intake.
  VOICE_INTAKE_COMPLETED: "HUD 4350.3 Ch. 4-6 / NRS 200.620",
  VOICE_INTAKE_DECISION: "HUD 4350.3 Ch. 4-6",
  VOICE_INTAKE_OUTBOUND_ATTEMPTED: "TCPA 47 CFR §64.1200(a)(2)",
  OUTBOUND_VALIDATION_CALL_COMPLETED: "TCPA 47 CFR §64.1200 / HUD 4350.3 Ch. 4-6",
  VOICE_TOOL_INVOKED: "HUD 4350.3 Ch. 4-6",
  VOICE_BROWSER_SESSION_STARTED: "HUD 4350.3 Ch. 4-6",
  VOICE_BROWSER_SESSION_DENIED: "HUD 4350.3 Ch. 4-6",
  COBROWSE_CONSENT_CAPTURED: "HUD 4350.3 Ch. 4-6 / NRS 200.620 / TCPA 47 CFR §64.1200",
  COBROWSE_SESSION_STARTED: "HUD 4350.3 Ch. 4-6 / NRS 200.620 / TCPA 47 CFR §64.1200",
  COBROWSE_FIELD_FILLED: "HUD 4350.3 Ch. 4-6 / NRS 200.620 / TCPA 47 CFR §64.1200",
  COBROWSE_CONFIRMED: "HUD 4350.3 Ch. 4-6 / NRS 200.620 / TCPA 47 CFR §64.1200",
  COBROWSE_DENIED: "HUD 4350.3 Ch. 4-6 / NRS 200.620 / TCPA 47 CFR §64.1200",
  COBROWSE_HANDED_OFF: "HUD 4350.3 Ch. 4-6 / NRS 200.620 / TCPA 47 CFR §64.1200",
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

const DEFAULT_BP08_LEDGER_PATH = path.resolve(
  process.cwd(),
  "server",
  "tape",
  "bp08.ndjson"
);

let ledgerPath = process.env.TAPE_LEDGER_PATH || DEFAULT_LEDGER_PATH;
let bp08LedgerPath = process.env.BP08_LEDGER_PATH || DEFAULT_BP08_LEDGER_PATH;

/** Idempotency cache: `${kind}:${sessionId}` → true. In-process only. */
const sessionDedupe = new Set<string>();

export function configureTapeLedgerPath(p: string): void {
  ledgerPath = p;
}

export function getTapeLedgerPath(): string {
  return ledgerPath;
}

export function configureBp08LedgerPath(p: string): void {
  bp08LedgerPath = p;
}

export function getBp08LedgerPath(): string {
  return bp08LedgerPath;
}

/**
 * BP-08 stamps go to their own ledger so the spec §8.1 audit slice stays
 * uncontaminated by BP-03b's scaffold stamps. Routing is by the kind's string
 * value, not by caller — any stamp whose value starts with `bp08.` lands in
 * the BP-08 ledger, everything else stays on the default ledger.
 */
function resolveLedgerPath(kindValue: string): string {
  return kindValue.startsWith("bp08.") ? bp08LedgerPath : ledgerPath;
}

export function resetTapeStateForTests(): void {
  sessionDedupe.clear();
  for (const p of [ledgerPath, bp08LedgerPath]) {
    try {
      if (fsSync.existsSync(p)) fsSync.unlinkSync(p);
    } catch {
      /* ignore */
    }
  }
}

async function ensureLedgerDir(targetPath: string): Promise<void> {
  const dir = path.dirname(targetPath);
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

    const kindValue = TAPE_STAMP_KINDS[input.kind];
    const record: TapeStampRecord = {
      timestamp: new Date().toISOString(),
      kind: input.kind,
      citation: TAPE_CITATIONS[input.kind],
      actor: input.actor,
      payload: input.payload ?? {},
      ...(input.sessionId ? { session_id: input.sessionId } : {}),
    };

    const targetPath = resolveLedgerPath(kindValue);
    await ensureLedgerDir(targetPath);
    await fs.appendFile(targetPath, JSON.stringify(record) + "\n", "utf8");
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
export async function readTapeLedger(targetPath?: string): Promise<TapeStampRecord[]> {
  try {
    const raw = await fs.readFile(targetPath ?? ledgerPath, "utf8");
    return raw
      .split("\n")
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l) as TapeStampRecord);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}
