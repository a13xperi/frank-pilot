import { logger } from "../../utils/logger";
import { resolveVendor } from "./vendors";

export interface NsopwDirectResult {
  result: "no_match" | "match" | "review_required";
  match: boolean;
  records: Array<{
    state: string;
    nameMatch: boolean;
    dobMatch: boolean;
    addressHint?: string;
    riskTier: "high" | "medium" | "low";
  }>;
  details: {
    searchedStates: string[];
    confidence: number;
    riskSignals: string[];
    rawResponse?: Record<string, unknown>;
  };
}

/**
 * Direct National Sex Offender Public Website (NSOPW.gov) adapter.
 *
 * Per design doc §8.4, this runs in parallel with the vendor's bundled NSOPW
 * scrape as belt-and-suspenders coverage for the HUD §5.856 lifetime mandatory
 * denial. If vendor and direct disagree, the orchestrator MUST hold for manual
 * review — never auto-pass on a partial match.
 *
 * The raw registry response comes from the screening vendor seam
 * (resolveVendor("nsopw")); this service owns only the match evaluation and the
 * catch → review_required HOLD (never auto-clears on a vendor failure).
 */
export class NsopwDirectService {
  async check(input: {
    firstName: string;
    lastName: string;
    dateOfBirth: string;
    states?: string[];
    screeningTag?: string;
  }): Promise<NsopwDirectResult> {
    const searchedStates = input.states && input.states.length > 0
      ? input.states
      : ["NV"];

    logger.info("Initiating direct NSOPW check", {
      applicant: `${input.firstName} ${input.lastName}`,
      states: searchedStates,
    });

    try {
      const response = await this.callNsopwAPI({ ...input, states: searchedStates });
      return this.evaluateResults(response, searchedStates);
    } catch (err) {
      logger.error("Direct NSOPW API error", { error: (err as Error).message });
      return {
        result: "review_required",
        match: false,
        records: [],
        details: {
          searchedStates,
          confidence: 0,
          riskSignals: ["api_unavailable"],
          rawResponse: { error: "Direct NSOPW unavailable, manual review required" },
        },
      };
    }
  }

  private async callNsopwAPI(input: {
    firstName: string;
    lastName: string;
    dateOfBirth: string;
    states: string[];
    screeningTag?: string;
  }): Promise<any> {
    // Delegate the raw registry pull to the configured vendor. The vendor
    // self-gates on the stub policy: keyless production THROWS here → caught
    // above → review_required (a vendor outage never auto-clears the §5.856 gate).
    return resolveVendor("nsopw").nsopw(input);
  }

  private evaluateResults(response: any, searchedStates: string[]): NsopwDirectResult {
    const records: NsopwDirectResult["records"] = Array.isArray(response.records)
      ? response.records.map((r: any) => ({
          state: r.state || "unknown",
          nameMatch: !!r.nameMatch,
          dobMatch: !!r.dobMatch,
          addressHint: r.addressHint,
          riskTier: r.riskTier === "high" || r.riskTier === "medium" ? r.riskTier : "low",
        }))
      : [];

    const confidence = typeof response.confidence === "number" ? response.confidence : 0;
    const riskSignals: string[] = Array.isArray(response.riskSignals) ? response.riskSignals : [];

    const strongMatches = records.filter((r) => r.nameMatch && r.dobMatch && r.riskTier === "high");
    const partialMatches = records.filter((r) => r.nameMatch && !r.dobMatch);

    if (strongMatches.length > 0) {
      return {
        result: "match",
        match: true,
        records,
        details: {
          searchedStates,
          confidence,
          riskSignals,
          rawResponse: response,
        },
      };
    }

    if (partialMatches.length > 0 || confidence < 0.9) {
      return {
        result: "review_required",
        match: false,
        records,
        details: {
          searchedStates,
          confidence,
          riskSignals,
          rawResponse: response,
        },
      };
    }

    return {
      result: "no_match",
      match: false,
      records,
      details: {
        searchedStates,
        confidence,
        riskSignals,
        rawResponse: response,
      },
    };
  }
}
