/**
 * The magic-link handlers fire a field-trail event on the identity-binding moment
 * (verifyMagicLink success → onboarding.link_tapped). The emit is fire-and-forget and must
 * never affect the auth result. These tests pin both: the event fires on success with the
 * right actor, and a failed verify neither returns auth nor emits.
 */
const mockQuery = jest.fn();
jest.mock("../config/database", () => ({ query: mockQuery }));
jest.mock("../utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock("../middleware/auth", () => ({
  generateToken: jest.fn(() => "jwt-token"),
}));

const mockEmit = jest.fn().mockResolvedValue(true);
jest.mock("../modules/integrations/field-trail-emit", () => ({
  getFieldTrailEmitter: () => ({ emit: mockEmit }),
}));

import { verifyMagicLink } from "../modules/auth/magic-link-service";

describe("verifyMagicLink — field-trail emission", () => {
  beforeEach(() => jest.clearAllMocks());

  it("records onboarding.link_tapped (actor user:<id>) on a successful verify and returns auth", async () => {
    const future = new Date(Date.now() + 600_000).toISOString();
    mockQuery
      .mockResolvedValueOnce({
        rows: [
          {
            token_id: "tk-1",
            user_id: "u-123",
            expires_at: future,
            used_at: null,
            email: "a@b.com",
            role: "applicant",
            first_name: "A",
            last_name: "B",
            is_active: true,
          },
        ],
      }) // the SELECT join
      .mockResolvedValue({ rows: [] }); // the subsequent UPDATEs

    const res = await verifyMagicLink("raw-token");

    expect(res?.user.id).toBe("u-123");
    expect(res?.token).toBe("jwt-token");
    expect(mockEmit).toHaveBeenCalledTimes(1);
    expect(mockEmit).toHaveBeenCalledWith(
      expect.objectContaining({ actor: "user:u-123", eventType: "onboarding.link_tapped" })
    );
  });

  it("returns null on an already-used token and does NOT emit", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          token_id: "tk-2",
          user_id: "u-9",
          expires_at: new Date(Date.now() + 600_000).toISOString(),
          used_at: new Date().toISOString(),
          is_active: true,
        },
      ],
    });

    const res = await verifyMagicLink("raw-token");

    expect(res).toBeNull();
    expect(mockEmit).not.toHaveBeenCalled();
  });

  it("returns null on an unknown token and does NOT emit", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await verifyMagicLink("nope");

    expect(res).toBeNull();
    expect(mockEmit).not.toHaveBeenCalled();
  });
});
