/** Workspace-relative folder where Steer drops user attachments for local agents. */
export const ATTACHMENT_DIR = ".steer-uploads";

export function safeAttachmentFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 120) || "file";
}

/** HTTP header-safe Content-Disposition. Node rejects unicode in filename=. */
export function contentDispositionInline(name: string): string {
  const fallback = safeAttachmentFileName(name);
  const encoded = encodeURIComponent(
    name.replace(/[\r\n\0]+/g, " ").trim() || fallback,
  );
  return `inline; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

export function safeContentType(
  mime: string,
  fallback = "application/octet-stream",
): string {
  const trimmed = mime.trim().toLowerCase();
  return /^[\w.+-]+\/[\w.+-]+$/.test(trimmed) ? trimmed : fallback;
}

/** Path the agent should Read, relative to the run cwd. */
export function attachmentWorkspaceRelPath(id: string, name: string): string {
  return `${ATTACHMENT_DIR}/${id}-${safeAttachmentFileName(name)}`.replace(
    /\\/g,
    "/",
  );
}

export function isSafeAttachmentRelPath(relPath: string): boolean {
  const normalized = relPath.replace(/\\/g, "/");
  return (
    normalized.startsWith(`${ATTACHMENT_DIR}/`) &&
    !normalized.includes("..") &&
    !normalized.startsWith("/")
  );
}

export interface WorkerPromptAttachment {
  id: string;
  name: string;
  mime: string;
  relPath: string;
  /** Base64 file bytes. */
  data: string;
}
