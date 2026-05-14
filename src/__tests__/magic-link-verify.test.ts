/**
 * WARN #2: verifyMagicLink() stamps users.email_verified_at and re-issues
 * a JWT with emailVerified=true.
 *
 * The contract we lock in:
 *   1. Successful verify → UPDATE users SET email_verified_at = NOW() WHERE
 *      id = $1 AND email_verified_at IS NULL  (idempotent — second click does not bump)
 *   2. Returned token has emailVerified=true in its claims.
 *   3. Returned AuthUser.emailVerified is true.
 */
import jwt from "jsonwebtoken";

jest.mock("../config/database", () => ({ query: jest.fn(), transaction: jest.fn() }));
jest.mock("../utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import { query } from "../config/database";
import { verifyMagicLink } from "../modules/auth/magic-link-service";

const mockQuery = query as jest.MockedFunction<typeof query>;

describe("verifyMagicLink (WARN #2)", () => {
  beforeEach(() => jest.clearAllMocks());

  it("stamps email_verified_at and returns a token with emailVerified=true", async () => {
    const future = new Date(Date.now() + 10 * 60 * 1000);
    // SELECT magic_link_tokens JOIN users
    mockQuery.mockResolvedValueOnce({
      rows: [{
        token_id: "tok-1",
        user_id: "user-1",
        expires_at: future,
        used_at: null,
        email: "applicant@x.com",
        role: "applicant",
        first_name: "App",
        last_name: "Licant",
        is_active: true,
      }],
    } as any);
    mockQuery.mockResolvedValueOnce({ rows: [] } as any); // UPDATE magic_link_tokens used_at
    mockQuery.mockResolvedValueOnce({ rows: [] } as any); // UPDATE users last_login
    mockQuery.mockResolvedValueOnce({ rows: [] } as any); // UPDATE users email_verified_at

    const result = await verifyMagicLink("raw-token-abc123def456ghi789");
    expect(result).not.toBeNull();

    // The token-stamping UPDATE should match the design exactly.
    const stampCall = mockQuery.mock.calls[3]!;
    expect(stampCall[0]).toMatch(/UPDATE users SET email_verified_at = NOW\(\)/i);
    expect(stampCall[0]).toMatch(/email_verified_at IS NULL/i);
    expect(stampCall[1]).toEqual(["user-1"]);

    const claims = jwt.decode(result!.token) as any;
    expect(claims.emailVerified).toBe(true);
    expect(result!.user.emailVerified).toBe(true);
  });

  it("returns null and does not stamp anything for an expired token", async () => {
    const past = new Date(Date.now() - 60 * 1000);
    mockQuery.mockResolvedValueOnce({
      rows: [{
        token_id: "tok-2",
        user_id: "user-2",
        expires_at: past,
        used_at: null,
        email: "x@x.com",
        role: "applicant",
        first_name: "X",
        last_name: "Y",
        is_active: true,
      }],
    } as any);

    const result = await verifyMagicLink("raw-token-expired1234567");
    expect(result).toBeNull();
    expect(mockQuery).toHaveBeenCalledTimes(1); // only the SELECT
  });

  it("returns null for a previously used token (no double-stamp)", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        token_id: "tok-3",
        user_id: "user-3",
        expires_at: new Date(Date.now() + 60 * 1000),
        used_at: new Date(),
        email: "x@x.com",
        role: "applicant",
        first_name: "X",
        last_name: "Y",
        is_active: true,
      }],
    } as any);

    const result = await verifyMagicLink("raw-token-already-used1234");
    expect(result).toBeNull();
  });
});
