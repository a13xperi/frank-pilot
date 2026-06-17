/**
 * call_placed genesis: the inbound voice webhook records onboarding.call_placed once per call.
 * deriveCallActor picks phone:<e164> when the agent collected a phone, else call:<conversation_id>
 * — so a trail can later rebind phone/call → user on magic-link verify.
 */
import { deriveCallActor } from "../modules/voice-intake/webhook";
import type { PostCallPayload } from "../modules/voice-intake/service";

const base = (extra: Partial<PostCallPayload> = {}): PostCallPayload => ({
  conversation_id: "conv-1",
  agent_id: "agent-1",
  ...extra,
});

describe("deriveCallActor — call_placed genesis actor", () => {
  it("uses a phone: actor when the agent collected a phone", () => {
    const data = base({
      analysis: { data_collection_results: { phone: { value: "7025550100" } } },
    });
    const actor = deriveCallActor(data);
    expect(actor.startsWith("phone:")).toBe(true);
    expect(actor).not.toBe("call:conv-1");
  });

  it("falls back to call:<conversation_id> when no phone was collected", () => {
    expect(deriveCallActor(base())).toBe("call:conv-1");
    expect(deriveCallActor(base({ analysis: { data_collection_results: {} } }))).toBe("call:conv-1");
    expect(deriveCallActor(base({ analysis: {} }))).toBe("call:conv-1");
  });
});
