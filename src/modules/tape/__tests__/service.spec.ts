/**
 * BP-02 Compliance Tape — service contract tests.
 *
 * Validates the TapeService contract (src/modules/tape/service.ts, Lane B):
 * the hash-chain stamp() sequence/prevHash/entryHash invariants and verify()'s
 * detection of payload mutation and fabricated entries.
 *
 * Lane B exports a FACTORY — createTapeService(repo) — not a class, so the
 * suite constructs the service via the factory against an in-memory repository
 * fake that mirrors the TapeRepository interface exactly. No IO, no database.
 *
 * Scope note: the real stamp() resolves scope from event.payload.subjectId
 * (the applicant id), so each fixture event's subjectId MUST match the scope it
 * is later verified / mutated under.
 */

import { randomUUID } from "node:crypto";
import { computeEntryHash, GENESIS_HASH, hashToHex } from "../hashing";
import { createTapeService } from "../service";
import type { TapeService } from "../service";
import type {
  TapeEntry,
  TapeEvent,
  TapeRepository,
  TapeScope,
  TapeJsonLdPayload,
} from "../types";
import { TAPE_CITATIONS } from "../types";

// ── In-memory fake repository ─────────────────────────────────────────────────

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

  /** Test helper: mutate a stored entry's payload to simulate tampering. */
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

  /** Test helper: inject a fabricated entry with a wrong prevHash. */
  injectFabricatedEntry(scope: TapeScope, entry: TapeEntry): void {
    const key = this.scopeKey(scope);
    const list = this.store.get(key) ?? [];
    list.push(entry);
    this.store.set(key, list);
  }
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeEvent(
  kind: keyof typeof TAPE_CITATIONS = "WELCOME_LETTER_DELIVERED",
  subjectId = "applicant-001"
): TapeEvent {
  return {
    kind,
    payload: {
      "@context": "https://frank-pilot.example/compliance-tape/v1",
      "@type": `ComplianceEvent.${kind}`,
      actorId: null,
      subjectId,
      ruleCitation: TAPE_CITATIONS[kind],
    },
  };
}

