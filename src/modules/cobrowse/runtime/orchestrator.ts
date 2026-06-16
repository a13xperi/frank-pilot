import { logger } from "../../../utils/logger";
import type { FieldPlanStep } from "./field-plan";

/**
 * Concierge co-browse runtime — STUB.
 *
 * ============================ DO NOT WIRE LIVE ============================
 * This is the seam where the live computer-use / Playwright loop will plug in
 * once counsel signs off on autonomously driving an applicant's housing
 * application. Until then EVERY method throws — the scaffold compiles, the
 * routes/handlers are reachable behind COBROWSE_ENABLED (default false), but
 * no browser is ever launched and no field is ever filled.
 *
 * INTENTIONALLY:
 *   - NO top-level `import playwright` (or puppeteer, or any browser driver).
 *     Importing the driver here would pull a heavyweight, headful dependency
 *     into the server bundle and tempt a premature "just call .launch()".
 *     When the loop lands, the driver import goes INSIDE start(), lazily.
 *   - Every method logs the intent (so the audit trail shows we tried) and
 *     then throws the same sentinel error. The caller (start-cobrowse.ts)
 *     never instantiates this in the DARK path; the class exists so the type
 *     contract for the live loop is fixed now.
 * =========================================================================
 */

const STUB_ERROR =
  "cobrowse runtime stub — live computer-use loop pending counsel sign-off";

export interface CobrowseOrchestratorOptions {
  sessionId: string;
  conversationId: string;
  /** The computer-use model id we WOULD route to (recorded, not invoked). */
  agentModel?: string;
}

export interface FieldVerification {
  stepKey: string;
  ok: boolean;
  actual: string | null;
}

export class CobrowseOrchestrator {
  private readonly options: CobrowseOrchestratorOptions;

  constructor(options: CobrowseOrchestratorOptions) {
    this.options = options;
  }

  /**
   * Launch the (headless) browser, navigate to the wizard, and attach the
   * screencast stream. STUB — throws before any browser is created.
   */
  async start(): Promise<void> {
    logger.warn("CobrowseOrchestrator.start invoked on STUB runtime", {
      sessionId: this.options.sessionId,
      conversationId: this.options.conversationId,
      agentModel: this.options.agentModel ?? null,
    });
    throw new Error(STUB_ERROR);
  }

  /**
   * Drive the next field in the plan (type the value, advance the step).
   * STUB — throws.
   */
  async fillNext(_step: FieldPlanStep): Promise<void> {
    logger.warn("CobrowseOrchestrator.fillNext invoked on STUB runtime", {
      sessionId: this.options.sessionId,
      stepKey: _step?.stepKey ?? null,
    });
    throw new Error(STUB_ERROR);
  }

  /**
   * Read back a filled field's DOM value to prove what was entered.
   * STUB — throws.
   */
  async verifyField(_step: FieldPlanStep): Promise<FieldVerification> {
    logger.warn("CobrowseOrchestrator.verifyField invoked on STUB runtime", {
      sessionId: this.options.sessionId,
      stepKey: _step?.stepKey ?? null,
    });
    throw new Error(STUB_ERROR);
  }
}
