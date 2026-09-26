import { describe, expect, it, beforeAll, afterAll } from "vitest";

describe("OpenAI BYOK helpers", () => {
  const prevSecret = process.env.KEY_ENCRYPTION_SECRET;
  const prevOpenai = process.env.OPENAI_API_KEY;
  const prevCodex = process.env.CODEX_API_KEY;
  let mod: typeof import("../server/userOpenaiByok.js");

  beforeAll(async () => {
    process.env.KEY_ENCRYPTION_SECRET =
      "test-secret-for-openai-byok-32bytes!!!!";
    delete process.env.OPENAI_API_KEY;
    delete process.env.CODEX_API_KEY;
    mod = await import("../server/userOpenaiByok.js");
  });

  afterAll(() => {
    if (prevSecret === undefined) delete process.env.KEY_ENCRYPTION_SECRET;
    else process.env.KEY_ENCRYPTION_SECRET = prevSecret;
    if (prevOpenai === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = prevOpenai;
    if (prevCodex === undefined) delete process.env.CODEX_API_KEY;
    else process.env.CODEX_API_KEY = prevCodex;
  });

  it("saves, reads, hints, and clears an OpenAI key", () => {
    const userId = `user_openai_${Date.now()}`;

    expect(mod.userOpenaiByokConfigured(userId)).toBe(false);
    expect(mod.resolveOpenaiApiKey(userId)).toBe("");

    const { hint } = mod.setUserOpenaiByokKey(userId, "sk-test-openai-123456");
    expect(hint.length).toBeGreaterThan(0);
    expect(mod.userOpenaiByokConfigured(userId)).toBe(true);
    expect(mod.getUserOpenaiByokKey(userId)).toBe("sk-test-openai-123456");
    expect(mod.userOpenaiByokHint(userId)).toBeTruthy();
    expect(mod.resolveOpenaiApiKey(userId)).toBe("sk-test-openai-123456");
    expect(mod.resolveOpenaiApiKey(userId, "sk-pasted")).toBe("sk-pasted");

    mod.clearUserOpenaiByokKey(userId);
    expect(mod.userOpenaiByokConfigured(userId)).toBe(false);
    expect(mod.getUserOpenaiByokKey(userId)).toBe("");
  });

  it("falls back to server OPENAI_API_KEY then CODEX_API_KEY", () => {
    process.env.OPENAI_API_KEY = "sk-openai-server";
    expect(mod.resolveOpenaiApiKey(`user_none_${Date.now()}`)).toBe(
      "sk-openai-server",
    );
    delete process.env.OPENAI_API_KEY;
    process.env.CODEX_API_KEY = "sk-codex-server";
    expect(mod.resolveOpenaiApiKey(`user_none_${Date.now()}`)).toBe(
      "sk-codex-server",
    );
    delete process.env.CODEX_API_KEY;
  });
});