function makeScope(applicantId: string): TapeScope {
  return { type: "applicant", applicantId };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("TapeService", () => {
  describe("stamp()", () => {
    let repo: InMemoryTapeRepository;
    let service: TapeService;

    beforeEach(() => {
      repo = new InMemoryTapeRepository();
      service = createTapeService(repo);
    });

    it("first stamp on an empty scope: sequence=1, prevHash=GENESIS_HASH hex, entryHash matches computeEntryHash", async () => {
      const event = makeEvent("WELCOME_LETTER_DELIVERED");

      const entry: TapeEntry = await service.stamp(event);

      expect(entry.sequence).toBe(1);
      expect(entry.prevHash).toBe(GENESIS_HASH.toString("hex"));
      expect(entry.prevHash).toBe(
        "0000000000000000000000000000000000000000000000000000000000000000"
      );

      // Recompute the hash ourselves and verify it matches.
      const expected = hashToHex(
        computeEntryHash({
          sequence: 1,
          prevHash: GENESIS_HASH,
          payload: entry.payload,
          createdAt: entry.createdAt,
        })
      );
      expect(entry.entryHash).toBe(expected);
    });

    it("second stamp: sequence=2, prevHash=first entry's entryHash, entryHash recomputable", async () => {
      // Both events default to subjectId "applicant-001", so both resolve to the
      // same applicant scope and chain together.
      const first = await service.stamp(makeEvent("WELCOME_LETTER_DELIVERED"));
      const second = await service.stamp(
        makeEvent("HUD_928_1_FAIR_HOUSING_POSTED")
      );

      expect(second.sequence).toBe(2);
      expect(second.prevHash).toBe(first.entryHash);

      const expected = hashToHex(
        computeEntryHash({
          sequence: 2,
          prevHash: Buffer.from(first.entryHash, "hex"),
          payload: second.payload,
          createdAt: second.createdAt,
        })
      );
      expect(second.entryHash).toBe(expected);
    });

    it("scopes are independent: stamping for applicantA does NOT affect applicantB's sequence", async () => {
      // Scope is resolved from each event's subjectId.
      await service.stamp(makeEvent("WELCOME_LETTER_DELIVERED", "applicant-A"));
      await service.stamp(
        makeEvent("HUD_928_1_FAIR_HOUSING_POSTED", "applicant-A")
      );
      await service.stamp(
        makeEvent("WAITING_LIST_APP_CAPTURED", "applicant-A")
      );

      const firstB = await service.stamp(
        makeEvent("WELCOME_LETTER_DELIVERED", "applicant-B")
      );

      // B's first stamp must start at sequence=1 regardless of A's chain.
      expect(firstB.sequence).toBe(1);
      expect(firstB.prevHash).toBe(GENESIS_HASH.toString("hex"));
    });
  });

  describe("verify()", () => {
    let repo: InMemoryTapeRepository;
    let service: TapeService;

    beforeEach(() => {
      repo = new InMemoryTapeRepository();
      service = createTapeService(repo);
    });

    it("verify() on a clean 5-entry chain returns {ok:true, lastSequence:5}", async () => {
      const applicantId = "applicant-verify-clean";
      const scope = makeScope(applicantId);
      const kinds: Array<keyof typeof TAPE_CITATIONS> = [
        "WELCOME_LETTER_DELIVERED",
        "HUD_928_1_FAIR_HOUSING_POSTED",
        "WAITING_LIST_APP_CAPTURED",
        "HUD_92006_SUPPLEMENT_CAPTURED",
        "POSITION_LETTER_SENT",
      ];
      for (const kind of kinds) {
        await service.stamp(makeEvent(kind, applicantId));
      }

      const result = await service.verify(scope);
      expect(result.ok).toBe(true);
      expect(result.lastSequence).toBe(5);
    });

    it("verify() on a chain with mutated payload at sequence=3 returns {ok:false, brokeAt:3, reason set}", async () => {
      const applicantId = "applicant-verify-tampered";
      const scope = makeScope(applicantId);
      const kinds: Array<keyof typeof TAPE_CITATIONS> = [
        "WELCOME_LETTER_DELIVERED",
        "HUD_928_1_FAIR_HOUSING_POSTED",
        "WAITING_LIST_APP_CAPTURED",
        "HUD_92006_SUPPLEMENT_CAPTURED",
        "POSITION_LETTER_SENT",
      ];
      for (const kind of kinds) {
        await service.stamp(makeEvent(kind, applicantId));
      }

      // Tamper: mutate the payload at sequence=3 without updating the hash.
      repo.mutateEntryPayload(scope, 3, {
        "@context": "https://frank-pilot.example/compliance-tape/v1",
        "@type": "ComplianceEvent.TAMPERED",
        actorId: null,
        subjectId: "attacker",
        ruleCitation: "FAKE",
        evidence: { tampered: true },
      });

      const result = await service.verify(scope);
      expect(result.ok).toBe(false);
      expect(result.brokeAt).toBe(3);
      expect(typeof result.reason).toBe("string");
      expect(result.reason!.length).toBeGreaterThan(0);
    });

    it("verify() on a chain with a fabricated entry (wrong prevHash) returns {ok:false, brokeAt:<that seq>, reason set}", async () => {
      const applicantId = "applicant-verify-fabricated";
      const scope = makeScope(applicantId);
      const kinds: Array<keyof typeof TAPE_CITATIONS> = [
        "WELCOME_LETTER_DELIVERED",
        "HUD_928_1_FAIR_HOUSING_POSTED",
      ];
      for (const kind of kinds) {
        await service.stamp(makeEvent(kind, applicantId));
      }

      // Inject a fabricated entry at sequence=3 with a wrong prevHash.
      const fakePayload: TapeJsonLdPayload = {
        "@context": "https://frank-pilot.example/compliance-tape/v1",
        "@type": "ComplianceEvent.FABRICATED",
        actorId: null,
        subjectId: "attacker",
        ruleCitation: "FAKE",
      };
      const wrongPrevHash = Buffer.alloc(32, 0xde).toString("hex");
      const fakeCreatedAt = new Date().toISOString();
      const fakeEntryHash = hashToHex(
        computeEntryHash({
          sequence: 3,
          prevHash: Buffer.alloc(32, 0xde), // wrong prevHash
          payload: fakePayload,
          createdAt: fakeCreatedAt,
        })
      );

      repo.injectFabricatedEntry(scope, {
        id: randomUUID(),
        sequence: 3,
        kind: "WAITING_LIST_APP_CAPTURED",
        citation: TAPE_CITATIONS.WAITING_LIST_APP_CAPTURED,
        applicantId,
        subjectUnitId: null,
        payload: fakePayload,
        prevHash: wrongPrevHash,
        entryHash: fakeEntryHash,
        createdAt: fakeCreatedAt,
        sessionId: null,
      });

      const result = await service.verify(scope);
      expect(result.ok).toBe(false);
      expect(result.brokeAt).toBe(3);
      expect(typeof result.reason).toBe("string");
    });
  });
});
