/**
 * BP-02 Compliance Tape — JPM "gold standard" audit report.
 *
 * The PDF export (service.exportPdf) is the human-facing printout. THIS module
 * is the machine-checkable, structured audit artifact an institutional reviewer
 * (e.g. a JPM compliance desk) ingests: an ordered, HUD-cited transcript of the
 * chain plus a self-contained verification summary that lets the reviewer
 * confirm the ledger is intact WITHOUT trusting our app — every entry carries
 * its own hash + prev_hash, and the report restates the chaining rule.
 *
 * Pure + deterministic given (entries, verifyResult, generatedAt): no IO, no
 * clock unless `generatedAt` is omitted. That makes it snapshot-testable and
 * lets the service hand it straight to JSON.stringify for an export endpoint or
 * to a PDF renderer.
 *
 * Design choices:
 *  - The report does NOT re-verify; it takes the VerifyResult the service
 *    produced (single source of truth for "is the chain intact"). The caller
 *    (service.exportAuditReport) always verifies first, so the summary and the
 *    rows can never disagree.
 *  - Entries are emitted in chain order (by sequence ASC). repo.list already
 *    returns that order; we sort defensively so a mis-ordered input still
 *    yields a correctly ordered, auditable report (and the verify summary will
 *    independently flag the break).
 *  - A citation roll-up groups the events by HUD/CFR rule so a reviewer can see
 *    coverage at a glance ("every §5.508 obligation is represented N times").
 */

import type { TapeEntry, TapeScope, VerifyResult } from "./types";

/** The canonical chaining rule, restated in the report so an external auditor
 *  can reproduce the integrity check from the JSON alone. Keep in sync with the
 *  digest-input format documented in hashing.ts. */
export const AUDIT_REPORT_HASH_RULE =
  "entry_hash = SHA-256( uint64_be(sequence) || prev_hash(32B) || " +
  "canonicalJson(payload) || utf8(created_at) ); prev_hash[1] = 32 zero bytes; " +
  "prev_hash[n] = entry_hash[n-1].";

export const AUDIT_REPORT_VERSION = "bp02.audit-report.v1" as const;

/** One row of the audit transcript — a flattened, reviewer-facing projection of
 *  a TapeEntry. Field order is chosen for readability in the serialized JSON. */
export interface AuditReportEntry {
  sequence: number;
  kind: TapeEntry["kind"];
  /** HUD / CFR / state citation governing this event. */
  citation: string;
  createdAt: string;
  actorId: string | null;
  subjectId: string | null;
  /** Free-form, kind-specific attestation fields (payload.evidence), passed
   *  through verbatim so the auditor sees exactly what was attested. */
  evidence: Record<string, unknown>;
  prevHash: string;
  entryHash: string;
}

/** Coverage roll-up: how many entries cite each rule, with the kinds involved. */
export interface CitationCoverage {
  citation: string;
  count: number;
  kinds: string[];
}

/** The verification block — a restatement of the service's VerifyResult plus
 *  the human/auditor-facing integrity statement. */
export interface AuditVerification {
  /** True iff the whole in-scope chain hashes clean. */
  intact: boolean;
  entryCount: number;
  /** Highest sequence verified (0 for an empty chain). */
  lastSequence: number;
  /** entry_hash of the final entry — the single value that pins the whole
   *  chain. Null for an empty chain. */
  headHash: string | null;
  /** Sequence of the first break, when intact=false. */
  brokeAt?: number;
  /** Human-readable reason for a break, when intact=false. */
  reason?: string;
  /** The chaining rule, restated so the report is self-verifying. */
  hashRule: string;
  /** One-line attestation suitable for the top of the printout. */
  statement: string;
}

