import * as db from "./db.js";
import {
  decryptApiKey,
  encryptApiKey,
  encryptionConfigured,
  maskApiKey,
} from "./keyCrypto.js";
import { getOrgAnthropicKey } from "./orgKeys.js";

function settingKey(userId: string): string {
  return `user_anthropic_byok:${userId}`;
}

/** Explicit clear marker so Clear doesn't leave a stale empty string ambiguity. */
const CLEARED_SENTINEL = "__cleared__";

/** Decrypt the user's saved Anthropic API key, or empty string. */
export function getUserAnthropicByokKey(userId: string): string {
  const stored = db.getSetting(settingKey(userId));
  if (!stored || stored === CLEARED_SENTINEL) return "";
  try {
    return decryptApiKey(stored);
  } catch (err) {
    console.error(
      `Failed to decrypt Anthropic BYOK key for user ${userId}:`,
      err,
    );
    return "";
  }
}

export function userAnthropicByokConfigured(userId: string): boolean {
  return getUserAnthropicByokKey(userId).length > 0;
}

export function userAnthropicByokHint(userId: string): string | null {
  const key = getUserAnthropicByokKey(userId);
  return key ? maskApiKey(key) : null;
}

/** Persist (or replace) the user's Anthropic BYOK key — encrypted at rest. */
export function setUserAnthropicByokKey(
  userId: string,
  apiKey: string,
): { hint: string } {
  const trimmed = apiKey.trim();
  if (!trimmed) throw new Error("apiKey is required");
  if (!encryptionConfigured()) {
    throw new Error(
      "KEY_ENCRYPTION_SECRET is required to store an Anthropic BYOK key",
    );
  }
  db.setSetting(settingKey(userId), encryptApiKey(trimmed));
  return { hint: maskApiKey(trimmed) };
}

export function clearUserAnthropicByokKey(userId: string): void {
  db.setSetting(settingKey(userId), CLEARED_SENTINEL);
}

/**
 * Resolve Anthropic key for a Claude Code cloud run:
 * pasted key → org shared key → user's saved BYOK → server ANTHROPIC_API_KEY.
 */
export function resolveAnthropicApiKey(
  userId: string | null | undefined,
  pasted?: string | null,
  orgId?: string | null,
): string {
  const fromPaste = pasted?.trim() || "";
  if (fromPaste) return fromPaste;
  if (orgId) {
    const orgKey = getOrgAnthropicKey(orgId);
    if (orgKey) return orgKey;
  }
  if (userId) {
    const saved = getUserAnthropicByokKey(userId);
    if (saved) return saved;
  }
  return process.env.ANTHROPIC_API_KEY?.trim() || "";
}
