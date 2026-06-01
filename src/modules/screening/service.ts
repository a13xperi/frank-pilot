import { query, getClient } from "../../config/database";
import { writeAuditLog } from "../../middleware/audit";
import { logger } from "../../utils/logger";
import { decrypt } from "../../utils/encryption";
import { BackgroundCheckService } from "./background-check";
import { CreditCheckService } from "./credit-check";
import { ComplianceService } from "./compliance";
import { FraudDetectionService } from "./fraud-detection";
import { IdentityVerificationService } from "./identity-verification";
import type { IdentityVerificationResult } from "./identity-verification";
// Phase 4a — extended screening adapters. Dormant by default; they join the
// parallel fan-out only behind the SCREENING_EXTENDED_CHECKS_ENABLED dark flag.
import { PlaidIncomeService } from "./income-verification-plaid";
import type { PlaidIncomeResult } from "./income-verification-plaid";
import { WorkNumberService } from "./work-number";
import type { WorkNumberResult } from "./work-number";
import { NsopwDirectService } from "./nsopw-direct";
import type { NsopwDirectResult } from "./nsopw-direct";
import { AdverseActionService } from "../adverse-action/service";
import { transitionApplicationStatus } from "./state-machine";
import type { AppStatusTransitionResult } from "./state-machine";

// IdentityVerificationResult.result uses verified/rejected/review_required/
// could_not_screen; the `screening_result` enum + downstream overall-result
// aggregator use pass/fail/review_required/could_not_screen. Translate on the
// boundary. A could_not_screen (vendor threw — no verdict) maps straight through
// so the aggregator can HOLD the application instead of passing it.
function mapIdentityResultToScreening(
  r: IdentityVerificationResult["result"]
): "pass" | "fail" | "review_required" | "could_not_screen" {
  if (r === "verified") return "pass";
  if (r === "rejected") return "fail";
  if (r === "could_not_screen") return "could_not_screen";
  return "review_required";
}

export class ScreeningService {
  private identity = new IdentityVerificationService();
  private backgroundCheck = new BackgroundCheckService();
  private creditCheck = new CreditCheckService();
  private compliance = new ComplianceService();
  private fraud = new FraudDetectionService();
  private adverseAction = new AdverseActionService();
  // Phase 4a (dark): extended adapters. Instantiation is side-effect-free (each
  // just reads env into fields); they only run when the flag is on (read at call
  // time in runFullScreening). Default-off keeps the live fan-out unchanged.
  private plaidIncome = new PlaidIncomeService();
  private workNumber = new WorkNumberService();
  private nsopw = new NsopwDirectService();