/** The full audit report object. JSON-serializable; this is the export shape. */
export interface AuditReport {
  reportVersion: typeof AUDIT_REPORT_VERSION;
  generatedAt: string;
  scope: TapeScope;
  /** Human label for the scope (e.g. "Applicant <id>" / "Global scope"). */
  scopeLabel: string;
  verification: AuditVerification;
  /** Distinct rules cited across the chain, sorted, with counts. */
  citationCoverage: CitationCoverage[];
  /** The chain, in sequence order. */
  entries: AuditReportEntry[];
}

function scopeLabelFor(scope: TapeScope): string {
  return scope.type === "applicant"
    ? `Applicant ${scope.applicantId}`
    : "Global scope";
}

function toReportEntry(entry: TapeEntry): AuditReportEntry {
  const evidence =
    entry.payload && typeof entry.payload.evidence === "object" && entry.payload.evidence !== null
      ? (entry.payload.evidence as Record<string, unknown>)
      : {};
  return {
    sequence: entry.sequence,
    kind: entry.kind,
    citation: entry.citation,
    createdAt: entry.createdAt,
    actorId: entry.payload?.actorId ?? null,
    subjectId: entry.payload?.subjectId ?? null,
    evidence,
    prevHash: entry.prevHash,
    entryHash: entry.entryHash,
  };
}

/** Build the citation coverage roll-up, sorted by citation for determinism. */
function buildCitationCoverage(entries: TapeEntry[]): CitationCoverage[] {
  const byCitation = new Map<string, { count: number; kinds: Set<string> }>();
  for (const e of entries) {
    const bucket = byCitation.get(e.citation) ?? { count: 0, kinds: new Set<string>() };
    bucket.count += 1;
    bucket.kinds.add(e.kind);
    byCitation.set(e.citation, bucket);
  }
  return Array.from(byCitation.entries())
    .map(([citation, { count, kinds }]) => ({
      citation,
      count,
      kinds: Array.from(kinds).sort(),
    }))
    .sort((a, b) => a.citation.localeCompare(b.citation));
}

function verificationStatement(intact: boolean, count: number, broke?: number): string {
  if (intact) {
    return `VERIFIED: all ${count} ledger entries form an unbroken SHA-256 hash chain; no tampering detected.`;
  }
  return `INTEGRITY FAILURE: the hash chain is broken at sequence ${broke ?? "?"}; this ledger CANNOT be relied upon as tamper-evident.`;
}

/**
 * Assemble the JPM gold-standard audit report from the chain entries and the
 * verification result the service already computed.
 *
 * @param scope         the scope the entries belong to (echoed into the report)
 * @param entries       chain entries (any order — sorted by sequence here)
 * @param verifyResult  result of service.verify(scope) for the SAME entries
 * @param generatedAt   ISO timestamp to stamp the report (defaults to now)
 */
export function buildAuditReport(
  scope: TapeScope,
  entries: TapeEntry[],
  verifyResult: VerifyResult,
  generatedAt: string = new Date().toISOString()
): AuditReport {
  // Defensive copy + chain ordering. repo.list already returns sequence ASC,
  // but the report is an evidentiary artifact, so we don't trust input order.
  const ordered = [...entries].sort((a, b) => a.sequence - b.sequence);

  const headHash =
    ordered.length > 0 ? ordered[ordered.length - 1]!.entryHash : null;

  const verification: AuditVerification = {
    intact: verifyResult.ok,
    entryCount: ordered.length,
    lastSequence: verifyResult.lastSequence,
    headHash,
    hashRule: AUDIT_REPORT_HASH_RULE,
    statement: verificationStatement(
      verifyResult.ok,
      ordered.length,
      verifyResult.brokeAt
    ),
    ...(verifyResult.ok
      ? {}
      : { brokeAt: verifyResult.brokeAt, reason: verifyResult.reason }),
  };

  return {
    reportVersion: AUDIT_REPORT_VERSION,
    generatedAt,
    scope,
    scopeLabel: scopeLabelFor(scope),
    verification,
    citationCoverage: buildCitationCoverage(ordered),
    entries: ordered.map(toReportEntry),
  };
}
