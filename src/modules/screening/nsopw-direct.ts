import { logger } from "../../utils/logger";
import { shouldUseScreeningStub, STUB_GATE_ERROR } from "./stub-policy";

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
 * Implementation notes:
 * - NSOPW.gov's public Web Services API requires registered access; in
 *   practice we proxy via a wrapper service (Sterling NSOPW endpoint or
 *   Inflection's NSOPW check) and treat NSOPW_API_KEY as the wrapper's key.
 * - The free direct-scrape path is fragile and rate-limited; not recommended
 *   for production. Stub fallback below mimics the wrapper response shape.
 */
export class NsopwDirectService {
  private apiUrl: string;
  private apiKey: string;

  constructor() {
    this.apiUrl = process.env.NSOPW_API_URL || "https://api.nsopw-proxy.example.com";
    this.apiKey = process.env.NSOPW_API_KEY || "";
  }

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
    if (process.env.MOCK_MODE === "1" && input.screeningTag) {
      return this.mockResponse(input.screeningTag);
    }

    if (!this.apiKey || this.apiKey === "changeme") {
      if (!shouldUseScreeningStub()) {
        throw new Error(STUB_GATE_ERROR);
      }
      logger.warn("Using stub direct NSOPW check — no API key configured (stub policy allows fallback)");
      return {
        records: [],
        searchedStates: input.states,
        confidence: 0.99,
        riskSignals: [],
      };
    }

    throw new Error("Production direct NSOPW integration not yet configured");
  }

  private mockResponse(tag: string): any {
    if (tag === "deny_sex_offender") {
      return {
        records: [
          {
            state: "NV",
            nameMatch: true,
            dobMatch: true,
            addressHint: "Reno, NV (last known)",
            riskTier: "high",
          },
        ],
        searchedStates: ["NV"],
        confidence: 0.98,
        riskSignals: ["registry_match_name_and_dob"],
      };
    }

    return {
      records: [],
      searchedStates: ["NV"],
      confidence: 0.99,
      riskSignals: [],
    };
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
