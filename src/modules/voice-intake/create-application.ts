import { query } from "../../config/database";
import { logger } from "../../utils/logger";
import { ApplicationService } from "../application/service";
import { createApplicationSchema } from "../application/validation";
import { normalizePhone } from "./service";
import {
  registerToolHandler,
  type ToolCallbackContext,
  type ToolCallbackResult,
} from "./tool-callbacks";

/**
 * Phase B voice tool: `create_application` — turn an interested caller into a
 * real, screenable application on the call.
 *
 * Once Frank has shown the caller what they qualify for (prequalify) and the
 * open units (present_options) and they're ready to move forward, he collects
 * the remaining details — full name, date of birth, SSN, and which unit — and
 * fires this. We resolve the applicant (find-or-create the user by phone),
 * resolve the chosen unit to its property, and create a `draft` application via
 * ApplicationService.create (SSN/DOB encrypted, fraud checks run). The returned
 * application_id is what `start_verification` charges the $35.95 fee against.
 *
 * Heavy PII (SSN) is collected verbally on a recorded line with the standard
 * application disclosure — the operator-chosen "all on the call" flow.
 *
 * Returns:
 *   { ok:true, result:{ application_id, status }, message }
 *   { ok:false, message }   // missing/invalid field, unknown unit
 */

export async function createApplicationHandler(
  parameters: Record<string, unknown>,
  context: ToolCallbackContext
): Promise<ToolCallbackResult> {
  const unitId = pickString(parameters, "unit_id");
  const phone = normalizePhone(pickString(parameters, "phone"));

  // Resolve the chosen unit → property_id + unit_number. The application is
  // tied to a property; present_options gave the caller a unit_id to pick.
  let propertyId: string | null = null;
  let unitNumber: string | null = null;
  if (unitId) {
    const u = await query(
      `SELECT property_id, unit_number FROM units WHERE id = $1`,
      [unitId]
    );
    if (u.rows.length === 0) {
      logger.warn("create_application unknown unit", { conversationId: context.conversationId });
      return {
        ok: false,
        message:
          "I couldn't find that unit on my end. Let me read you the options again and you can pick one.",
      };
    }
    propertyId = u.rows[0].property_id as string;
    unitNumber = (u.rows[0].unit_number as string) ?? null;
  }
  if (!propertyId) {
    return {
      ok: false,
      message:
        "Let me get you matched to a specific unit first, then I'll start the application.",
    };
  }

  // Validate the collected fields the same way the web wizard does — so a
  // mis-heard SSN or DOB comes back as a friendly re-ask, never a thrown error.
  const candidate = {
    propertyId,
    unitNumber: unitNumber ?? undefined,
    conversationId: context.conversationId || undefined,
    firstName: pickString(parameters, "first_name") ?? "",
    lastName: pickString(parameters, "last_name") ?? "",
    ssn: pickString(parameters, "ssn") ?? "",
    dateOfBirth: pickString(parameters, "date_of_birth") ?? "",
    email: pickString(parameters, "email") ?? undefined,
    phone: phone ?? undefined,
    currentCity: pickString(parameters, "current_city") ?? undefined,
    annualIncome: pickNumber(parameters, "annual_income") ?? undefined,
    householdSize: pickNumber(parameters, "household_size") ?? 1,
  };
  const parsed = createApplicationSchema.safeParse(candidate);
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    logger.info("create_application validation failed", {
      conversationId: context.conversationId,
      field: firstIssue?.path?.join("."),
    });
    return { ok: false, message: reAskFor(firstIssue?.path?.[0] as string) };
  }

  // Resolve / create the applicant user (the submitted_by actor).
  const submittedBy = await resolveApplicant(phone, candidate.firstName, candidate.lastName, context.conversationId);

  try {
    const app = await new ApplicationService().create(parsed.data, submittedBy, "applicant");
    logger.info("create_application created", {
      conversationId: context.conversationId,
      status: app.status,
    });
    return {
      ok: true,
      result: { application_id: app.id, status: app.status },
      message:
        "Great, your application is started. Last step to lock it in is the verification fee, then I run everything.",
    };
  } catch (err) {
    logger.error("create_application failed", {
      conversationId: context.conversationId,
      error: (err as Error).message,
    });
    return {
      ok: false,
      message: "Sorry, I hit a snag starting your application. Let me try that once more.",
    };
  }
}

async function resolveApplicant(
  phone: string | null,
  firstName: string,
  lastName: string,
  conversationId: string
): Promise<string> {
  if (phone) {
    const existing = await query(
      `SELECT id FROM users
        WHERE phone = $1 AND role IN ('applicant','tenant') AND is_active = TRUE
        ORDER BY last_login DESC NULLS LAST, created_at DESC LIMIT 1`,
      [phone]
    );
    if (existing.rows.length > 0) return existing.rows[0].id as string;
  }
  const slug = conversationId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80) || "anon";
  const email = `voice+${slug}@voice-handoff.invalid`;
  const inserted = await query(
    `INSERT INTO users (email, first_name, last_name, phone, role, is_active, password_hash)
     VALUES ($1, $2, $3, $4, 'applicant', TRUE, '')
     ON CONFLICT (email) DO UPDATE SET phone = EXCLUDED.phone
     RETURNING id`,
    [email, firstName || "Voice", lastName || "Caller", phone]
  );
  return inserted.rows[0].id as string;
}

function reAskFor(field: string | undefined): string {
  switch (field) {
    case "ssn":
      return "I didn't get that Social Security number right. Can you read me all nine digits once more, slowly?";
    case "dateOfBirth":
      return "Let me get your date of birth again — month, day, and year.";
    case "firstName":
    case "lastName":
      return "Can you give me your full legal name again, first and last?";
    default:
      return "I missed one detail — let me ask you that again.";
  }
}

function pickString(parameters: Record<string, unknown>, key: string): string | null {
  const value = parameters[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function pickNumber(parameters: Record<string, unknown>, key: string): number | null {
  const v = parameters[key];
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && !Number.isNaN(Number(v))) return Number(v);
  return null;
}

let registered = false;
export function registerCreateApplicationHandler(): void {
  if (registered) return;
  registerToolHandler("create_application", createApplicationHandler);
  registered = true;
}

export function __resetRegistrationForTests(): void {
  registered = false;
}
