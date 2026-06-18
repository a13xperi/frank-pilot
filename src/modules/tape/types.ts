/**
 * BP-02 Compliance Tape — shared types.
 *
 * Contract file: every Phase-1 lane imports from here. Do not change shapes
 * without updating docs/bp-02-contracts.md and notifying every lane owner.
 */

/** Discriminator for every kind of event the tape records. Keep in sync with
 *  the `kind` column on `compliance_tape`. Strings, not enums, so payload
 *  makers (Lane C) can be authored as plain modules. */
export type TapeStampKind =
  // BP-03 / BP-03b applicant flow stamps (already wired via stub)
  | "WELCOME_LETTER_DELIVERED"
  | "HUD_928_1_FAIR_HOUSING_POSTED"
  | "WAITING_LIST_APP_CAPTURED"
  | "HUD_92006_SUPPLEMENT_CAPTURED"
  | "POSITION_LETTER_SENT"
  | "bp03b.payment_initiated"
  | "bp03b.payment_succeeded"
  // BP-02 v2 additions — auth, magic-link, application lifecycle
  | "auth.login"
  | "auth.magic_link_issued"
  | "auth.magic_link_consumed"
  | "auth.email_verified"
  | "application.submitted"
  | "application.advanced"
  | "unit.claimed"
  // Lease e-signature (native) — tenant executes the lease
  | "LEASE_EXECUTED"
  // QAP acquisitions Phase 3 (Compliance Bridge) — global-scope admin events
  | "acq.award_recorded"
  | "acq.units_designated"
  // QAP acquisitions Phase 3.1 — recert income-ceiling enforcement (subject = recert)
  | "acq.recert_income_checked"
  // QAP acquisitions Phase 3.2 — Next Available Unit Rule (global-scope admin events)
  | "acq.nau_triggered"
  | "acq.nau_satisfied"
  | "acq.nau_lost"
  // Screening pipeline — application_status transitions (screening on funnel)
  | "screening.state_transition"
  // Unit-identity Phase B (WS-3) — UNIT-scoped chain. Anchors a unit's identity
  // (lot/parcel/permit/external uid + LIHTC §42 BIN) onto its own hash chain,
  // separate from the applicant/global chains.
  | "unit.identity_anchored";

/** A JSON-LD payload. Lane C provides one `make<Event>Payload` per kind.
 *  The `@context` URL is stubbed in v1 (see docs/bp-02-contracts.md §5). */
export interface TapeJsonLdPayload {
  "@context": string | string[];
  "@type": string;
  /** Who took the action (user id, system id, or "anonymous"). */
  actorId: string | null;
  /** What the action was about (applicant id, unit id, …). Used for scoped
   *  reads — BP-19 viewer filters by this. */
  subjectId: string | null;
  /** HUD / CFR / state rule citation, e.g. "HUD 4350.3 Ch. 4-4". */
  ruleCitation: string;
  /** Free-form, kind-specific fields. Validated per-kind in Lane C. */
  evidence?: Record<string, unknown>;
  /** LIHTC §42 Building Identification Number, when a stamp scopes to a specific
   *  building/unit. Emitted by unit-scoped makers (Phase B / WS-3, e.g.
   *  `unit.identity_anchored`); optional and absent on applicant/global stamps. */
  bin?: string;
  /** Unit-identity Phase B (WS-3): the `units(id)` a unit-scoped stamp is about.
   *  Read by service.stamp() to derive the unit scope when no explicit scope is
   *  passed. Absent on applicant/global stamps. */
  unitId?: string;
  /** Any other JSON-LD fields the kind needs. */
  [extra: string]: unknown;
}

/** Caller-facing input to the tape service. Sequence + hashes are assigned
 *  by the service, not the caller. */
export interface TapeEvent {
  kind: TapeStampKind;
  /** JSON-LD payload (built by Lane C makers). */
  payload: TapeJsonLdPayload;
  /** Optional idempotency key — preserve current stub's session-dedup behavior
   *  during cutover. Implemented via UNIQUE (kind, session_id) constraint. */
  sessionId?: string;
  /** Unit-identity Phase B (WS-3): explicit target chain. When set it WINS over
   *  the legacy subjectId→applicant/global derivation, letting unit-scoped makers
   *  (and dual-writers) append onto a `{ type: "unit"; unitId }` chain. Omit it
   *  and stamp() preserves the exact pre-existing applicant/global behavior. */
  scope?: TapeScope;
}

/** What `verify` and `list` return per row. Mirrors the `compliance_tape`
 *  table columns 1:1. */
export interface TapeEntry {
  id: string;
  /** Monotonically increasing per scope. v1 scope = per-applicant. */
  sequence: number;
  kind: TapeStampKind;
  citation: string;
  /** Per Lane A schema: applicant_id is the scope key for v1.
   *  Null = global / un-scoped (rare; admin events) — or unit-scoped, in which
   *  case `subjectUnitId` carries the scope key instead. */
  applicantId: string | null;
  /** Unit-identity Phase B scope key: `units(id)` for a UNIT-scoped chain.
   *  Mutually exclusive with `applicantId` (DB CHECK compliance_tape_scope_exclusive).
   *  Null on applicant- and global-scoped rows. */
  subjectUnitId: string | null;
  payload: TapeJsonLdPayload;
  /** SHA-256 of the previous entry's `entryHash`. Hex string (64 chars). */
  prevHash: string;
  /** SHA-256 of this entry. Hex string (64 chars). */
  entryHash: string;
  createdAt: string;
  sessionId: string | null;
}

