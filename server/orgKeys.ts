import * as db from "./db.js";
import {
  decryptApiKey,
  encryptApiKey,
  encryptionConfigured,
  maskApiKey,
} from "./keyCrypto.js";

const CLEARED_SENTINEL = "__cleared__";

function cursorSettingKey(orgId: string): string {
  return `org_cursor_key:${orgId}`;
}

function anthropicSettingKey(orgId: string): string {
  return `org_anthropic_key:${orgId}`;
}

function openaiSettingKey(orgId: string): string {
  return `org_openai_key:${orgId}`;
}

function readOrgKey(setting: string, label: string): string {
  const stored = db.getSetting(setting);
  if (!stored || stored === CLEARED_SENTINEL) return "";
  try {
    return decryptApiKey(stored);
  } catch (err) {
    console.error(`Failed to decrypt ${label}:`, err);
    return "";
  }
}

function writeOrgKey(setting: string, apiKey: string): { hint: string } {
  const trimmed = apiKey.trim();
  if (!trimmed) throw new Error("apiKey is required");
  if (!encryptionConfigured()) {
    throw new Error("KEY_ENCRYPTION_SECRET is required to store an org key");
  }
  db.setSetting(setting, encryptApiKey(trimmed));
  return { hint: maskApiKey(trimmed) };
}

/** Decrypt the org's shared Cursor API key, or empty string. */
export function getOrgCursorKey(orgId: string): string {
  return readOrgKey(cursorSettingKey(orgId), `org Cursor key for ${orgId}`);
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
  return writeOrgKey(cursorSettingKey(orgId), apiKey);
}

export function clearOrgCursorKey(orgId: string): void {
  db.setSetting(cursorSettingKey(orgId), CLEARED_SENTINEL);
}

/** Decrypt the org's shared Anthropic API key, or empty string. */
export function getOrgAnthropicKey(orgId: string): string {
  return readOrgKey(
    anthropicSettingKey(orgId),
    `org Anthropic key for ${orgId}`,
  );
}

export function orgAnthropicKeyConfigured(orgId: string): boolean {
  return getOrgAnthropicKey(orgId).length > 0;
}

export function orgAnthropicKeyHint(orgId: string): string | null {
  const key = getOrgAnthropicKey(orgId);
  return key ? maskApiKey(key) : null;
}

export function setOrgAnthropicKey(
  orgId: string,
  apiKey: string,
): { hint: string } {
  return writeOrgKey(anthropicSettingKey(orgId), apiKey);
}

export function clearOrgAnthropicKey(orgId: string): void {
  db.setSetting(anthropicSettingKey(orgId), CLEARED_SENTINEL);
}

/** Decrypt the org's shared OpenAI API key, or empty string. */
export function getOrgOpenaiKey(orgId: string): string {
  return readOrgKey(openaiSettingKey(orgId), `org OpenAI key for ${orgId}`);
}

export function orgOpenaiKeyConfigured(orgId: string): boolean {
  return getOrgOpenaiKey(orgId).length > 0;
}

export function orgOpenaiKeyHint(orgId: string): string | null {
  const key = getOrgOpenaiKey(orgId);
  return key ? maskApiKey(key) : null;
}

export function setOrgOpenaiKey(
  orgId: string,
  apiKey: string,
): { hint: string } {
  return writeOrgKey(openaiSettingKey(orgId), apiKey);
}

export function clearOrgOpenaiKey(orgId: string): void {
  db.setSetting(openaiSettingKey(orgId), CLEARED_SENTINEL);
}