  /**
   * Run full automated screening pipeline:
   * 1. Identity verification (Persona / Stripe Identity)
   * 2. Fraud screening (duplicate SSN, address)
   * 3. Background check
   * 4. Credit check
   * 5. Tax credit compliance
   *
   * Identity "rejected" short-circuits to fail (with FCRA adverse-action notice).
   * Duplicate-SSN short-circuits to fail (same pattern).
   * Otherwise: any single fail → overall fail; any review_required + no fails →
   * overall review_required; all pass → overall pass.
   */
  async runFullScreening(
    applicationId: string,
    initiatedBy: string,
    initiatorRole: string,
    screeningTag?: string
  ): Promise<{
    overallResult: "pass" | "fail" | "review_required" | "could_not_screen";
    identity: IdentityVerificationResult;
    background: any;
    credit: any;
    compliance: any;
  }> {
    // Fetch application data. Accept both 'submitted' (manual /screen) and
    // 'screening' (auto-on-submit already advanced it through the chokepoint).
    const appResult = await query(
      `SELECT * FROM applications WHERE id = $1 AND status IN ('submitted', 'screening')`,
      [applicationId]
    );

    if (appResult.rows.length === 0) {
      throw new Error("Application not found or not in submitted/screening status");
    }

    const app = appResult.rows[0];

    // Move submitted → screening through the chokepoint. The auto-on-submit
    // path already performed this transition, so only fire it when the app is
    // still 'submitted' (manual /screen entry). The screening_initiated audit
    // below records the pipeline kickoff in both paths.
    if (app.status === "submitted") {
      await transitionApplicationStatus({
        applicationId,
        from: "submitted",
        to: "screening",
        trigger: "screening_started",
        actorId: initiatedBy,
        actorRole: initiatorRole,
        evidence: { source: "run_full_screening" },
      });
    }

    await writeAuditLog({
      action: "screening_initiated",
      actorId: initiatedBy,
      actorRole: initiatorRole,
      applicationId,
      resourceType: "application",
      details: { status: "screening" },
    });

    // Decrypt sensitive data for screening API calls
    const ssnDecrypted = decrypt(app.ssn_encrypted);
    const ssnLast4 = ssnDecrypted.slice(-4);
    const dob = decrypt(app.date_of_birth_encrypted);

    // Identity verification — runs FIRST. Rejection short-circuits the pipeline
    // (FCRA adverse-action notice mirrors the duplicate-SSN early-exit below);
    // review_required joins the overall-result aggregation alongside
    // background/credit/compliance.
    //
    // resolve() (not verify()) is the screening-time call: under
    // IDENTITY_VERIFICATION_ENABLED it READS the Stripe Identity verdict the
    // webhook already persisted (a still-pending capture → could_not_screen
    // HOLD). MOCK/stub/keyless configs are byte-identical to the legacy verify().
    const identityResult = await this.identity.resolve({
      applicationId,
      firstName: app.first_name,
      lastName: app.last_name,
      dateOfBirth: dob,
      screeningTag,
    });

    const identityScreeningResult = mapIdentityResultToScreening(identityResult.result);

    await query(
      `UPDATE applications SET
        identity_verification_result = $2,
        identity_verification_details = $3,
        identity_verification_completed_at = NOW()
       WHERE id = $1`,
      [applicationId, identityScreeningResult, JSON.stringify(identityResult.details)]
    );

    await writeAuditLog({
      action: "identity_verification_completed",
      actorId: initiatedBy,
      actorRole: initiatorRole,
      applicationId,
      details: {
        result: identityResult.result,
        confidence: identityResult.confidence,
        livenessScore: identityResult.livenessScore,
        idType: identityResult.idType,
        riskSignals: identityResult.details.riskSignals,
      },
    });

    if (identityResult.result === "rejected") {
      await query(
        "UPDATE applications SET overall_screening_result = $2 WHERE id = $1",
        [applicationId, "fail"]
      );

      const { changed } = await transitionApplicationStatus({
        applicationId,
        from: "screening",
        to: "screening_failed",
        trigger: "identity_rejected",
        actorId: initiatedBy,
        actorRole: initiatorRole,
        evidence: {
          failedAt: "identity_verification",
          riskSignals: identityResult.details.riskSignals,
        },
      });

      await writeAuditLog({
        action: "screening_completed",
        actorId: initiatedBy,
        actorRole: initiatorRole,
        applicationId,
        details: {
          overallResult: "fail",
          newStatus: "screening_failed",
          failedAt: "identity_verification",
          reason: "identity_rejected",
          riskSignals: identityResult.details.riskSignals,
        },
      });

      // FCRA adverse-action notice — gated on the CAS winning, so a concurrent
      // auto + manual run can never double-send the denial.
      if (changed) {
        this.adverseAction
          .sendNotice(
            applicationId,
            initiatedBy,
            initiatorRole,
            "screening_failed",
            "Automated screening denial: identity verification failed (document validity, selfie match, or liveness score below threshold)"
          )
          .catch((err: Error) =>
            logger.error("Failed to send FCRA adverse action notice after identity-rejected denial", {
              error: err.message,
              applicationId,
            })
          );
      }

      logger.warn("Screening early-exit on identity verification rejection", {
        applicationId,
        riskSignals: identityResult.details.riskSignals,
      });

      return {
        overallResult: "fail",
        identity: identityResult,
        background: { result: "fail", details: { reason: "identity_verification_rejected" } },
        credit: { result: "fail", details: { reason: "identity_verification_rejected" } },
        compliance: { result: "fail", details: { reason: "identity_verification_rejected" } },
      };
    }

    // Fraud screening step — runs BEFORE the parallel vendor checks.
    // Duplicate-SSN is the only fraud signal that auto-fails; everything
    // else raises a flag for staff review and continues the pipeline.
    if (app.ssn_hash) {
      const dupCheck = await this.fraud.checkDuplicateSSN(app.ssn_hash);
      const otherIds = dupCheck.existingApplicationIds.filter((id) => id !== applicationId);
      if (otherIds.length > 0) {
        await query(
          "UPDATE applications SET overall_screening_result = $2 WHERE id = $1",
          [applicationId, "fail"]
        );

        const { changed } = await transitionApplicationStatus({
          applicationId,
          from: "screening",
          to: "screening_failed",
          trigger: "duplicate_ssn",
          actorId: initiatedBy,
          actorRole: initiatorRole,
          evidence: {
            failedAt: "fraud_screening",
            duplicateApplicationIds: otherIds,
          },
        });

        await writeAuditLog({
          action: "screening_completed",
          actorId: initiatedBy,
          actorRole: initiatorRole,
          applicationId,
          details: {
            overallResult: "fail",
            newStatus: "screening_failed",
            failedAt: "fraud_screening",
            reason: "duplicate_ssn",
            duplicateApplicationIds: otherIds,
          },
        });

        // FCRA adverse-action notice — gated on the CAS winning so a concurrent
        // auto + manual run can never double-send the denial.
        if (changed) {
          this.adverseAction
            .sendNotice(
              applicationId,
              initiatedBy,
              initiatorRole,
              "screening_failed",
              "Automated screening denial: duplicate SSN detected on another active application"
            )
            .catch((err: Error) =>
              logger.error("Failed to send FCRA adverse action notice after duplicate-SSN denial", {
                error: err.message,
                applicationId,
              })
            );
        }

        logger.warn("Screening early-exit on duplicate SSN", {
          applicationId,
          duplicateApplicationIds: otherIds,
        });

        return {
          overallResult: "fail",
          identity: identityResult,
          background: { result: "fail", details: { reason: "duplicate_ssn" } },
          credit: { result: "fail", details: { reason: "duplicate_ssn" } },
          compliance: { result: "fail", details: { reason: "duplicate_ssn" } },
        };
      }
    }

    // Address-fraud check — non-blocking; raises a flag for staff review.
    if (app.current_address_line1) {
      const client = await getClient();
      try {
        await this.fraud.checkAddressFraud(client, applicationId, {
          addressLine1: app.current_address_line1,
          city: app.current_city || undefined,
          state: app.current_state || undefined,
          zip: app.current_zip || undefined,
        });
      } catch (err) {
        logger.warn("Address-fraud check failed (non-blocking)", {
          error: (err as Error).message,
          applicationId,
        });
      } finally {
        client.release();
      }
    }

    // Background + credit SOURCE selection.
    //
    // CONSUMER_REPORT_ENABLED gates whether background/credit are pulled
    // synchronously here (the historical path) or READ from a webhook-persisted
    // CRA verdict (Checkr / TransUnion ShareAble, applicant-mediated).
    //
    //   - flag OFF (default) → `runCheck(...)`: byte-identical to today. The
    //     vendor seam produces the raw response inline (sandbox stub / MOCK /
    //     real income vendor) and the service evaluates it. Ships DARK.
    //   - flag ON → `resolve(applicationId)`: the CRA report was created at
    //     submit() and its verdict landed via webhook onto the application row;
    //     resolve() reads it. A report still pending → could_not_screen HOLD.
    //
    // Either source returns the IDENTICAL BackgroundCheckResult / CreditCheckResult
    // shape, so the persist + aggregation below are unchanged regardless of source.
    const consumerReportEnabled = process.env.CONSUMER_REPORT_ENABLED === "true";

    // Run all checks in parallel
    const [backgroundResult, creditResult, complianceResult] = await Promise.all([
      // When the consumer-report flag is ON, the verdict was ordered at submit()
      // and landed via the CRA webhook; resolve() reads it back. When OFF, fall
      // through to the synchronous sandbox seam — byte-identical to pre-#4 main.
      consumerReportEnabled
        ? this.backgroundCheck.resolve(applicationId)
        : this.backgroundCheck.runCheck({
            firstName: app.first_name,
            lastName: app.last_name,
            ssnLast4,
            dateOfBirth: dob,
            state: app.current_state || "NV",
            // Thread the demo tag through to the background vendor, exactly as we
            // already do for identity and the extended checks (plaid/nsopw/work-
            // number). The sandbox vendor honors it ONLY under MOCK_MODE=1, so this
            // is byte-identical in real keyless prod (the applicant funnel never
            // sends a tag, and outside MOCK_MODE the vendor ignores it). It makes
            // the documented MOCK background tags (deny_felony, deny_sex_offender,
            // review_misdemeanors) reachable end-to-end — e.g. to exercise the
            // HUD/FHA criminal-decision engine's individualized-review HOLD.
            screeningTag,
          }),
      consumerReportEnabled
        ? this.creditCheck.resolve(applicationId)
        : this.creditCheck.runCheck({
            firstName: app.first_name,
            lastName: app.last_name,
            ssnLast4,
            dateOfBirth: dob,
          }),
      this.compliance.runCheck({
        propertyId: app.property_id,
        annualIncome: parseFloat(app.annual_income || "0"),
        householdSize: app.household_size || 1,
      }),
    ]);

    // Store results
    await query(
      `UPDATE applications SET
        background_check_result = $2,
        background_check_details = $3,
        background_check_completed_at = NOW(),
        credit_check_result = $4,
        credit_score = $5,
        credit_check_details = $6,
        credit_check_completed_at = NOW(),
        compliance_check_result = $7,
        compliance_check_details = $8,
        compliance_check_completed_at = NOW()
       WHERE id = $1`,
      [
        applicationId,
        backgroundResult.result,
        JSON.stringify(backgroundResult.details),
        creditResult.result,
        creditResult.creditScore,
        JSON.stringify(creditResult.details),
        complianceResult.result,
        JSON.stringify(complianceResult.details),
      ]
    );

    // ── Phase 4a: extended screening adapters (dark flag) ─────────────────────
    // When SCREENING_EXTENDED_CHECKS_ENABLED is off (default) this block is a
    // no-op and `extendedResults` stays empty, so the aggregation below is
    // byte-for-byte today's background+credit+compliance behaviour. When on,
    // Plaid income + direct NSOPW + (conditionally) Work Number join the verdict.
    // Each adapter is fail-loud: a keyless/erroring call HOLDs, never passes.
    const extendedChecksEnabled =
      process.env.SCREENING_EXTENDED_CHECKS_ENABLED === "true";
    const extendedResults: Array<
      "pass" | "fail" | "review_required" | "could_not_screen"
    > = [];
    let incomeResult: PlaidIncomeResult | null = null;
    let nsopwResult: NsopwDirectResult | null = null;
    let workNumberResult: WorkNumberResult | null = null;
    let incomeScreening: "pass" | "review_required" | null = null;
    let nsopwScreening: "pass" | "fail" | "review_required" | null = null;
    let workNumberScreening:
      | "pass"
      | "review_required"
      | "could_not_screen"
      | null = null;

    if (extendedChecksEnabled) {
      const declaredEmployer = !!app.employer_name;

      const [income, nsopw, wn] = await Promise.all([
        // Plaid income — always (primary income source). Its internal catch
        // returns review_required, so this never throws.
        this.plaidIncome.verifyIncome({
          firstName: app.first_name,
          lastName: app.last_name,
          dateOfBirth: dob,
          screeningTag,
        }),
        // Direct NSOPW — always (belt-and-suspenders for the §5.856 lifetime
        // mandatory denial, design §8.4). Internal catch returns review_required.
        this.nsopw.check({
          firstName: app.first_name,
          lastName: app.last_name,
          dateOfBirth: dob,
          states: app.current_state ? [app.current_state] : ["NV"],
          screeningTag,
        }),
        // Work Number (Equifax) — only when the applicant declared a W-2
        // employer (design §3.3/§8.5). ⚠️ work-number.ts has NO internal catch
        // (P1 fail-loud contract): a keyless/erroring call THROWS. Wrap it here
        // so the throw is contained as a could_not_screen HOLD and never aborts
        // the whole Promise.all / screening run.
        declaredEmployer
          ? this.workNumber
              .verifyEmployment({
                firstName: app.first_name,
                lastName: app.last_name,
                ssn: ssnDecrypted,
                dateOfBirth: dob,
              })
              .then((value) => ({ ok: true as const, value }))
              .catch((error: Error) => ({ ok: false as const, error }))
          : Promise.resolve(null),
      ]);

      incomeResult = income;
      nsopwResult = nsopw;

      // Plaid: verified → pass; unverified/review_required → review_required.
      incomeScreening = income.result === "verified" ? "pass" : "review_required";
      extendedResults.push(incomeScreening);

      // NSOPW: match → fail (24 CFR §5.856 lifetime mandatory denial);
      // no_match → pass; review_required → review_required.
      nsopwScreening =
        nsopw.result === "match"
          ? "fail"
          : nsopw.result === "no_match"
            ? "pass"
            : "review_required";
      extendedResults.push(nsopwScreening);

      // Work Number: verified → pass; no_record/partial/review_required →
      // review_required; a thrown adapter (keyless prod) → could_not_screen HOLD.
      if (wn) {
        if (wn.ok) {
          workNumberResult = wn.value;
          workNumberScreening =
            wn.value.result === "verified" ? "pass" : "review_required";
        } else {
          logger.error(
            "Work Number verification threw — holding application (could_not_screen)",
            { error: wn.error.message, applicationId }
          );
          workNumberScreening = "could_not_screen";
        }
        extendedResults.push(workNumberScreening);
      }

      // Income cross-check (design §3.3). Plaid is the primary (bank-linked)
      // figure; reconcile it against the Work Number W-2 number when the
      // applicant declared an employer and both verified, otherwise against the
      // applicant's self-reported income. A >15% delta raises a medium fraud
      // flag and forces review_required. Guard a positive reported figure to
      // avoid divide-by-zero on a zero-income LIHTC household.
      if (income.result === "verified") {
        const plaidAnnual = income.annualIncomeCents / 100;
        let reportedIncome: number | null = null;
        if (
          workNumberResult?.result === "verified" &&
          workNumberResult.details.annualizedIncome
        ) {
          reportedIncome = workNumberResult.details.annualizedIncome;
        } else {
          const selfReported = parseFloat(app.annual_income || "0");
          if (selfReported > 0) reportedIncome = selfReported;
        }
        if (reportedIncome !== null && reportedIncome > 0) {
          const mismatch = await this.fraud.checkIncomeMismatch(
            applicationId,
            reportedIncome,
            plaidAnnual
          );
          if (mismatch) extendedResults.push("review_required");
        }
      }

      // Persist the extended results in their own columns (additive migration
      // 2026-05-30-extended-screening-columns.sql). Separate UPDATE so the
      // flag-off path leaves the existing persist block untouched.
      await query(
        // $2/$4/$6 bind to the `screening_result` enum. $6 is referenced twice
        // (the column assignment AND the completed_at CASE), so without an
        // explicit cast Postgres cannot unify the two inferred types and fails
        // PREPARE with "could not determine data type of parameter $6". Casting
        // every enum param removes the ambiguity (and guards future reuse).
        // NB: mocked unit tests don't exercise a real PREPARE, so this only
        // surfaces against a live Postgres — caught on the staging deploy.
        `UPDATE applications SET
           income_verification_result = $2::screening_result,
           income_verification_details = $3,
           income_verification_completed_at = NOW(),
           nsopw_result = $4::screening_result,
           nsopw_details = $5,
           nsopw_completed_at = NOW(),
           work_number_result = $6::screening_result,
           work_number_details = $7,
           work_number_completed_at = CASE WHEN $6::screening_result IS NULL THEN NULL ELSE NOW() END
         WHERE id = $1`,
        [
          applicationId,
          incomeScreening,
          JSON.stringify(incomeResult?.details ?? {}),
          nsopwScreening,
          JSON.stringify(nsopwResult?.details ?? {}),
          workNumberScreening,
          workNumberResult ? JSON.stringify(workNumberResult.details) : null,
        ]
      );
    }

    // Determine overall result — identity participates alongside background/credit/compliance.
    // Rejected identity already short-circuited above, so identityScreeningResult here is
    // either "pass" (verified) or "review_required".
    // extendedResults is empty unless the dark flag is on, so flag-off this
    // array is identical to before (identity + background + credit + compliance).
    const results: Array<"pass" | "fail" | "review_required" | "could_not_screen"> = [
      identityScreeningResult,
      backgroundResult.result,
      creditResult.result,
      complianceResult.result,
      ...extendedResults,
    ];
    let overallResult: "pass" | "fail" | "review_required" | "could_not_screen";

    // Precedence: a genuine fail denies; a could_not_screen (vendor threw — no
    // verdict) HOLDS for staff review and must outrank a borderline
    // review_required (which passes through). A misconfigured/failed pipeline
    // can therefore never reach screening_passed.
    if (results.includes("fail")) {
      overallResult = "fail";
    } else if (results.includes("could_not_screen")) {
      overallResult = "could_not_screen";
    } else if (results.includes("review_required")) {
      overallResult = "review_required";
    } else {
      overallResult = "pass";
    }

    // Persist the aggregate result; the status column now moves exclusively
    // through the chokepoint (transitionApplicationStatus).
    await query(
      "UPDATE applications SET overall_screening_result = $2 WHERE id = $1",
      [applicationId, overallResult]
    );

    // The background check flags a discretionary criminal record that requires a
    // HUD/FHA individualized assessment (Castro §III.B). This is surfaced as a
    // review_required result tagged with decision="individualized_review". It
    // must HOLD in screening_review — never auto-fail (no time-blind ban) and
    // never auto-pass via the review_required passthrough. A genuine fail or a
    // could_not_screen still outranks it (both already HOLD or deny).
    const backgroundNeedsAssessment =
      backgroundResult.details.decision === "individualized_review";

    // fail                          -> screening_failed  / any_check_failed
    // could_not_screen              -> screening_review  / could_not_screen
    // individualized assessment     -> screening_review  / individualized_assessment_required
    // review_required (passthrough) -> screening_passed  / review_required_passthrough
    // pass                          -> screening_passed  / all_checks_passed
    const finalStatus =
      overallResult === "fail"
        ? "screening_failed"
        : overallResult === "could_not_screen"
          ? "screening_review"
          : backgroundNeedsAssessment
            ? "screening_review"
            : "screening_passed";
    const finalTrigger =
      overallResult === "fail"
        ? "any_check_failed"
        : overallResult === "could_not_screen"
          ? "could_not_screen"
          : backgroundNeedsAssessment
            ? "individualized_assessment_required"
            : overallResult === "review_required"
              ? "review_required_passthrough"
              : "all_checks_passed";

    const { changed } = await transitionApplicationStatus({
      applicationId,
      from: "screening",
      to: finalStatus,
      trigger: finalTrigger,
      actorId: initiatedBy,
      actorRole: initiatorRole,
      evidence: {
        overallResult,
        identity: identityScreeningResult,
        background: backgroundResult.result,
        backgroundDecision: backgroundResult.details.decision,
        credit: creditResult.result,
        compliance: complianceResult.result,
        // Flag-off → empty spread → identical evidence object as before.
        ...(extendedChecksEnabled
          ? {
              incomeVerification: incomeScreening,
              nsopw: nsopwScreening,
              workNumber: workNumberScreening,
            }
          : {}),
      },
    });

    // FCRA § 1681m: send adverse action notice when screening result is fail.
    // Non-blocking — notice failure must not prevent the screening result from being returned.
    // Gated on the CAS winning so a concurrent auto + manual run can't double-send.
    if (overallResult === "fail" && changed) {
      const failedChecks = [
        backgroundResult.result === "fail" ? "background check" : null,
        creditResult.result === "fail" ? "credit check" : null,
        complianceResult.result === "fail" ? "compliance check" : null,
      ]
        .filter(Boolean)
        .join(", ");

      this.adverseAction
        .sendNotice(
          applicationId,
          initiatedBy,
          initiatorRole,
          "screening_failed",
          `Automated screening denial: failed ${failedChecks}`
        )
        .catch((err: Error) =>
          logger.error("Failed to send FCRA adverse action notice after screening failure", {
            error: err.message,
            applicationId,
          })
        );
    }

    // Audit each check completion
    await Promise.all([
      writeAuditLog({
        action: "background_check_completed",
        actorId: initiatedBy,
        actorRole: initiatorRole,
        applicationId,
        details: { result: backgroundResult.result, riskScore: backgroundResult.details.riskScore },
      }),
      writeAuditLog({
        action: "credit_check_completed",
        actorId: initiatedBy,
        actorRole: initiatorRole,
        applicationId,
        details: { result: creditResult.result, creditScore: creditResult.creditScore },
      }),
      writeAuditLog({
        action: "compliance_check_completed",
        actorId: initiatedBy,
        actorRole: initiatorRole,
        applicationId,
        details: { result: complianceResult.result, incomeWithinLimits: complianceResult.details.incomeWithinLimits },
      }),
      writeAuditLog({
        action: "screening_completed",
        actorId: initiatedBy,
        actorRole: initiatorRole,
        applicationId,
        details: { overallResult, newStatus: finalStatus, backgroundDecision: backgroundResult.details.decision },
      }),
    ]);

    logger.info("Screening completed", {
      applicationId,
      overallResult,
      background: backgroundResult.result,
      credit: creditResult.result,
      compliance: complianceResult.result,
    });

    return {
      overallResult,
      identity: identityResult,
      background: backgroundResult,
      credit: creditResult,
      compliance: complianceResult,
    };
  }

