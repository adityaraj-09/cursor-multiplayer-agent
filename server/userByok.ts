import * as db from "./db.js";
import {
  decryptApiKey,
  encryptApiKey,
  encryptionConfigured,
  maskApiKey,
} from "./keyCrypto.js";

function settingKey(userId: string): string {
  return `user_byok:${userId}`;
}

/** Explicit clear marker so we don't re-migrate from old rooms after Clear. */
const CLEARED_SENTINEL = "__cleared__";

/**
 * If the user never saved a BYOK key to settings (older sessions only
 * stored it on the room), pull the newest owned BYOK room key and
 * migrate it into the user store so they don't have to re-paste.
 */
function migrateFromOwnedRooms(userId: string): string {
  if (!encryptionConfigured()) return "";
  const rooms = db.listRoomsByUser(userId);
  const ownedByok = rooms
    .filter(
      (r) =>
        r.owner_id === userId &&
        r.auth_mode === "byok" &&
        Boolean(r.key_ciphertext),
    )
    .sort((a, b) => b.created_at - a.created_at);
  for (const room of ownedByok) {
    try {
      const key = decryptApiKey(room.key_ciphertext!);
      if (!key) continue;
      db.setSetting(settingKey(userId), encryptApiKey(key));
      return key;
    } catch (err) {
      console.error(
        `Failed to migrate BYOK key from room ${room.id} for user ${userId}:`,
        err,
      );
    }
  }
  return "";
}

/** Decrypt the user's saved BYOK Cursor API key, or empty string. */
export function getUserByokKey(userId: string): string {
  const stored = db.getSetting(settingKey(userId));
  if (stored === CLEARED_SENTINEL) return "";
  if (stored) {
    try {
      return decryptApiKey(stored);
    } catch (err) {
      console.error(`Failed to decrypt BYOK key for user ${userId}:`, err);
      return "";
    }
  }
  return migrateFromOwnedRooms(userId);
}

export function userByokConfigured(userId: string): boolean {
  return getUserByokKey(userId).length > 0;
}

export function userByokHint(userId: string): string | null {
  const key = getUserByokKey(userId);
  return key ? maskApiKey(key) : null;
}

/** Persist (or replace) the user's BYOK key — encrypted at rest. */
export function setUserByokKey(
  userId: string,
  apiKey: string,
): { hint: string } {
  const trimmed = apiKey.trim();
  if (!trimmed) throw new Error("apiKey is required");
  if (!encryptionConfigured()) {
    throw new Error("KEY_ENCRYPTION_SECRET is required to store a BYOK key");
  }
  db.setSetting(settingKey(userId), encryptApiKey(trimmed));
  return { hint: maskApiKey(trimmed) };
}

export function clearUserByokKey(userId: string): void {
  // Sentinel prevents migrateFromOwnedRooms from bringing the key back.
  db.setSetting(settingKey(userId), CLEARED_SENTINEL);
}
