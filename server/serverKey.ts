import * as db from "./db.js";
import {
  decryptApiKey,
  encryptApiKey,
  encryptionConfigured,
  maskApiKey,
} from "./keyCrypto.js";

const SETTING_SERVER_KEY = "server_api_key";

/** Live env first, then encrypted DB pickup. */
export function getServerApiKey(): string {
  const fromEnv = process.env.CURSOR_API_KEY?.trim();
  if (fromEnv) return fromEnv;

  const stored = db.getSetting(SETTING_SERVER_KEY);
  if (!stored) return "";
  try {
    return decryptApiKey(stored);
  } catch (err) {
    console.error("Failed to decrypt stored server API key:", err);
    return "";
  }
}

export function serverKeyConfigured(): boolean {
  return getServerApiKey().length > 0;
}

export function serverKeySource(): "env" | "stored" | "none" {
  if (process.env.CURSOR_API_KEY?.trim()) return "env";
  if (db.getSetting(SETTING_SERVER_KEY)) return "stored";
  return "none";
}

export function serverKeyHint(): string | null {
  const key = getServerApiKey();
  return key ? maskApiKey(key) : null;
}

/** Persist a server key (encrypted). Cleared from being required in .env. */
export function setServerApiKey(apiKey: string): { hint: string } {
  const trimmed = apiKey.trim();
  if (!trimmed) throw new Error("apiKey is required");
  if (!encryptionConfigured()) {
    throw new Error("KEY_ENCRYPTION_SECRET is required to store a server key");
  }
  db.setSetting(SETTING_SERVER_KEY, encryptApiKey(trimmed));
  return { hint: maskApiKey(trimmed) };
}

export function clearServerApiKey(): void {
  db.deleteSetting(SETTING_SERVER_KEY);
}