  /**
   * Get screening results for an application.
   */
  async getResults(applicationId: string): Promise<any> {
    const result = await query(
      `SELECT
        identity_verification_result, identity_verification_details, identity_verification_completed_at,
        background_check_result, background_check_details, background_check_completed_at,
        credit_check_result, credit_score, credit_check_details, credit_check_completed_at,
        compliance_check_result, compliance_check_details, compliance_check_completed_at,
        income_verification_result, income_verification_details, income_verification_completed_at,
        work_number_result, work_number_details, work_number_completed_at,
        nsopw_result, nsopw_details, nsopw_completed_at,
        overall_screening_result
       FROM applications WHERE id = $1`,
      [applicationId]
    );

    if (result.rows.length === 0) return null;
    return result.rows[0];
  }

  /**
   * Staff review queue — applications held in `screening_review` because the
   * vendor pipeline could not produce a verdict (config/infra failure). These
   * are non-approvable until a reviewer resolves them via resolveReview().
   * Oldest-first so the longest-held applicants are surfaced at the top.
   */
  async getReviewQueue(): Promise<any[]> {
    const result = await query(
      `SELECT id, first_name, last_name, property_id, created_at,
              overall_screening_result, identity_verification_result,
              background_check_result, credit_check_result,
              compliance_check_result, status_history,
              identity_verification_details, identity_verification_completed_at,
              background_check_details, background_check_completed_at,
              credit_check_details, credit_check_completed_at,
              compliance_check_details, compliance_check_completed_at
         FROM applications
        WHERE status = 'screening_review'
        ORDER BY created_at ASC`
    );
    return result.rows;
  }

