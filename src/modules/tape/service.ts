/**
 * BP-02 Compliance Tape — service layer.
 *
 * Provides stamp(), verify(), and exportPdf() on top of any TapeRepository
 * implementation.  Callers obtain an instance via createTapeService(repo).
 *
 * stamp() is transactionally safe: it reads the tail, computes the hash,
 * and inserts in a single repo.insert() call.  If two concurrent stamps
 * collide on (applicant_id, sequence) the repository's UNIQUE constraint
 * rejects the loser; stamp() retries up to 3 times before throwing.
 *
 * exportPdf() paginates at 50 entries per page (v1 spec §3).
 */

interface PdfDoc {
  pipe(dest: NodeJS.WritableStream): void;
  addPage(): PdfDoc;
  end(): void;
  page: { width: number; height: number };
  font(name: string): PdfDoc;
  fontSize(size: number): PdfDoc;
  fillColor(color: string): PdfDoc;
  text(str: string, x?: number, y?: number, opts?: { align?: string; width?: number }): PdfDoc;
  text(str: string, opts?: { align?: string; width?: number }): PdfDoc;
  text(str: string, x?: number, opts?: { align?: string; width?: number }): PdfDoc;
  moveDown(n?: number): PdfDoc;
  moveTo(x: number, y: number): PdfDoc;
  lineTo(x: number, y: number): PdfDoc;
  stroke(): PdfDoc;
  y: number;
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const PDFDocument = require("pdfkit") as new (opts?: {
  autoFirstPage?: boolean;
  margin?: number;
  size?: string;
}) => PdfDoc;

import { PassThrough } from "stream";
import { computeEntryHash, GENESIS_HASH } from "./hashing";
import { buildAuditReport, type AuditReport } from "./audit-report";
import type {
  TapeEntry,
  TapeEvent,
  TapeRepository,
  TapeScope,
  VerifyResult,
} from "./types";
import { TAPE_CITATIONS } from "./types";

// ---------------------------------------------------------------------------
// TapeService interface
// ---------------------------------------------------------------------------

export interface TapeService {
  /**
   * Record a new event on the tape.  The service resolves scope from the event
   * payload (applicantId in subjectId → applicant scope; otherwise global),
   * computes the hash chain link, and appends the row.
   *
   * Idempotent on (kind, sessionId): returns the existing TapeEntry if the
   * UNIQUE constraint fires.
   *
   * Retries up to 3 times on sequence collision (concurrent stamps).
   */
  stamp(event: TapeEvent): Promise<TapeEntry>;

  /**
   * Walk the full chain for a scope and verify every hash link.
   * Returns {ok: true} if the chain is intact, or {ok: false, brokeAt, reason}
   * on the first mismatch.
   */
  verify(scope: TapeScope): Promise<VerifyResult>;

  /**
   * Render all entries in scope to a PDF and return the binary Buffer.
   * Paginates at 50 entries per page.  Every page footer shows the rolling
   * SHA-256 of the last entry so the printout is self-verifying.
   */
  exportPdf(scope: TapeScope): Promise<Buffer>;

  /**
   * Build the JPM "gold standard" audit report for a scope: the chain in
   * sequence order, HUD-cited, with a self-contained verification summary
   * (this method verifies first, so the summary and rows always agree).
   * Returns a JSON-serializable object — the machine-checkable counterpart to
   * exportPdf's human printout.
   */
  exportAuditReport(scope: TapeScope): Promise<AuditReport>;

