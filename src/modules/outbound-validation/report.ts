import { logger } from "../../utils/logger";
import {
  listApplicants,
  listValidationCalls,
  type SageApplicant,
} from "./sage-client";

/**
 * Manager-readable progress report over the validation sweep. The roster is
 * 62 rows, so everything aggregates in process — no SQL gymnastics.
 *
 * Two delivery paths:
 *   - GET /api/admin/outbound-validation/report  (markdown or CSV, on demand)
 *   - daily Notion push (appends a dated section to the live-report page)
 */

export interface ReportResult {
  markdown: string;
  csv: string;
  summary: Record<string, number>;
}

const STATUS_ORDER = [
  "confirmed",
  "declined",
  "callback_requested",
  "voicemail",
  "unreachable",
  "bad_number",
  "in_progress",
  "pending",
  "do_not_call",
];

function csvEscape(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function interestLabel(a: SageApplicant): string {
  if (a.still_interested === true) return "yes";
  if (a.still_interested === false) return "no";
  return "";
}

function propLabel(a: SageApplicant): string {
  return a.properties
    .map((p) => (p === "donna-louise-1" ? "DL1" : p === "donna-louise-2" ? "DL2" : p))
    .join("+");
}

export async function generateReport(): Promise<ReportResult> {
  const [applicants, calls] = await Promise.all([listApplicants(), listValidationCalls()]);

  const summary: Record<string, number> = {};
  for (const a of applicants) {
    summary[a.call_status] = (summary[a.call_status] ?? 0) + 1;
  }

  const validated = (summary["confirmed"] ?? 0) + (summary["declined"] ?? 0);
  const header =
    `# Donna Louise Waitlist Validation\n\n` +
    `**${applicants.length} applicants** — ${validated} validated ` +
    `(${summary["confirmed"] ?? 0} still interested, ${summary["declined"] ?? 0} declined), ` +
    `${summary["pending"] ?? 0} not yet reached, ${summary["callback_requested"] ?? 0} callback requested, ` +
    `${summary["unreachable"] ?? 0} unreachable, ${summary["bad_number"] ?? 0} bad numbers. ` +
    `${calls.length} call attempts logged.\n`;

  const statusLines = STATUS_ORDER.filter((s) => summary[s])
    .map((s) => `- **${s.replace(/_/g, " ")}**: ${summary[s]}`)
    .join("\n");

  const rows = applicants.map((a) => {
    const lastNote = (a.call_notes ?? "").replace(/\s+/g, " ").slice(0, 120);
    return (
      `| ${a.full_name} | ${a.phone_display ?? ""} | ${propLabel(a)} | ` +
      `${a.apt_types.join("/")} | ${a.asap ? "ASAP" : a.date_needed ?? ""} | ` +
      `${a.call_status.replace(/_/g, " ")} | ${interestLabel(a)} | ${a.call_attempts} | ` +
      `${a.last_call_at ? a.last_call_at.slice(0, 10) : ""} | ${lastNote} |`
    );
  });

  const markdown =
    `${header}\n${statusLines}\n\n` +
    `| Name | Phone | Lists | Apt | Needed | Status | Interested | Attempts | Last call | Notes |\n` +
    `|---|---|---|---|---|---|---|---|---|---|\n` +
    rows.join("\n") +
    "\n";

  const csvHeader =
    "name,phone,lists,apt_types,date_needed,asap,status,still_interested,attempts,last_call,notes";
  const csvRows = applicants.map((a) =>
    [
      a.full_name,
      a.phone_display ?? "",
      propLabel(a),
      a.apt_types.join("/"),
      a.date_needed ?? "",
      a.asap ? "true" : "false",
      a.call_status,
      interestLabel(a),
      String(a.call_attempts),
      a.last_call_at ?? "",
      (a.call_notes ?? "").replace(/\s+/g, " "),
    ]
      .map(csvEscape)
      .join(",")
  );
  const csv = [csvHeader, ...csvRows].join("\n") + "\n";

  return { markdown, csv, summary };
}

/**
 * Append today's summary to the Notion live-report page. Appends (rather
 * than replaces) so the page keeps a day-by-day trail of the sweep; the
 * full per-applicant table travels in a toggle-friendly code block.
 */
export async function pushReportToNotion(): Promise<boolean> {
  const token = process.env.NOTION_TOKEN ?? "";
  const pageId = process.env.NOTION_VALIDATION_REPORT_PAGE_ID ?? "";
  if (!token || !pageId) {
    logger.info("Notion report push skipped — NOTION_TOKEN / NOTION_VALIDATION_REPORT_PAGE_ID not set");
    return false;
  }

  const { markdown, summary } = await generateReport();
  const today = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    dateStyle: "medium",
  }).format(new Date());
  const summaryLine = Object.entries(summary)
    .map(([k, v]) => `${k.replace(/_/g, " ")}: ${v}`)
    .join(" · ");

  // Notion code blocks cap rich_text at 2000 chars per segment; chunk the report.
  const chunks: string[] = [];
  for (let i = 0; i < markdown.length && chunks.length < 50; i += 1900) {
    chunks.push(markdown.slice(i, i + 1900));
  }

  const res = await fetch(`https://api.notion.com/v1/blocks/${pageId}/children`, {
    signal: AbortSignal.timeout(10000), // audit #10: never hang on a dead vendor/EL/Sage socket
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Notion-Version": "2022-06-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      children: [
        {
          object: "block",
          type: "heading_2",
          heading_2: { rich_text: [{ type: "text", text: { content: `Sweep report — ${today}` } }] },
        },
        {
          object: "block",
          type: "paragraph",
          paragraph: { rich_text: [{ type: "text", text: { content: summaryLine } }] },
        },
        {
          object: "block",
          type: "code",
          code: {
            language: "markdown",
            rich_text: chunks.map((c) => ({ type: "text", text: { content: c } })),
          },
        },
      ],
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    logger.error("Notion report push failed", { status: res.status, detail: detail.slice(0, 300) });
    return false;
  }
  logger.info("Notion report pushed", { summary });
  return true;
}
