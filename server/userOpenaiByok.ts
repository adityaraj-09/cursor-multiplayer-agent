import * as db from "./db.js";
import {
  decryptApiKey,
  encryptApiKey,
  encryptionConfigured,
  maskApiKey,
} from "./keyCrypto.js";
import { getOrgOpenaiKey } from "./orgKeys.js";

function settingKey(userId: string): string {
  return `user_openai_byok:${userId}`;
}

const CLEARED_SENTINEL = "__cleared__";

/** Decrypt the user's saved OpenAI API key, or empty string. */
export function getUserOpenaiByokKey(userId: string): string {
  const stored = db.getSetting(settingKey(userId));
  if (!stored || stored === CLEARED_SENTINEL) return "";
  try {
    return decryptApiKey(stored);
  } catch (err) {
    console.error(
      `Failed to decrypt OpenAI BYOK key for user ${userId}:`,
      err,
    );
    return "";
  }
}

export function userOpenaiByokConfigured(userId: string): boolean {
  return getUserOpenaiByokKey(userId).length > 0;
}

export function userOpenaiByokHint(userId: string): string | null {
  const key = getUserOpenaiByokKey(userId);
  return key ? maskApiKey(key) : null;
}

/** Persist (or replace) the user's OpenAI BYOK key — encrypted at rest. */
export function setUserOpenaiByokKey(
  userId: string,
  apiKey: string,
): { hint: string } {
  const trimmed = apiKey.trim();
  if (!trimmed) throw new Error("apiKey is required");
  if (!encryptionConfigured()) {
    throw new Error(
      "KEY_ENCRYPTION_SECRET is required to store an OpenAI BYOK key",
    );
  }
  db.setSetting(settingKey(userId), encryptApiKey(trimmed));
  return { hint: maskApiKey(trimmed) };
}

export function clearUserOpenaiByokKey(userId: string): void {
  db.setSetting(settingKey(userId), CLEARED_SENTINEL);
}

/**
 * Resolve OpenAI key for a Codex cloud run:
 * pasted key → org shared key → user's saved BYOK → server OPENAI_API_KEY / CODEX_API_KEY.
 */
export function resolveOpenaiApiKey(
  userId: string | null | undefined,
  pasted?: string | null,
  orgId?: string | null,
): string {
  const fromPaste = pasted?.trim() || "";
  if (fromPaste) return fromPaste;
  if (orgId) {
    const orgKey = getOrgOpenaiKey(orgId);
    if (orgKey) return orgKey;
  }
  if (userId) {
    const saved = getUserOpenaiByokKey(userId);
    if (saved) return saved;
  }
  return (
    process.env.OPENAI_API_KEY?.trim() ||
    process.env.CODEX_API_KEY?.trim() ||
    ""
  );
}
