import { mkdirSync, writeFileSync, readFileSync, unlinkSync, existsSync, readdirSync, statSync } from "fs";
import { dirname, join, resolve } from "path";
import { randomBytes } from "crypto";
import type { ChatAttachment } from "../shared/events.js";

const TTL_MS = 24 * 60 * 60 * 1000;
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_FILES_PER_MESSAGE = 6;

const ALLOWED_MIME = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "application/pdf",
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/json",
]);

const EXT_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  pdf: "application/pdf",
  txt: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
  json: "application/json",
};

export interface StoredUpload {
  id: string;
  roomId: string;
  name: string;
  mime: string;
  size: number;
  createdAt: number;
  path: string;
}

function uploadsRoot(): string {
  const configured = process.env.UPLOAD_DIR?.trim();
  return configured
    ? resolve(configured)
    : resolve(import.meta.dirname, "../data/uploads");
}

function metaPath(filePath: string): string {
  return `${filePath}.json`;
}

function safeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 120) || "file";
}

export function guessMime(name: string, fallback = "application/octet-stream"): string {
  const ext = name.split(".").pop()?.toLowerCase() || "";
  return EXT_MIME[ext] || fallback;
}

export function isAllowedUpload(mime: string, name: string): boolean {
  if (ALLOWED_MIME.has(mime)) return true;
  return Boolean(EXT_MIME[name.split(".").pop()?.toLowerCase() || ""]);
}

export function saveUpload(opts: {
  roomId: string;
  name: string;
  mime?: string;
  data: Buffer;
}): StoredUpload {
  if (opts.data.length === 0) throw new Error("Empty file");
  if (opts.data.length > MAX_BYTES) {
    throw new Error(`File too large (max ${Math.round(MAX_BYTES / 1024 / 1024)}MB)`);
  }
  const mime = (opts.mime || guessMime(opts.name)).toLowerCase();
  if (!isAllowedUpload(mime, opts.name)) {
    throw new Error("Unsupported file type");
  }

  const id = `upl_${randomBytes(8).toString("hex")}`;
  const dir = join(uploadsRoot(), opts.roomId);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${id}-${safeName(opts.name)}`);
  writeFileSync(path, opts.data);
  const rec: StoredUpload = {
    id,
    roomId: opts.roomId,
    name: opts.name.slice(0, 200),
    mime,
    size: opts.data.length,
    createdAt: Date.now(),
    path,
  };
  writeFileSync(metaPath(path), JSON.stringify(rec));
  return rec;
}

export function getUpload(roomId: string, id: string): StoredUpload | undefined {
  const dir = join(uploadsRoot(), roomId);
  if (!existsSync(dir)) return undefined;
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".json")) continue;
    if (!name.startsWith(id)) continue;
    try {
      const rec = JSON.parse(
        readFileSync(join(dir, name), "utf8"),
      ) as StoredUpload;
      if (rec.id !== id || rec.roomId !== roomId) continue;
      if (Date.now() - rec.createdAt > TTL_MS) {
        purgeUpload(rec);
        return undefined;
      }
      if (!existsSync(rec.path)) return undefined;
      return rec;
    } catch {
      // ignore
    }
  }
  return undefined;
}

export function readUpload(rec: StoredUpload): Buffer {
  return readFileSync(rec.path);
}

export function toAttachment(rec: StoredUpload): ChatAttachment {
  return {
    id: rec.id,
    name: rec.name,
    mime: rec.mime,
    size: rec.size,
    url: `/api/rooms/${rec.roomId}/uploads/${rec.id}`,
  };
}

export function resolveUploads(
  roomId: string,
  ids: string[],
): StoredUpload[] {
  const unique = [...new Set(ids.filter(Boolean))].slice(0, MAX_FILES_PER_MESSAGE);
  const out: StoredUpload[] = [];
  for (const id of unique) {
    const rec = getUpload(roomId, id);
    if (rec) out.push(rec);
  }
  return out;
}

export function isTextUpload(mime: string): boolean {
  return mime.startsWith("text/") || mime === "application/json";
}

export function isImageUpload(mime: string): boolean {
  return mime.startsWith("image/");
}

/** Copy attachments into the agent cwd so local/CLI agents can Read them. */
export function materializeUploadsForAgent(
  cwd: string | undefined,
  uploads: StoredUpload[],
): Array<{ rec: StoredUpload; agentPath: string }> {
  if (!cwd || !existsSync(cwd) || uploads.length === 0) return [];
  const dest = join(cwd, ".steer-uploads");
  mkdirSync(dest, { recursive: true });
  return uploads.map((rec) => {
    const agentPath = join(dest, `${rec.id}-${safeName(rec.name)}`);
    if (!existsSync(agentPath)) {
      writeFileSync(agentPath, readFileSync(rec.path));
    }
    return { rec, agentPath };
  });
}

export interface PromptImage {
  data: string;
  mimeType: string;
}

/** Base64 images for Cursor SDK `send({ text, images })`. */
export function toPromptImages(uploads: StoredUpload[]): PromptImage[] {
  return uploads
    .filter((u) => isImageUpload(u.mime))
    .map((u) => ({
      data: readUpload(u).toString("base64"),
      mimeType: u.mime,
    }));
}

export function buildAttachmentPromptSuffix(
  uploads: StoredUpload[],
  materialized: Array<{ rec: StoredUpload; agentPath: string }>,
  opts?: { imagesAttachedToMessage?: boolean },
): string {
  if (uploads.length === 0) return "";
  const byId = new Map(materialized.map((m) => [m.rec.id, m.agentPath]));
  const parts = ["\n\nThe user attached the following file(s) for this message:"];
  for (const rec of uploads) {
    const local = byId.get(rec.id);
    const vision =
      opts?.imagesAttachedToMessage && isImageUpload(rec.mime);
    const where = local
      ? `saved at \`${local}\` — read this file`
      : vision
        ? "attached as an image on this message (you can see it)"
        : isTextUpload(rec.mime)
          ? "contents inlined below"
          : "available in the Steer session (no workspace path)";
    parts.push(`- ${rec.name} (${rec.mime}, ${rec.size} bytes) — ${where}`);
    if (isTextUpload(rec.mime) && rec.size <= 64 * 1024) {
      const text = readFileSync(rec.path, "utf8").slice(0, 16_000);
      parts.push("```");
      parts.push(text);
      parts.push("```");
    }
  }
  return parts.join("\n");
}

function purgeUpload(rec: StoredUpload): void {
  try {
    if (existsSync(rec.path)) unlinkSync(rec.path);
    const meta = metaPath(rec.path);
    if (existsSync(meta)) unlinkSync(meta);
  } catch {
    // ignore
  }
}

export function purgeExpiredUploads(): void {
  const root = uploadsRoot();
  if (!existsSync(root)) return;
  const now = Date.now();
  for (const room of readdirSync(root)) {
    const dir = join(root, room);
    try {
      if (!statSync(dir).isDirectory()) continue;
    } catch {
      continue;
    }
    for (const name of readdirSync(dir)) {
      if (!name.endsWith(".json")) continue;
      try {
        const rec = JSON.parse(
          readFileSync(join(dir, name), "utf8"),
        ) as StoredUpload;
        if (now - rec.createdAt > TTL_MS) purgeUpload(rec);
      } catch {
        // ignore
      }
    }
  }
}

// Keep dirname referenced so tree-shaking doesn't drop the import if unused later.
void dirname;
