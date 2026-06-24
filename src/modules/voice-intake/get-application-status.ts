import { query } from "../../config/database";
import { logger } from "../../utils/logger";
import {
  registerToolHandler,
  type ToolCallbackContext,
  type ToolCallbackResult,
} from "./tool-callbacks";

/**
 * Ops/test tool: `get_application_status` — read an application's stage and
 * screening results by id.
 *
 * Built so the paid-conversion loop (create_application → fee → submit →
 * screening) can be verified end to end without staff-console or direct DB
 * access: hit this with the application_id and it returns the current status
 * plus each screening verdict. Frank can also use it mid-call to tell a caller
 * where their application stands.
 *
 * Read-only. No PII (no name/SSN/DOB) — only the status + the coarse
 * screening_result enums. Returns ok:false on a missing/unknown id.
 */

export async function getApplicationStatusHandler(
  parameters: Record<string, unknown>,
  context: ToolCallbackContext
): Promise<ToolCallbackResult> {
  const applicationId = pickString(parameters, "application_id");
  if (!applicationId) {
    return {
      ok: false,
      message: "I need the application id to look up the status.",
    };
  }

  const res = await query(
    `SELECT status, submitted_at, screening_authorization_at,
            identity_verification_result, background_check_result,
            credit_check_result, compliance_check_result,
            income_verification_result
       FROM applications
      WHERE id = $1`,
    [applicationId]
  );
  if (res.rows.length === 0) {
    logger.info("get_application_status unknown id", { conversationId: context.conversationId });
    return { ok: false, message: "I couldn't find an application with that id." };
  }

  const r = res.rows[0];
  const result = {
    status: r.status as string,
    submitted: Boolean(r.submitted_at),
    consented: Boolean(r.screening_authorization_at),
    screening: {
      identity: r.identity_verification_result ?? null,
      background: r.background_check_result ?? null,
      credit: r.credit_check_result ?? null,
      compliance: r.compliance_check_result ?? null,
      income: r.income_verification_result ?? null,
    },
  };

  logger.info("get_application_status", {
    conversationId: context.conversationId,
    status: result.status,
  });

  return {
    ok: true,
    result,
    message: `Application status: ${result.status}.`,
  };
}

function pickString(parameters: Record<string, unknown>, key: string): string | null {
  const value = parameters[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

let registered = false;
export function registerGetApplicationStatusHandler(): void {
  if (registered) return;
  registerToolHandler("get_application_status", getApplicationStatusHandler);
  registered = true;
}

export function __resetRegistrationForTests(): void {
  registered = false;
}