/** Verifier output. `ok: true` means the entire chain in scope hashes clean;
 *  `ok: false` returns `brokeAt` (sequence number of the first mismatch). */
export interface VerifyResult {
  ok: boolean;
  scope: TapeScope;
  lastSequence: number;
  /** Sequence number where verification failed. Only set when ok=false. */
  brokeAt?: number;
  /** Human-readable explanation. Only set when ok=false. */
  reason?: string;
}

/** Scope of a tape read / verify. v1 implements `applicant`; `global` returns
 *  501 in v1 (Lane D). Unit-identity Phase B (WS-3) adds `unit`: a forward-only,
 *  unit-scoped hash chain keyed on `compliance_tape.subject_unit_id`
 *  (`units(id)`), independent from the applicant + global chains. */
export type TapeScope =
  | { type: "applicant"; applicantId: string }
  | { type: "unit"; unitId: string }
  | { type: "global" };

/** Internal helper passed to hashing.ts. Not exported to callers. */
export interface HashChainLink {
  sequence: number;
  /** 32-byte buffer. Use `GENESIS_HASH` for sequence=1. */
  prevHash: Buffer;
  payload: TapeJsonLdPayload;
  /** ISO 8601 string written into the row's `created_at`. */
  createdAt: string;
}

/** Repository interface — Lane B writes the service against this; Lane A
 *  swaps in the Postgres-backed impl during integration. */
export interface TapeRepository {
  /** Append a new row. Service computes sequence + hashes before calling. */
  insert(row: Omit<TapeEntry, "id" | "createdAt"> & { createdAt: string }): Promise<TapeEntry>;
  /** Most recent entry in a scope, or null if scope is empty. Used to seed
   *  prevHash + sequence for the next insert. */
  tail(scope: TapeScope): Promise<TapeEntry | null>;
  /** Read entries in a scope, oldest first. Used by verify() and the BP-19 viewer. */
  list(scope: TapeScope, opts?: { limit?: number; afterSequence?: number }): Promise<TapeEntry[]>;
}

/** HUD / CFR rule citations — single source of truth, imported by Lane C. */
export const TAPE_CITATIONS: Record<TapeStampKind, string> = {
  WELCOME_LETTER_DELIVERED: "HUD 4350.3 Ch. 4-4",
  HUD_928_1_FAIR_HOUSING_POSTED: "24 CFR Part 110",
  WAITING_LIST_APP_CAPTURED: "HUD 4350.3 Ch. 4-6",
  HUD_92006_SUPPLEMENT_CAPTURED: "HUD-92006",
  POSITION_LETTER_SENT: "HUD 4350.3 Ch. 4-14 + 4-16",
  "bp03b.payment_initiated": "HUD 4350.3 Ch. 4-6",
  "bp03b.payment_succeeded": "HUD 4350.3 Ch. 4-6",
  "auth.login": "24 CFR 5.216",
  "auth.magic_link_issued": "24 CFR 5.216",
  "auth.magic_link_consumed": "24 CFR 5.216",
  "auth.email_verified": "24 CFR 5.216",
  "application.submitted": "HUD 4350.3 Ch. 4-6",
  "application.advanced": "HUD 4350.3 Ch. 4-14",
  "unit.claimed": "HUD 4350.3 Ch. 4-14",
  LEASE_EXECUTED: "HUD 4350.3 Ch. 6-5 + 15 U.S.C. 7001 (ESIGN)",
  "acq.award_recorded": "IRC §42 + NV 2026 QAP §3",
  "acq.units_designated": "IRC §42(g) + 26 CFR 1.42-5 (LURA)",
  "acq.recert_income_checked": "IRC §42(g)(2)(D)(ii) (Available Unit Rule) + 26 CFR 1.42-5",
  "acq.nau_triggered": "IRC §42(g)(2)(D)(ii) (Next Available Unit Rule)",
  "acq.nau_satisfied": "IRC §42(g)(2)(D)(ii) (Next Available Unit Rule)",
  "acq.nau_lost": "IRC §42(g)(2)(D)(ii) (Next Available Unit Rule)",
  "screening.state_transition": "FCRA 15 U.S.C. §1681b + HUD 4350.3 Ch. 4",
  "unit.identity_anchored": "IRC §42 + 26 CFR 1.42-5",
};

/** Feature flag controlling dual-write during cutover. When false, the new
 *  `stamp()` is a no-op and the legacy NDJSON writer is the only path. */
export const COMPLIANCE_TAPE_V2_FLAG = "COMPLIANCE_TAPE_V2_ENABLED" as const;
