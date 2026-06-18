/**
 * BP-02 Compliance Tape — JPM "gold standard" audit report tests.
 *
 * Covers the four behaviors required of the audit-export slice:
 *   1. append          — stamps land on the chain and appear in the report
 *   2. verify-pass     — a clean chain reports intact:true with the head hash
 *   3. verify-fail     — a mutated chain reports intact:false + brokeAt in the
 *                        report's verification summary (export reflects tamper)
 *   4. export shape    — the report has the documented JPM structure: ordered
 *                        HUD-cited entries, citation coverage roll-up, the
 *                        restated hash rule, and a self-verifying summary.
 *
 * Uses the real createTapeService(repo) factory + an in-memory repository so
 * nothing touches Postgres (mirrors service.spec.ts / replay.spec.ts).
 */

import { randomUUID } from "node:crypto";
import { createTapeService, type TapeService } from "../service";
import {
  AUDIT_REPORT_HASH_RULE,
  AUDIT_REPORT_VERSION,
  buildAuditReport,
} from "../audit-report";
import type {
  TapeEntry,
  TapeEvent,
  TapeJsonLdPayload,
  TapeRepository,
  TapeScope,
} from "../types";
import { TAPE_CITATIONS } from "../types";

// ── In-memory fake repository (same shape as service.spec.ts) ─────────────────

class InMemoryTapeRepository implements TapeRepository {
  private store = new Map<string, TapeEntry[]>();

  private scopeKey(scope: TapeScope): string {
    if (scope.type === "applicant") return `applicant:${scope.applicantId}`;
    return "global";
  }

  async insert(
    row: Omit<TapeEntry, "id" | "createdAt"> & { createdAt: string }
  ): Promise<TapeEntry> {
    const entry: TapeEntry = { ...row, id: randomUUID() };
    const key = this.scopeKey(
      row.applicantId
        ? { type: "applicant", applicantId: row.applicantId }
        : { type: "global" }
    );
    const list = this.store.get(key) ?? [];
    list.push(entry);
    this.store.set(key, list);
    return entry;
  }

  async tail(scope: TapeScope): Promise<TapeEntry | null> {
    const key = this.scopeKey(scope);
    const list = this.store.get(key) ?? [];
    return list.length > 0 ? list[list.length - 1]! : null;
  }

  async list(
    scope: TapeScope,
    opts?: { limit?: number; afterSequence?: number }
  ): Promise<TapeEntry[]> {
    const key = this.scopeKey(scope);
    let entries = this.store.get(key) ?? [];
    if (opts?.afterSequence !== undefined) {
      entries = entries.filter((e) => e.sequence > opts.afterSequence!);
    }
    if (opts?.limit !== undefined) {
      entries = entries.slice(0, opts.limit);
    }
    return entries;
  }

