/**
 * Golden-path spine invariants (call → text → magic link → walkthrough, text-first).
 * Here: the phone-first auth primitive createMagicLinkByUserId — mints a link for
 * a KNOWN applicant without an email lookup (the SMS/voice paths hold the user id,
 * not a real email). Channel-default + SMS-intake user-creation are exercised by
 * their own suites + manual e2e.
 */

jest.mock("../config/database", () => ({ query: jest.fn() }));
jest.mock("../utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
// Avoid pulling real Resend/Twilio clients when the module loads.
jest.mock("../modules/integrations/email", () => ({ getEmailService: () => ({ sendMagicLink: jest.fn() }) }));
jest.mock("../modules/integrations/twilio", () => ({ TwilioService: jest.fn().mockImplementation(() => ({ sendSMS: jest.fn() })) }));

import { query } from "../config/database";
import { createMagicLinkByUserId } from "../modules/auth/magic-link-service";

const mockQuery = query as jest.MockedFunction<typeof query>;
function rows<T>(r: T[]) {
  return { rows: r } as never;
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.TENANT_PORTAL_URL = "https://frank-pilot-tenant.vercel.app";
});

describe("createMagicLinkByUserId — phone-first auth primitive", () => {
  it("mints a single-use link for an active applicant (no email lookup)", async () => {
    mockQuery
      .mockResolvedValueOnce(rows([{ id: "u1", role: "applicant", is_active: true }])) // user lookup
      .mockResolvedValueOnce(rows([])); // token insert
    const res = await createMagicLinkByUserId("u1");
    expect(res).not.toBeNull();
    expect(res!.userId).toBe("u1");
    expect(res!.link).toMatch(/\/auth\/callback\?token=[A-Za-z0-9_-]+$/);
    // the lookup was by id, never by email
    expect(mockQuery.mock.calls[0][0]).toMatch(/WHERE id = \$1/);
    // a token row was inserted (single-use)
    expect(mockQuery.mock.calls[1][0]).toMatch(/INSERT INTO magic_link_tokens/);
  });

  it("returns null for an inactive user", async () => {
    mockQuery.mockResolvedValueOnce(rows([{ id: "u2", role: "applicant", is_active: false }]));
    expect(await createMagicLinkByUserId("u2")).toBeNull();
    expect(mockQuery).toHaveBeenCalledTimes(1); // no token minted
  });

  it("returns null for a non-applicant/tenant role (no staff links)", async () => {
    mockQuery.mockResolvedValueOnce(rows([{ id: "u3", role: "system_admin", is_active: true }]));
    expect(await createMagicLinkByUserId("u3")).toBeNull();
  });

  it("returns null when the user does not exist", async () => {
    mockQuery.mockResolvedValueOnce(rows([]));
    expect(await createMagicLinkByUserId("nope")).toBeNull();
  });
});
