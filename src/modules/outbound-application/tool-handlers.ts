import { query } from "../../config/database";
import { logger } from "../../utils/logger";
import { encrypt, hashSSN } from "../../utils/encryption";
import {
  registerToolHandler,
  type ToolCallbackContext,
  type ToolCallbackResult,
} from "../voice-intake/tool-callbacks";

/**
 * Jacqueline's in-call server tools (Frank core C3).
 *
 * These run INSIDE the already-shipped, signed + deduped voice tool-callback
 * pipeline (src/modules/voice-intake/tool-callbacks.ts). They are the safe,
 * unit-testable half of C3: filling + submitting an application draft mid-call.
 * No telephony, no live ElevenLabs call — the dispatcher feeds them parsed,
 * authenticated parameters.
 *
 * Tools:
 *   - save_application_field  {application_id, field, value}
 *       Writes ONE collected field onto the draft. SSN/DOB are encrypted with
 *       the same at-rest crypto as the rest of the app; everything else is
 *       plain. Whitelisted fields only — the agent can't write arbitrary
 *       columns. Idempotent by nature (last write wins on a column).
 *   - submit_application      {application_id}
 *       Flips the draft to 'submitted' once required fields are present.
 *       Idempotent: a re-submit of an already-submitted app is a soft no-op.
 *
 * The C3 queue row (outbound_application_calls) is advanced by the deferred
 * dialer/webhook; these handlers only touch the application draft.
 */

/**
 * Whitelist: tool field name → how to write it. `encrypted` columns go through
 * encrypt() (+ ssn also sets ssn_hash). Numbers are coerced. Anything not here
 * is rejected.
 */
type Writer =
  | { column: string; kind: "text" }
  | { column: string; kind: "int" }
  | { column: string; kind: "money" }
  | { column: "ssn"; kind: "ssn" }
  | { column: "date_of_birth"; kind: "dob" };

const FIELD_WRITERS: Record<string, Writer> = {
  ssn: { column: "ssn", kind: "ssn" },
  date_of_birth: { column: "date_of_birth", kind: "dob" },
  current_address_line1: { column: "current_address_line1", kind: "text" },
  current_address_line2: { column: "current_address_line2", kind: "text" },
  current_city: { column: "current_city", kind: "text" },
  current_state: { column: "current_state", kind: "text" },
  current_zip: { column: "current_zip", kind: "text" },
  employer_name: { column: "employer_name", kind: "text" },
  employer_phone: { column: "employer_phone", kind: "text" },
  annual_income: { column: "annual_income", kind: "money" },
  household_size: { column: "household_size", kind: "int" },
  email: { column: "email", kind: "text" },
};

function pickString(parameters: Record<string, unknown>, key: string): string | null {
  const v = parameters[key];
  if (typeof v === "string") return v.trim() || null;
  if (typeof v === "number") return String(v);
  return null;
}

/**
 * save_application_field — write one whitelisted field onto a draft.
 *
 * Returns a soft { ok: false, message } (200-level for the agent) for a missing
 * application, a non-draft application, an unknown field, or an unparseable
 * value — the agent reads the message and re-asks. SSN/DOB are validated for
 * shape before encryption.
 */
export async function saveApplicationFieldHandler(
  parameters: Record<string, unknown>,
  context: ToolCallbackContext
): Promise<ToolCallbackResult> {
  const applicationId = pickString(parameters, "application_id");
  const field = pickString(parameters, "field");
  const value = pickString(parameters, "value");

  if (!applicationId || !field || value == null) {
    return { ok: false, message: "I'm missing some details for that. Let's try that field again." };
  }
  const writer = FIELD_WRITERS[field];
  if (!writer) {
    logger.warn("save_application_field unknown field", {
      field,
      conversationId: context.conversationId,
    });
    return { ok: false, message: "I can't record that one. Let's move on to the next question." };
  }

  // Confirm the draft exists and is still a draft (don't mutate submitted apps).
  const draftRes = await query(
    `SELECT status FROM applications WHERE id = $1 LIMIT 1`,
    [applicationId]
  );
  if (draftRes.rows.length === 0) {
    return { ok: false, message: "I couldn't find your application. Let me get a teammate to help." };
  }
  if (draftRes.rows[0].status !== "draft") {
    return { ok: false, message: "Your application is already submitted, so I can't change that field." };
  }

  let setSql: string;
  let params: unknown[];
  switch (writer.kind) {
    case "ssn": {
      const digits = value.replace(/\D/g, "");
      if (digits.length !== 9) {
        return { ok: false, message: "That Social doesn't look complete. Can you read all nine digits?" };
      }
      setSql = `ssn_encrypted = $2, ssn_hash = $3`;
      params = [applicationId, encrypt(digits), hashSSN(digits)];
      break;
    }
    case "dob": {
      const iso = normalizeDobIso(value);
      if (!iso) {
        return { ok: false, message: "I didn't catch your date of birth. What month, day, and year?" };
      }
      setSql = `date_of_birth_encrypted = $2`;
      params = [applicationId, encrypt(iso)];
      break;
    }
    case "int": {
      const n = parseInt(value.replace(/[^0-9]/g, ""), 10);
      if (!Number.isFinite(n)) {
        return { ok: false, message: "I didn't get a number for that. Could you say it again?" };
      }
      setSql = `${writer.column} = $2`;
      params = [applicationId, n];
      break;
    }
    case "money": {
      const n = Number(value.replace(/[^0-9.]/g, ""));
      if (!Number.isFinite(n)) {
        return { ok: false, message: "I didn't get a dollar amount. Could you say it again?" };
      }
      setSql = `${writer.column} = $2`;
      params = [applicationId, n];
      break;
    }
    default: {
      setSql = `${writer.column} = $2`;
      params = [applicationId, value];
    }
  }

  await query(
    `UPDATE applications SET ${setSql}, updated_at = NOW() WHERE id = $1`,
    params
  );
  logger.info("save_application_field wrote", {
    field: writer.column === "ssn" || writer.column === "date_of_birth" ? `${field}(sensitive)` : field,
    conversationId: context.conversationId,
  });
  return { ok: true, result: { saved: field }, message: "Got it." };
}

