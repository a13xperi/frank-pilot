/**
 * ApplicationService.submit() fires a field-trail event on the draft -> submitted transition
 * (onboarding.walkthrough_complete). Fire-and-forget; it must never affect submission. These
 * tests pin: the event fires with the right actor on success, and a non-draft app (no row
 * updated -> throws) neither submits nor emits.
 */
const mockQuery = jest.fn();
jest.mock("../config/database", () => ({ query: mockQuery, transaction: jest.fn() }));
jest.mock("../middleware/audit", () => ({ writeAuditLog: jest.fn().mockResolvedValue(undefined) }));
jest.mock("../utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock("../utils/encryption", () => ({
  encrypt: jest.fn(), decrypt: jest.fn(), hashSSN: jest.fn(), maskSSN: jest.fn(),
}));
jest.mock("../modules/screening/fraud-detection", () => ({
  FraudDetectionService: jest.fn().mockImplementation(() => ({})),
}));
jest.mock("../modules/screening/state-machine", () => ({ transitionApplicationStatus: jest.fn() }));

const mockEmit = jest.fn().mockResolvedValue(true);
jest.mock("../modules/integrations/field-trail-emit", () => ({
  getFieldTrailEmitter: () => ({ emit: mockEmit }),
}));

import { ApplicationService } from "../modules/application/service";

describe("ApplicationService.submit — field-trail walkthrough_complete", () => {
  const OLD_ENV = process.env;
  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...OLD_ENV };
    // keep every post-submit branch dark so submit() falls through to the plain return
    delete process.env.IDENTITY_VERIFICATION_ENABLED;
    delete process.env.CONSUMER_REPORT_ENABLED;
    delete process.env.SCREENING_ON_SUBMIT_ENABLED;
  });
  afterEach(() => {
    process.env = OLD_ENV;
  });

  it("emits onboarding.walkthrough_complete (actor user:<id>) on a draft->submitted transition", async () => {
    mockQuery.mockResolvedValue({
      rows: [{ id: "app-1", status: "submitted", submitted_at: new Date().toISOString() }],
    });

    const res = await new ApplicationService().submit("app-1", "user-7", "applicant");

    expect(res.id).toBe("app-1");
    expect(mockEmit).toHaveBeenCalledTimes(1);
    expect(mockEmit).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: "user:user-7",
        eventType: "onboarding.walkthrough_complete",
      })
    );
  });

  it("does NOT emit when the app is not in draft (no row updated -> throws)", async () => {
    mockQuery.mockResolvedValue({ rows: [] });

    await expect(new ApplicationService().submit("app-x", "user-7", "applicant")).rejects.toThrow();
    expect(mockEmit).not.toHaveBeenCalled();
  });
});
