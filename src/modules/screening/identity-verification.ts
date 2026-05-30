import { logger } from "../../utils/logger";
import { shouldUseScreeningStub, STUB_GATE_ERROR } from "./stub-policy";

export interface IdentityVerificationResult {
  result: "verified" | "rejected" | "review_required" | "could_not_screen";
  confidence: number;
  idType: "driver_license" | "passport" | "state_id" | "unknown";
  livenessScore: number;
  details: {
    documentValid: boolean;
    selfieMatch: boolean;
    riskSignals: string[];
    rawResponse?: Record<string, unknown>;
  };
}

/**
 * Biometric ID + liveness verification (Persona primary, Stripe Identity fallback).
 * Runs before the parallel screening checks; a rejection here short-circuits
 * the pipeline to `failed` and fires an adverse-action notice.
 */
export class IdentityVerificationService {
  private apiUrl: string;
  private apiKey: string;

  constructor() {
    this.apiUrl = process.env.IDENTITY_API_URL || "https://api.persona-identity.example.com";
    this.apiKey = process.env.IDENTITY_API_KEY || "";
  }

  async verify(input: {
    firstName: string;
    lastName: string;
    dateOfBirth: string;
    screeningTag?: string;
  }): Promise<IdentityVerificationResult> {
    logger.info("Initiating identity verification", {
      applicant: `${input.firstName} ${input.lastName}`,
    });

    try {
      const response = await this.callIdentityAPI(input);
      return this.evaluateResults(response);
    } catch (err) {
      logger.error("Identity verification API error", { error: (err as Error).message });
      // A thrown error means the vendor never produced a verdict — we could NOT
      // screen. This must HOLD the application (not pass it, not treat it as a
      // borderline review), so it lands in screening_review for staff resolution.
      return {
        result: "could_not_screen",
        confidence: 0,
        idType: "unknown",
        livenessScore: 0,
        details: {
          documentValid: false,
          selfieMatch: false,
          riskSignals: ["could_not_screen"],
          rawResponse: { error: "Screening vendor unavailable — could not screen" },
        },
      };
    }
  }

  private async callIdentityAPI(input: {
    firstName: string;
    lastName: string;
    dateOfBirth: string;
    screeningTag?: string;
  }): Promise<any> {
    if (process.env.MOCK_MODE === "1" && input.screeningTag) {
      return this.mockResponse(input.screeningTag);
    }

    if (!this.apiKey || this.apiKey === "changeme") {
      if (!shouldUseScreeningStub()) {
        throw new Error(STUB_GATE_ERROR);
      }
      logger.warn("Using stub identity verification — no API key configured (stub policy allows fallback)");
      return {
        documentValid: true,
        selfieMatch: true,
        confidence: 0.95,
        idType: "driver_license",
        livenessScore: 0.97,
        riskSignals: [],
      };
    }

    throw new Error("Production API integration not yet configured");
  }

  private mockResponse(tag: string): any {
    if (tag === "id_verification_fail") {
      return {
        documentValid: false,
        selfieMatch: false,
        confidence: 0.21,
        idType: "driver_license",
        livenessScore: 0.34,
        riskSignals: ["selfie_no_match", "document_tampered"],
      };
    }

    return {
      documentValid: true,
      selfieMatch: true,
      confidence: 0.95,
      idType: "driver_license",
      livenessScore: 0.97,
      riskSignals: [],
    };
  }

  private evaluateResults(response: any): IdentityVerificationResult {
    const confidence = response.confidence || 0;
    const livenessScore = response.livenessScore || 0;
    const documentValid = !!response.documentValid;
    const selfieMatch = !!response.selfieMatch;
    const riskSignals: string[] = Array.isArray(response.riskSignals) ? response.riskSignals : [];

    if (!documentValid || !selfieMatch || confidence < 0.5 || livenessScore < 0.5) {
      return {
        result: "rejected",
        confidence,
        idType: response.idType || "unknown",
        livenessScore,
        details: { documentValid, selfieMatch, riskSignals, rawResponse: response },
      };
    }

    if (confidence < 0.85 || livenessScore < 0.85 || riskSignals.length > 0) {
      return {
        result: "review_required",
        confidence,
        idType: response.idType || "unknown",
        livenessScore,
        details: { documentValid, selfieMatch, riskSignals, rawResponse: response },
      };
    }

    return {
      result: "verified",
      confidence,
      idType: response.idType || "unknown",
      livenessScore,
      details: { documentValid, selfieMatch, riskSignals, rawResponse: response },
    };
  }
}
