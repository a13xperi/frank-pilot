/**
 * Tests for src/modules/voice-intake/applicant-routes.ts — applicant-facing
 * voice-intake prefill endpoint.
 *
 * Mount path under test: /api/voice/intakes/:conversationId/prefill
 *
 * Auth: real `authenticate` middleware runs against a generateToken-minted
 * JWT (pattern lifted from saved-properties.test.ts). The middleware fires
 * a SELECT for the user — we script that as the first DB call, then the
 * route's own SELECT for the voice_intake_calls row.
 */

import express from "express";
import request from "supertest";
import type { QueryResult } from "pg";
import { generateToken, AuthUser } from "../middleware/auth";

jest.mock("../config/database", () => ({
  query: jest.fn(),
}));
jest.mock("../utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import { query } from "../config/database";
import applicantRouter from "../modules/voice-intake/applicant-routes";

const mockQuery = query as jest.MockedFunction<typeof query>;

function qr<T extends Record<string, unknown>>(rows: T[]): QueryResult<T> {
  return { rows } as unknown as QueryResult<T>;
}

function buildApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use("/api/voice/intakes", applicantRouter);
  return app;
}

const app = buildApp();

const USER: AuthUser = {
  id: "00000000-0000-0000-0000-000000000001",
  email: "applicant@example.com",
  role: "applicant",
  firstName: "Ann",
  lastName: "App",
  propertyIds: [],
  emailVerified: true,
};

function authRow() {
  return {
    id: USER.id,
    email: USER.email,
    role: USER.role,
    first_name: USER.firstName,
    last_name: USER.lastName,
    property_ids: [],
    is_active: true,
    email_verified_at: new Date(),
  };
}

const TOKEN = generateToken(USER, { emailVerified: true });
const AUTH = `Bearer ${TOKEN}`;

beforeEach(() => {
  jest.clearAllMocks();
});

describe("GET /api/voice/intakes/:conversationId/prefill — auth", () => {
  it("returns 401 without a bearer token", async () => {
    const res = await request(app).get("/api/voice/intakes/conv_TEST/prefill");
    expect(res.status).toBe(401);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

describe("GET /api/voice/intakes/:conversationId/prefill — validation", () => {
  it("returns 400 when the conversationId is too long", async () => {
    mockQuery.mockResolvedValueOnce(qr([authRow()]));
    const longId = "x".repeat(150);
    const res = await request(app)
      .get(`/api/voice/intakes/${longId}/prefill`)
      .set("Authorization", AUTH);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Invalid conversation_id" });
  });
});

describe("GET /api/voice/intakes/:conversationId/prefill — lookup", () => {
  it("returns 404 with neutral error when no row matches", async () => {
    mockQuery
      .mockResolvedValueOnce(qr([authRow()])) // authenticate user lookup
      .mockResolvedValueOnce(qr([])); // prefill SELECT → miss

    const res = await request(app)
      .get("/api/voice/intakes/conv_NEVER/prefill")
      .set("Authorization", AUTH);

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Not found" });
  });

  it("returns a normalized prefill object when row exists", async () => {
    mockQuery
      .mockResolvedValueOnce(qr([authRow()]))
      .mockResolvedValueOnce(
        qr([
          {
            data_collection_results: {
              name: { value: "Alex Peri" },
              phone: { value: "702 555 1212" },
              current_city: { value: "Henderson" },
              household: { value: "3" },
              monthly_income: { value: "$2,500" },
              consent_recording: { value: "true" },
            },
            language: "en",
          },
        ])
      );

    const res = await request(app)
      .get("/api/voice/intakes/conv_TEST_xyz/prefill")
      .set("Authorization", AUTH);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      conversationId: "conv_TEST_xyz",
      language: "en",
      prefill: {
        firstName: "Alex",
        lastName: "Peri",
        phone: "+17025551212",
        currentCity: "Henderson",
        householdSize: 3,
        monthlyIncome: 2500,
        consentRecording: true,
      },
    });
  });

  it("nulls out missing fields instead of leaking undefined", async () => {
    mockQuery
      .mockResolvedValueOnce(qr([authRow()]))
      .mockResolvedValueOnce(
        qr([
          {
            data_collection_results: {
              name: { value: "Sam" },
            },
            language: null,
          },
        ])
      );

    const res = await request(app)
      .get("/api/voice/intakes/conv_PARTIAL/prefill")
      .set("Authorization", AUTH);

    expect(res.status).toBe(200);
    expect(res.body.prefill).toEqual({
      firstName: "Sam",
      lastName: null,
      phone: null,
      currentCity: null,
      householdSize: null,
      monthlyIncome: null,
      consentRecording: null,
    });
  });

  it("returns 500 on database failure", async () => {
    mockQuery
      .mockResolvedValueOnce(qr([authRow()]))
      .mockRejectedValueOnce(new Error("db down"));

    const res = await request(app)
      .get("/api/voice/intakes/conv_BOOM/prefill")
      .set("Authorization", AUTH);

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "Failed to load prefill" });
  });
});