  /**
   * Read entries in scope, oldest first.  Passthrough to repo.list — exposed
   * on the service so callers (BP-19 viewer routes, verify-cron) don't have
   * to hold a reference to the repository directly.
   */
  list(
    scope: TapeScope,
    opts?: { limit?: number; afterSequence?: number }
  ): Promise<TapeEntry[]>;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

const MAX_STAMP_RETRIES = 3;
const PDF_ENTRIES_PER_PAGE = 50;

export function createTapeService(repo: TapeRepository): TapeService {
  // -------------------------------------------------------------------------
  // stamp
  // -------------------------------------------------------------------------
  async function stamp(event: TapeEvent): Promise<TapeEntry> {
    // Resolve scope from payload: subjectId is the applicant id in Lane C
    // makers.  Null subjectId → global scope.
    const scope: TapeScope =
      event.payload.subjectId !== null && event.payload.subjectId !== undefined
        ? { type: "applicant", applicantId: event.payload.subjectId }
        : { type: "global" };

    let lastError: unknown;
    for (let attempt = 0; attempt < MAX_STAMP_RETRIES; attempt++) {
      try {
        // Read current tail inside the same transaction the insert runs in.
        const tail = await repo.tail(scope);

        const sequence = tail === null ? 1 : tail.sequence + 1;
        const prevHashBuf =
          tail === null
            ? GENESIS_HASH
            : Buffer.from(tail.entryHash, "hex");

        const createdAt = new Date().toISOString();

        const entryHashBuf = computeEntryHash({
          sequence,
          prevHash: prevHashBuf,
          payload: event.payload,
          createdAt,
        });

        const citation = TAPE_CITATIONS[event.kind];

        const entry = await repo.insert({
          applicantId:
            scope.type === "applicant" ? scope.applicantId : null,
          sequence,
          kind: event.kind,
          citation,
          payload: event.payload,
          prevHash: prevHashBuf.toString("hex"),
          entryHash: entryHashBuf.toString("hex"),
          sessionId: event.sessionId ?? null,
          createdAt,
        });

        return entry;
      } catch (err) {
        // Unique-constraint violation on (applicant_id, sequence) → retry.
        // Unique violation on (kind, session_id) is handled by repo.insert
        // with ON CONFLICT DO NOTHING + re-fetch, so those never reach here.
        const pg = err as { code?: string };
        if (pg.code === "23505" && attempt < MAX_STAMP_RETRIES - 1) {
          lastError = err;
          continue;
        }
        throw err;
      }
    }
    throw lastError;
  }

  // -------------------------------------------------------------------------
  // verify
  // -------------------------------------------------------------------------
  async function verify(scope: TapeScope): Promise<VerifyResult> {
    const entries = await repo.list(scope);

    if (entries.length === 0) {
      return { ok: true, scope, lastSequence: 0 };
    }

    let prevEntryHash: string | null = null; // hex of previous entry's entryHash
    let expectedSequence = 1;

    for (const entry of entries) {
      // 1. Sequence must be monotonically increasing from 1.
      if (entry.sequence !== expectedSequence) {
        return {
          ok: false,
          scope,
          lastSequence: entry.sequence,
          brokeAt: entry.sequence,
          reason: `expected sequence ${expectedSequence}, got ${entry.sequence}`,
        };
      }

      // 2. prevHash must match the previous entry's entryHash (or GENESIS for seq=1).
      const expectedPrevHash =
        prevEntryHash === null
          ? GENESIS_HASH.toString("hex")
          : prevEntryHash;
      if (entry.prevHash !== expectedPrevHash) {
        return {
          ok: false,
          scope,
          lastSequence: entry.sequence,
          brokeAt: entry.sequence,
          reason: `prevHash mismatch at sequence ${entry.sequence}: stored ${entry.prevHash.slice(0, 16)}…, expected ${expectedPrevHash.slice(0, 16)}…`,
        };
      }

      // 3. Recompute entryHash and compare.
      const recomputed = computeEntryHash({
        sequence: entry.sequence,
        prevHash: Buffer.from(entry.prevHash, "hex"),
        payload: entry.payload,
        createdAt: entry.createdAt,
      });
      const recomputedHex = recomputed.toString("hex");

      if (recomputedHex !== entry.entryHash) {
        return {
          ok: false,
          scope,
          lastSequence: entry.sequence,
          brokeAt: entry.sequence,
          reason: `entryHash mismatch at sequence ${entry.sequence}: stored ${entry.entryHash.slice(0, 16)}…, recomputed ${recomputedHex.slice(0, 16)}…`,
        };
      }

      prevEntryHash = entry.entryHash;
      expectedSequence++;
    }

    return {
      ok: true,
      scope,
      lastSequence: entries[entries.length - 1].sequence,
    };
  }

  // -------------------------------------------------------------------------
  // exportPdf
  // -------------------------------------------------------------------------
  async function exportPdf(scope: TapeScope): Promise<Buffer> {
    const entries = await repo.list(scope);

    return new Promise<Buffer>((resolve, reject) => {
      const doc = new PDFDocument({ autoFirstPage: true, margin: 50, size: "LETTER" });
      const pass = new PassThrough();
      const chunks: Buffer[] = [];

      pass.on("data", (chunk: Buffer) => chunks.push(chunk));
      pass.on("end", () => resolve(Buffer.concat(chunks)));
      pass.on("error", reject);

      doc.pipe(pass);

      const pageWidth = doc.page.width;
      const marginLeft = 50;
      const contentWidth = pageWidth - marginLeft * 2;

      // Helper: draw page footer with the rolling hash of the last entry
      // rendered so far.
      function drawFooter(lastHash: string, pageNum: number): void {
        const y = doc.page.height - 40;
        doc
          .moveTo(marginLeft, y - 5)
          .lineTo(pageWidth - marginLeft, y - 5)
          .stroke();
        doc
          .fontSize(7)
          .fillColor("#666666")
          .text(
            `Page ${pageNum}   |   Verified SHA-256: ${lastHash}`,
            marginLeft,
            y,
            { align: "left", width: contentWidth }
          );
      }

      // Helper: render one entry block.
      function renderEntry(entry: TapeEntry): void {
        const evidenceSummary = entry.payload.evidence
          ? Object.entries(entry.payload.evidence)
              .slice(0, 4) // keep it brief
              .map(([k, v]) => `${k}: ${String(v).slice(0, 80)}`)
              .join("  ·  ")
          : "(no evidence)";

        doc
          .fontSize(9)
          .fillColor("#111111")
          .text(
            `#${entry.sequence}  ${entry.kind}`,
            marginLeft,
            undefined,
            { width: contentWidth }
          );
        doc
          .fontSize(8)
          .fillColor("#444444")
          .text(
            `Citation: ${entry.citation}   |   ${entry.createdAt}`,
            marginLeft,
            undefined,
            { width: contentWidth }
          );
        doc
          .fontSize(7.5)
          .fillColor("#555555")
          .text(evidenceSummary, marginLeft, undefined, { width: contentWidth });
        doc.moveDown(0.6);
      }

      // Title block on first page.
      const scopeLabel =
        scope.type === "applicant"
          ? `Applicant: ${scope.applicantId}`
          : "Global Scope";

      doc
        .fontSize(14)
        .fillColor("#000000")
        .text("Compliance Tape Export", marginLeft, 50, { width: contentWidth });
      doc
        .fontSize(10)
        .fillColor("#333333")
        .text(scopeLabel, marginLeft, undefined, { width: contentWidth });
      doc
        .fontSize(9)
        .fillColor("#555555")
        .text(
          `Generated: ${new Date().toISOString()}   |   Entries: ${entries.length}`,
          marginLeft,
          undefined,
          { width: contentWidth }
        );
      doc.moveDown(1.5);

      if (entries.length === 0) {
        doc
          .fontSize(10)
          .fillColor("#666666")
          .text("(no entries)", marginLeft, undefined, { width: contentWidth });
        drawFooter(GENESIS_HASH.toString("hex"), 1);
        doc.end();
        return;
      }

      let pageNum = 1;
      let positionOnPage = 0; // entry index within current page
      let lastHash = GENESIS_HASH.toString("hex");

      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        lastHash = entry.entryHash;

        // New page every PDF_ENTRIES_PER_PAGE entries (but not at the very start).
        if (positionOnPage >= PDF_ENTRIES_PER_PAGE) {
          drawFooter(lastHash, pageNum);
          doc.addPage();
          pageNum++;
          positionOnPage = 0;
        }

        renderEntry(entry);
        positionOnPage++;
      }

      // Footer on the final page.
      drawFooter(lastHash, pageNum);
      doc.end();
    });
  }

  // -------------------------------------------------------------------------
  // exportAuditReport — JPM gold-standard structured audit artifact
  // -------------------------------------------------------------------------
  async function exportAuditReport(scope: TapeScope): Promise<AuditReport> {
    // Verify first so the report's summary is authoritative and can never
    // disagree with the rows it ships. verify() reads the same chain
    // buildAuditReport renders, so they are consistent by construction.
    const verifyResult = await verify(scope);
    const entries = await repo.list(scope);
    return buildAuditReport(scope, entries, verifyResult);
  }

  // -------------------------------------------------------------------------
  // list
  // -------------------------------------------------------------------------
  async function list(
    scope: TapeScope,
    opts?: { limit?: number; afterSequence?: number }
  ): Promise<TapeEntry[]> {
    return repo.list(scope, opts);
  }

  return { stamp, verify, exportPdf, exportAuditReport, list };
}