  /**
   * Render the FCRA § 1681m adverse-action notice a manual denial WOULD send,
   * without committing or sending it — staff preview the denial text before
   * they resolve a held application via resolveReview('fail'). Thin delegator to
   * AdverseActionService.generateNoticeDraft (the same member resolveReview uses
   * to actually sendNotice). No INSERT, no SMS — pure render.
   */
  async getAdverseActionDraft(
    applicationId: string,
    reasonDetail?: string
  ): Promise<{
    applicationId: string;
    applicantName: string;
    propertyName: string;
    noticeText: string;
  }> {
    return this.adverseAction.generateNoticeDraft(applicationId, reasonDetail);
  }

  /**
   * Resolve a held (`screening_review`) application. A "pass" decision releases
   * it to screening_passed; a "fail" decision moves it to screening_failed and
   * fires an FCRA adverse-action notice (non-blocking, gated on the CAS winning
   * — mirrors the automated denial call sites). Returns { changed, status }.
   */
  async resolveReview(
    applicationId: string,
    decision: "pass" | "fail",
    notes: string,
    reviewerId: string,
    reviewerRole: string
  ): Promise<AppStatusTransitionResult> {
    const to = decision === "pass" ? "screening_passed" : "screening_failed";
    const trigger = decision === "pass" ? "manual_override_pass" : "manual_override_fail";

    const { changed, status } = await transitionApplicationStatus({
      applicationId,
      from: "screening_review",
      to,
      trigger,
      actorId: reviewerId,
      actorRole: reviewerRole,
      evidence: { resolution: decision, notes },
    });

    // FCRA § 1681m: send adverse-action notice on a manual denial. Non-blocking
    // and gated on the CAS winning so a concurrent resolution can't double-send.
    //
    // reasonDetail MUST be the raw notes — byte-identical to what the staffer
    // previewed via getAdverseActionDraft(id, notes). Do NOT prefix or otherwise
    // mutate it here: the applicant must receive the exact notice text that was
    // reviewed and approved (preview === sent). The "manual review" framing lives
    // in the manual_override_fail status-transition audit recorded above, not in
    // the applicant-facing letter.
    if (decision === "fail" && changed) {
      this.adverseAction
        .sendNotice(
          applicationId,
          reviewerId,
          reviewerRole,
          "screening_failed",
          notes
        )
        .catch((err: Error) =>
          logger.error("Failed to send FCRA adverse action notice after manual review denial", {
            error: err.message,
            applicationId,
          })
        );
    }

    return { changed, status };
  }
}
