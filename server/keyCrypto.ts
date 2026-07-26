import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "crypto";

const ALGO = "aes-256-gcm";

function getKeyMaterial(): Buffer {
  const secret = process.env.KEY_ENCRYPTION_SECRET?.trim();
  if (!secret) {
    throw new Error(
      "KEY_ENCRYPTION_SECRET is required to store BYOK keys encrypted",
    );
  }
  // Accept 64-char hex or any passphrase → derive 32-byte key
  if (/^[0-9a-fA-F]{64}$/.test(secret)) {
    return Buffer.from(secret, "hex");
  }
  return createHash("sha256").update(secret).digest();
}

/** Encrypt plaintext API key. Returns `iv:tag:ciphertext` (all hex). */
export function encryptApiKey(plaintext: string): string {
  const key = getKeyMaterial();
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${enc.toString("hex")}`;
}

/** Decrypt a value produced by {@link encryptApiKey}. */
export function decryptApiKey(payload: string): string {
  const key = getKeyMaterial();
  const [ivHex, tagHex, dataHex] = payload.split(":");
  if (!ivHex || !tagHex || !dataHex) {
    throw new Error("Invalid encrypted key payload");
  }
  const decipher = createDecipheriv(ALGO, key, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  const dec = Buffer.concat([
    decipher.update(Buffer.from(dataHex, "hex")),
    decipher.final(),
  ]);
  return dec.toString("utf8");
}

export function maskApiKey(key: string): string {
  const trimmed = key.trim();
  if (trimmed.length <= 8) return "••••";
  return `${trimmed.slice(0, 4)}…${trimmed.slice(-4)}`;
}

export function encryptionConfigured(): boolean {
  return Boolean(process.env.KEY_ENCRYPTION_SECRET?.trim());
}