  /** Test helper: tamper with a stored entry's payload (hash not updated). */
  mutateEntryPayload(
    scope: TapeScope,
    sequence: number,
    newPayload: TapeJsonLdPayload
  ): void {
    const key = this.scopeKey(scope);
    const list = this.store.get(key);
    if (!list) throw new Error("scope not found");
    const entry = list.find((e) => e.sequence === sequence);
    if (!entry) throw new Error(`sequence ${sequence} not found`);
    entry.payload = newPayload;
  }
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const APPLY_KINDS: Array<keyof typeof TAPE_CITATIONS> = [
  "WELCOME_LETTER_DELIVERED",
  "HUD_928_1_FAIR_HOUSING_POSTED",
  "WAITING_LIST_APP_CAPTURED",
  "HUD_92006_SUPPLEMENT_CAPTURED",
  "POSITION_LETTER_SENT",
];

function makeEvent(
  kind: keyof typeof TAPE_CITATIONS,
  subjectId: string,
  evidence: Record<string, unknown> = {}
): TapeEvent {
  return {
    kind,
    payload: {
      "@context": "https://frank-pilot.example/compliance-tape/v1",
      "@type": `ComplianceEvent.${kind}`,
      actorId: "operator-007",
      subjectId,
      ruleCitation: TAPE_CITATIONS[kind],
      evidence,
    },
  };
}

async function stampApplyChain(
  service: TapeService,
  applicantId: string
): Promise<TapeEntry[]> {
  const entries: TapeEntry[] = [];
  for (const kind of APPLY_KINDS) {
    entries.push(
      await service.stamp(makeEvent(kind, applicantId, { kindTag: kind }))
    );
  }
  return entries;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Compliance tape — JPM audit report", () => {
  let repo: InMemoryTapeRepository;
  let service: TapeService;

  beforeEach(() => {
    repo = new InMemoryTapeRepository();
    service = createTapeService(repo);
  });

  // 1. append
  it("append: every stamped event appears in the report in chain order", async () => {
    const applicantId = "applicant-audit-append";
    const scope: TapeScope = { type: "applicant", applicantId };
    await stampApplyChain(service, applicantId);

    const report = await service.exportAuditReport(scope);

    expect(report.entries).toHaveLength(APPLY_KINDS.length);
    expect(report.entries.map((e) => e.sequence)).toEqual([1, 2, 3, 4, 5]);
    expect(report.entries.map((e) => e.kind)).toEqual(APPLY_KINDS);
    // Each entry is HUD-cited.
    for (const e of report.entries) {
      expect(e.citation).toBe(TAPE_CITATIONS[e.kind]);
      expect(e.citation.length).toBeGreaterThan(0);
    }
  });

  // 2. verify-pass
  it("verify-pass: a clean chain reports intact:true with the head hash and lastSequence", async () => {
    const applicantId = "applicant-audit-clean";
    const scope: TapeScope = { type: "applicant", applicantId };
    const entries = await stampApplyChain(service, applicantId);

    const report = await service.exportAuditReport(scope);

    expect(report.verification.intact).toBe(true);
    expect(report.verification.entryCount).toBe(5);
    expect(report.verification.lastSequence).toBe(5);
    expect(report.verification.headHash).toBe(entries[entries.length - 1]!.entryHash);
    expect(report.verification.brokeAt).toBeUndefined();
    expect(report.verification.statement).toMatch(/^VERIFIED:/);
  });

  // 3. verify-fail-on-mutation
  it("verify-fail: a mutated chain reports intact:false + brokeAt in the export", async () => {
    const applicantId = "applicant-audit-tampered";
    const scope: TapeScope = { type: "applicant", applicantId };
    await stampApplyChain(service, applicantId);

    // Tamper with sequence 3 without recomputing its hash.
    repo.mutateEntryPayload(scope, 3, {
      "@context": "https://frank-pilot.example/compliance-tape/v1",
      "@type": "ComplianceEvent.TAMPERED",
      actorId: null,
      subjectId: "attacker",
      ruleCitation: "FAKE",
      evidence: { tampered: true },
    });

    const report = await service.exportAuditReport(scope);

    expect(report.verification.intact).toBe(false);
    expect(report.verification.brokeAt).toBe(3);
    expect(typeof report.verification.reason).toBe("string");
    expect(report.verification.reason!.length).toBeGreaterThan(0);
    expect(report.verification.statement).toMatch(/INTEGRITY FAILURE/);
  });

  // 4. export shape
  it("export shape: the report carries the documented JPM structure", async () => {
    const applicantId = "applicant-audit-shape";
    const scope: TapeScope = { type: "applicant", applicantId };
    await stampApplyChain(service, applicantId);

    const report = await service.exportAuditReport(scope);

    // Top-level shape.
    expect(report.reportVersion).toBe(AUDIT_REPORT_VERSION);
    expect(typeof report.generatedAt).toBe("string");
    expect(report.scope).toEqual(scope);
    expect(report.scopeLabel).toBe(`Applicant ${applicantId}`);

    // Verification block restates the chaining rule so the artifact is
    // self-verifying without the app.
    expect(report.verification.hashRule).toBe(AUDIT_REPORT_HASH_RULE);

    // Citation coverage roll-up: every entry's citation is represented, counts
    // sum to the entry count, and the list is sorted by citation.
    const totalFromCoverage = report.citationCoverage.reduce(
      (n, c) => n + c.count,
      0
    );
    expect(totalFromCoverage).toBe(report.entries.length);
    const citationsSorted = [...report.citationCoverage]
      .map((c) => c.citation)
      .sort((a, b) => a.localeCompare(b));
    expect(report.citationCoverage.map((c) => c.citation)).toEqual(
      citationsSorted
    );

    // Each entry exposes the auditor-facing projection fields.
    for (const e of report.entries) {
      expect(e).toEqual(
        expect.objectContaining({
          sequence: expect.any(Number),
          kind: expect.any(String),
          citation: expect.any(String),
          createdAt: expect.any(String),
          prevHash: expect.any(String),
          entryHash: expect.any(String),
        })
      );
      expect(e.prevHash).toMatch(/^[0-9a-f]{64}$/);
      expect(e.entryHash).toMatch(/^[0-9a-f]{64}$/);
    }

    // The whole report must round-trip through JSON (it's an export artifact).
    expect(() => JSON.parse(JSON.stringify(report))).not.toThrow();
  });

  it("empty scope: report is intact with zero entries and a null head hash", async () => {
    const scope: TapeScope = { type: "applicant", applicantId: "nobody" };
    const report = await service.exportAuditReport(scope);

    expect(report.entries).toHaveLength(0);
    expect(report.verification.intact).toBe(true);
    expect(report.verification.entryCount).toBe(0);
    expect(report.verification.lastSequence).toBe(0);
    expect(report.verification.headHash).toBeNull();
    expect(report.citationCoverage).toEqual([]);
  });

  it("buildAuditReport sorts mis-ordered entries by sequence (evidentiary ordering)", () => {
    // Direct unit test of the pure builder: feed entries out of order and a
    // clean verify result; the report must still emit them in sequence order.
    const scope: TapeScope = { type: "global" };
    const mk = (sequence: number): TapeEntry => ({
      id: randomUUID(),
      sequence,
      kind: "acq.award_recorded",
      citation: TAPE_CITATIONS["acq.award_recorded"],
      applicantId: null,
      payload: {
        "@context": "x",
        "@type": "y",
        actorId: null,
        subjectId: null,
        ruleCitation: TAPE_CITATIONS["acq.award_recorded"],
      },
      prevHash: "0".repeat(64),
      entryHash: "a".repeat(64),
      createdAt: new Date().toISOString(),
      sessionId: null,
    });
    const report = buildAuditReport(
      scope,
      [mk(3), mk(1), mk(2)],
      { ok: true, scope, lastSequence: 3 },
      "2026-06-18T00:00:00.000Z"
    );
    expect(report.entries.map((e) => e.sequence)).toEqual([1, 2, 3]);
    expect(report.generatedAt).toBe("2026-06-18T00:00:00.000Z");
    expect(report.scopeLabel).toBe("Global scope");
  });
});
