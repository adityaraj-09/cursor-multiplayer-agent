import { describe, expect, it, beforeAll, afterAll } from "vitest";

/**
 * Cursor BYOK helpers used when adding a Cursor agent inside a Claude session.
 */
describe("Cursor BYOK reuse for mixed-backend rooms", () => {
  const prevSecret = process.env.KEY_ENCRYPTION_SECRET;
  let byok: typeof import("../server/userByok.js");
  let crypto: typeof import("../server/keyCrypto.js");

  beforeAll(async () => {
    process.env.KEY_ENCRYPTION_SECRET =
      "test-secret-for-cursor-byok-32bytes!!!!";
    byok = await import("../server/userByok.js");
    crypto = await import("../server/keyCrypto.js");
  });

  afterAll(() => {
    if (prevSecret === undefined) delete process.env.KEY_ENCRYPTION_SECRET;
    else process.env.KEY_ENCRYPTION_SECRET = prevSecret;
  });

  it("saves and reads a Cursor BYOK key for later Cursor agents", () => {
    const userId = `user_cursor_byok_${Date.now()}`;
    expect(byok.userByokConfigured(userId)).toBe(false);

    const { hint } = byok.setUserByokKey(userId, "cursor_test_key_abcdef");
    expect(hint.length).toBeGreaterThan(0);
    expect(byok.userByokConfigured(userId)).toBe(true);
    expect(byok.getUserByokKey(userId)).toBe("cursor_test_key_abcdef");
    expect(byok.userByokHint(userId)).toBeTruthy();

    byok.clearUserByokKey(userId);
    expect(byok.userByokConfigured(userId)).toBe(false);
    expect(byok.getUserByokKey(userId)).toBe("");
  });

  it("round-trips room BYOK ciphertext for Claude→Cursor attach", () => {
    expect(crypto.encryptionConfigured()).toBe(true);
    const raw = "cursor_room_key_xyz";
    const cipher = crypto.encryptApiKey(raw);
    expect(crypto.decryptApiKey(cipher)).toBe(raw);
    expect(crypto.maskApiKey(raw).length).toBeGreaterThan(0);
  });
});
