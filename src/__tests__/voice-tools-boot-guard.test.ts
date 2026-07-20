/**
 * Tests for the C3 boot-guard (src/modules/voice-intake/boot-guard.ts):
 * VOICE_TOOLS_ENABLED=true must refuse to boot without a dedicated
 * ELEVENLABS_TOOL_SECRET — unset OR equal to the webhook HMAC secret both
 * defeat the separation. Extracted from src/index.ts so the pure check is
 * testable without spawning the boot path (mirrors payment/boot-guard).
 */
import {
  checkVoiceToolSecretConfig,
  assertVoiceToolSecretConfig,
} from "../modules/voice-intake/boot-guard";

describe("checkVoiceToolSecretConfig", () => {
  it("no-op while the tools receiver is dark", () => {
    expect(checkVoiceToolSecretConfig({})).toEqual({ enabled: false, violation: null });
    expect(
      checkVoiceToolSecretConfig({ VOICE_TOOLS_ENABLED: "false", ELEVENLABS_TOOL_SECRET: "" })
    ).toEqual({ enabled: false, violation: null });
  });

  it("flags a missing tool secret when the tools receiver is enabled", () => {
    expect(checkVoiceToolSecretConfig({ VOICE_TOOLS_ENABLED: "true" })).toEqual({
      enabled: true,
      violation: "missing",
    });
    expect(
      checkVoiceToolSecretConfig({ VOICE_TOOLS_ENABLED: "true", ELEVENLABS_TOOL_SECRET: "" })
    ).toEqual({ enabled: true, violation: "missing" });
  });

  it("flags a tool secret equal to the webhook secret (no separation)", () => {
    expect(
      checkVoiceToolSecretConfig({
        VOICE_TOOLS_ENABLED: "true",
        ELEVENLABS_TOOL_SECRET: "shared-secret",
        ELEVENLABS_WEBHOOK_SECRET: "shared-secret",
      })
    ).toEqual({ enabled: true, violation: "equals_webhook_secret" });
  });

  it("passes a dedicated, distinct tool secret", () => {
    expect(
      checkVoiceToolSecretConfig({
        VOICE_TOOLS_ENABLED: "true",
        ELEVENLABS_TOOL_SECRET: "eltool_dedicated",
        ELEVENLABS_WEBHOOK_SECRET: "wsec_webhook",
      })
    ).toEqual({ enabled: true, violation: null });
  });
});

describe("assertVoiceToolSecretConfig (boot adapter)", () => {
  let exitSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    exitSpy = jest.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => {
    exitSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("exits 1 on a violation", () => {
    assertVoiceToolSecretConfig({ VOICE_TOOLS_ENABLED: "true" });
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("ELEVENLABS_TOOL_SECRET"));
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("returns quietly when dark or correctly configured", () => {
    assertVoiceToolSecretConfig({});
    assertVoiceToolSecretConfig({
      VOICE_TOOLS_ENABLED: "true",
      ELEVENLABS_TOOL_SECRET: "eltool_dedicated",
      ELEVENLABS_WEBHOOK_SECRET: "wsec_webhook",
    });
    expect(exitSpy).not.toHaveBeenCalled();
  });
});
