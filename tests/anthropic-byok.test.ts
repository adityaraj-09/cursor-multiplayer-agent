import { describe, expect, it, beforeAll, afterAll } from "vitest";

/**
 * Relies on tests/setup.ts setting SQLITE_PATH before modules load.
 * KEY_ENCRYPTION_SECRET must be set for encrypt/decrypt.
 */
describe("Anthropic BYOK helpers", () => {
  const prevSecret = process.env.KEY_ENCRYPTION_SECRET;
  const prevAnthropic = process.env.ANTHROPIC_API_KEY;
  let mod: typeof import("../server/userAnthropicByok.js");

  beforeAll(async () => {
    process.env.KEY_ENCRYPTION_SECRET =
      "test-secret-for-anthropic-byok-32bytes!!";
    delete process.env.ANTHROPIC_API_KEY;
    mod = await import("../server/userAnthropicByok.js");
  });

  afterAll(() => {
    if (prevSecret === undefined) delete process.env.KEY_ENCRYPTION_SECRET;
    else process.env.KEY_ENCRYPTION_SECRET = prevSecret;
    if (prevAnthropic === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = prevAnthropic;
  });

  it("saves, reads, hints, and clears an Anthropic key", () => {
    const userId = `user_anthropic_${Date.now()}`;

    expect(mod.userAnthropicByokConfigured(userId)).toBe(false);
    expect(mod.resolveAnthropicApiKey(userId)).toBe("");

    const { hint } = mod.setUserAnthropicByokKey(
      userId,
      "sk-ant-test-key-123456",
    );
    expect(hint.length).toBeGreaterThan(0);
    expect(mod.userAnthropicByokConfigured(userId)).toBe(true);
    expect(mod.getUserAnthropicByokKey(userId)).toBe("sk-ant-test-key-123456");
    expect(mod.userAnthropicByokHint(userId)).toBeTruthy();
    expect(mod.resolveAnthropicApiKey(userId)).toBe("sk-ant-test-key-123456");
    expect(mod.resolveAnthropicApiKey(userId, "sk-ant-pasted")).toBe(
      "sk-ant-pasted",
    );

    mod.clearUserAnthropicByokKey(userId);
    expect(mod.userAnthropicByokConfigured(userId)).toBe(false);
    expect(mod.getUserAnthropicByokKey(userId)).toBe("");
  });

  it("falls back to server ANTHROPIC_API_KEY", () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-server";
    expect(mod.resolveAnthropicApiKey(`user_none_${Date.now()}`)).toBe(
      "sk-ant-server",
    );
    delete process.env.ANTHROPIC_API_KEY;
  });
});
