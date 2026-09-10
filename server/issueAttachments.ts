import {
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import { join, resolve } from "path";
import { randomBytes } from "crypto";
import {
  guessMime,
  isAllowedUpload,
  type PromptImage,
} from "./uploads.js";
import { safeAttachmentFileName } from "../shared/uploads.js";
import {
  MAX_ISSUE_ATTACHMENT_BYTES,
  MAX_ISSUE_ATTACHMENTS,
} from "../shared/issues.js";
import * as db from "./db.js";

function issueUploadsRoot(): string {
  const configured = process.env.ISSUE_UPLOAD_DIR?.trim();
  return configured
    ? resolve(configured)
    : resolve(import.meta.dirname, "../data/issue-uploads");
}

export function issueAttachmentDiskPath(
  issueId: string,
  attachmentId: string,
  name: string,
): string {
  return join(
    issueUploadsRoot(),
    issueId,
    `${attachmentId}-${safeAttachmentFileName(name)}`,
  );
}

export function saveIssueUpload(opts: {
  issueId: string;
  name: string;
  mime?: string;
  data: Buffer;
}): db.IssueAttachmentRow {
  if (opts.data.length === 0) throw new Error("Empty file");
  if (opts.data.length > MAX_ISSUE_ATTACHMENT_BYTES) {
    throw new Error(
      `File too large (max ${Math.round(MAX_ISSUE_ATTACHMENT_BYTES / 1024 / 1024)}MB)`,
    );
  }
  if (db.countIssueAttachments(opts.issueId) >= MAX_ISSUE_ATTACHMENTS) {
    throw new Error(`At most ${MAX_ISSUE_ATTACHMENTS} attachments per issue`);
  }
  const mime = (opts.mime || guessMime(opts.name)).toLowerCase();
  if (!isAllowedUpload(mime, opts.name)) {
    throw new Error("Unsupported file type");
  }
  const id = `iat_${randomBytes(8).toString("hex")}`;
  const path = issueAttachmentDiskPath(opts.issueId, id, opts.name);
  mkdirSync(join(issueUploadsRoot(), opts.issueId), { recursive: true });
  writeFileSync(path, opts.data);
  return db.createIssueAttachment({
    id,
    issueId: opts.issueId,
    name: opts.name.slice(0, 200),
    mime,
    size: opts.data.length,
    storagePath: path,
  });
}

export function readIssueAttachmentFile(
  row: db.IssueAttachmentRow,
): Buffer | null {
  if (!existsSync(row.storage_path)) return null;
  return readFileSync(row.storage_path);
}

export function removeIssueAttachmentFiles(issueId: string, attachmentId?: string): void {
  const rows = attachmentId
    ? [db.getIssueAttachment(issueId, attachmentId)].filter(Boolean)
    : db.listIssueAttachments(issueId);
  for (const row of rows) {
    if (!row) continue;
    try {
      if (existsSync(row.storage_path)) unlinkSync(row.storage_path);
    } catch {
      // ignore
    }
  }
}

export function issueAttachmentsToPromptImages(
  issueId: string,
): PromptImage[] {
  const out: PromptImage[] = [];
  for (const row of db.listIssueAttachments(issueId)) {
    if (!row.mime.startsWith("image/")) continue;
    const buf = readIssueAttachmentFile(row);
    if (!buf) continue;
    out.push({
      data: buf.toString("base64"),
      mimeType: row.mime,
    });
  }
  return out;
}

export function buildIssueAttachmentPromptNotes(issueId: string): string {
  const rows = db.listIssueAttachments(issueId);
  if (rows.length === 0) return "";
  const lines = ["Attached files:"];
  for (const row of rows) {
    const kind = row.mime.startsWith("image/")
      ? "image attached to this message"
      : `${row.mime}`;
    lines.push(`- ${row.name} (${kind}, ${row.size} bytes)`);
    if (
      (row.mime.startsWith("text/") ||
        row.mime === "application/json" ||
        row.mime === "application/pdf") &&
      row.size <= 64 * 1024 &&
      !row.mime.startsWith("image/")
    ) {
      const buf = readIssueAttachmentFile(row);
      if (buf && row.mime !== "application/pdf") {
        lines.push("```");
        lines.push(buf.toString("utf8").slice(0, 16_000));
        lines.push("```");
      }
    }
  }
  return lines.join("\n");
}
