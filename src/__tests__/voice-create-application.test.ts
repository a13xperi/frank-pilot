/**
 * Tests for src/modules/voice-intake/create-application.ts — the Phase B tool
 * that creates a screenable application on the call (resolve unit → property,
 * validate name/DOB/SSN, find-or-create applicant, ApplicationService.create).
 */

const mockQuery = jest.fn();
jest.mock("../config/database", () => ({
  query: (...args: unknown[]) => mockQuery(...args),
}));
jest.mock("../utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const mockCreate = jest.fn();
jest.mock("../modules/application/service", () => ({
  ApplicationService: class {
    create = (...a: unknown[]) => mockCreate(...a);
  },
}));

import {
  createApplicationHandler,
  registerCreateApplicationHandler,
  __resetRegistrationForTests,
} from "../modules/voice-intake/create-application";
import {
  clearToolHandlersForTests,
  getRegisteredToolNames,
} from "../modules/voice-intake/tool-callbacks";

const CTX = {
  agentId: "agent_test",
  conversationId: "conv_CA_1",
  toolCallId: "tc_CA_1",
  toolName: "create_application" as const,
};
const UNIT_ID = "22222222-2222-2222-2222-222222222222";

const GOOD = {
  unit_id: UNIT_ID,
  phone: "+17025550123",
  first_name: "Alex",
  last_name: "Peri",
  ssn: "123-45-6789",
  date_of_birth: "1990-01-01",
  household_size: 1,
  annual_income: 24000,
  current_city: "Las Vegas",
};

beforeEach(() => jest.clearAllMocks());

describe("createApplicationHandler", () => {
  it("returns ok:false when the unit is unknown", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // unit lookup
    const r = await createApplicationHandler(GOOD, CTX);
    expect(r.ok).toBe(false);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("re-asks (ok:false) on an invalid SSN without creating", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ property_id: "33333333-3333-3333-3333-333333333333", unit_number: "S-001" }] });
    const r = await createApplicationHandler({ ...GOOD, ssn: "12" }, CTX);
    expect(r.ok).toBe(false);
    expect(r.message?.toLowerCase()).toContain("social security");
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("creates a screenable application on the happy path", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ property_id: "33333333-3333-3333-3333-333333333333", unit_number: "S-001" }] }) // unit
      .mockResolvedValueOnce({ rows: [{ id: "user-1" }] }); // applicant by phone
    mockCreate.mockResolvedValueOnce({ id: "app-1", status: "draft" });

    const r = await createApplicationHandler(GOOD, CTX);

    expect(r.ok).toBe(true);
    expect(r.result?.application_id).toBe("app-1");
    // created under the resolved applicant, mapped to the unit's property
    const [input, submittedBy, role] = mockCreate.mock.calls[0];
    expect((input as any).propertyId).toBe("33333333-3333-3333-3333-333333333333");
    expect((input as any).ssn).toBe("123-45-6789");
    expect(submittedBy).toBe("user-1");
    expect(role).toBe("applicant");
  });

  it("registers the create_application handler", () => {
    clearToolHandlersForTests();
    __resetRegistrationForTests();
    registerCreateApplicationHandler();
    expect(getRegisteredToolNames()).toContain("create_application");
  });
});
