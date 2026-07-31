import * as db from "./db.js";
import {
  decryptApiKey,
  encryptApiKey,
  encryptionConfigured,
  maskApiKey,
} from "./keyCrypto.js";

function settingKey(orgId: string): string {
  return `org_cursor_key:${orgId}`;
}

const CLEARED_SENTINEL = "__cleared__";

/** Decrypt the org's shared Cursor API key, or empty string. */
export function getOrgCursorKey(orgId: string): string {
  const stored = db.getSetting(settingKey(orgId));
  if (!stored || stored === CLEARED_SENTINEL) return "";
  try {
    return decryptApiKey(stored);
  } catch (err) {
    console.error(`Failed to decrypt org Cursor key for ${orgId}:`, err);
    return "";
  }
}

export function orgCursorKeyConfigured(orgId: string): boolean {
  return getOrgCursorKey(orgId).length > 0;
}

export function orgCursorKeyHint(orgId: string): string | null {
  const key = getOrgCursorKey(orgId);
  return key ? maskApiKey(key) : null;
}

export function setOrgCursorKey(
  orgId: string,
  apiKey: string,
): { hint: string } {
  const trimmed = apiKey.trim();
  if (!trimmed) throw new Error("apiKey is required");
  if (!encryptionConfigured()) {
    throw new Error("KEY_ENCRYPTION_SECRET is required to store an org key");
  }
  db.setSetting(settingKey(orgId), encryptApiKey(trimmed));
  return { hint: maskApiKey(trimmed) };
}

export function clearOrgCursorKey(orgId: string): void {
  db.setSetting(settingKey(orgId), CLEARED_SENTINEL);
}