/**
 * submit_application — flip a draft to 'submitted' once required fields exist.
 *
 * Required to submit: first_name, last_name, ssn, date_of_birth (mirrors the
 * create-application schema's required set). Idempotent: an already-submitted
 * application returns ok:true with a "already submitted" note (so a retried
 * tool call is harmless).
 */
export async function submitApplicationHandler(
  parameters: Record<string, unknown>,
  context: ToolCallbackContext
): Promise<ToolCallbackResult> {
  const applicationId = pickString(parameters, "application_id");
  if (!applicationId) {
    return { ok: false, message: "I lost track of your application. Let me get a teammate." };
  }

  const res = await query(
    `SELECT status, first_name, last_name, ssn_encrypted, date_of_birth_encrypted
       FROM applications WHERE id = $1 LIMIT 1`,
    [applicationId]
  );
  if (res.rows.length === 0) {
    return { ok: false, message: "I couldn't find your application." };
  }
  const app = res.rows[0];
  if (app.status === "submitted") {
    return { ok: true, result: { alreadySubmitted: true }, message: "Your application is already submitted." };
  }
  if (app.status !== "draft") {
    return { ok: false, message: "Your application is already past the submission step." };
  }

  const missing: string[] = [];
  if (!app.first_name) missing.push("first name");
  if (!app.last_name) missing.push("last name");
  if (!app.ssn_encrypted) missing.push("Social Security number");
  if (!app.date_of_birth_encrypted) missing.push("date of birth");
  if (missing.length > 0) {
    return {
      ok: false,
      result: { missing },
      message: `Before I submit, I still need your ${missing.join(", ")}.`,
    };
  }

  await query(
    `UPDATE applications
        SET status = 'submitted', submitted_at = NOW(), updated_at = NOW()
      WHERE id = $1 AND status = 'draft'`,
    [applicationId]
  );

  // Mark the outbound call completed (best-effort; the call row may not exist
  // in a non-dialer test path).
  await query(
    `UPDATE outbound_application_calls
        SET status = 'completed', outcome = 'submitted', completed_at = NOW()
      WHERE application_id = $1 AND status IN ('queued','dialed')`,
    [applicationId]
  );

  logger.info("submit_application submitted draft", {
    applicationId,
    conversationId: context.conversationId,
  });
  return { ok: true, result: { submitted: true }, message: "All set — I've submitted your application." };
}

/** MM/DD/YYYY or ISO → yyyy-mm-dd; null if unparseable. */
function normalizeDobIso(value: string): string | null {
  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const us = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (us) return `${us[3]}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

let registered = false;
/**
 * Idempotent registration. Boot calls this; tests can re-wire after
 * clearToolHandlersForTests().
 *
 * NOTE: registering the handler does NOT make any call happen — the tool only
 * fires if a live Jacqueline agent (DEFERRED) is configured to invoke it. Safe
 * to register dark.
 */
export function registerOutboundApplicationToolHandlers(): void {
  if (registered) return;
  registerToolHandler("save_application_field", saveApplicationFieldHandler);
  registerToolHandler("submit_application", submitApplicationHandler);
  registered = true;
}

/** Test-only: reset the one-time gate. */
export function __resetRegistrationForTests(): void {
  registered = false;
}
