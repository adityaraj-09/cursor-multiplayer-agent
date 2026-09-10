export const ISSUE_STATUSES = [
  "draft",
  "queued",
  "running",
  "needs_input",
  "in_review",
  "done",
  "failed",
  "cancelled",
] as const;

export type IssueStatus = (typeof ISSUE_STATUSES)[number];

export const ISSUE_PRIORITIES = ["low", "medium", "high", "urgent"] as const;
export type IssuePriority = (typeof ISSUE_PRIORITIES)[number];

export const DEFAULT_PICKUP_DELAY_MS = 10 * 60 * 1000;
export const MIN_PICKUP_DELAY_MS = 0;
export const MAX_PICKUP_DELAY_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_MAX_CONCURRENT_ISSUES = 2;
export const MAX_CONCURRENT_ISSUES_CAP = 8;
export const ISSUE_LEASE_MS = 12 * 60 * 1000;
export const ISSUE_POLL_MS = 15_000;
export const ISSUE_HEARTBEAT_MS = 30_000;
export const MAX_ISSUE_TITLE = 200;
export const MAX_ISSUE_DESCRIPTION = 20_000;
export const MAX_WRITEUP_CHARS = 80_000;
export const MAX_ISSUE_ATTACHMENTS = 8;
export const MAX_ISSUE_ATTACHMENT_BYTES = 8 * 1024 * 1024;
export const MAX_ISSUE_ATTEMPTS = 3;

export interface IssueAttachmentInfo {
  id: string;
  issueId: string;
  name: string;
  mime: string;
  size: number;
  url: string;
  createdAt: number;
}

export interface IssueEventInfo {
  id: string;
  issueId: string;
  kind: string;
  message: string;
  createdAt: number;
}

export interface IssueInfo {
  id: string;
  orgId?: string | null;
  creatorId: string;
  creatorName?: string | null;
  title: string;
  description: string;
  repoUrl: string;
  startingRef: string;
  priority: IssuePriority;
  status: IssueStatus;
  pickupDelayMs: number;
  runAfter: number;
  startedAt?: number | null;
  finishedAt?: number | null;
  modelId: string;
  cursorAgentId?: string | null;
  prUrl?: string | null;
  branch?: string | null;
  error?: string | null;
  writeupMd?: string | null;
  attempt: number;
  createdAt: number;
  updatedAt: number;
  attachments: IssueAttachmentInfo[];
  events?: IssueEventInfo[];
}

export interface IssueSettingsInfo {
  scopeKey: string;
  defaultPickupDelayMs: number;
  autoStart: boolean;
  modelId: string;
  maxConcurrent: number;
  updatedAt: number;
}

export function isIssueStatus(value: unknown): value is IssueStatus {
  return (
    typeof value === "string" &&
    (ISSUE_STATUSES as readonly string[]).includes(value)
  );
}

export function isIssuePriority(value: unknown): value is IssuePriority {
  return (
    typeof value === "string" &&
    (ISSUE_PRIORITIES as readonly string[]).includes(value)
  );
}

export function issueSettingsScopeKey(input: {
  orgId?: string | null;
  userId: string;
}): string {
  const orgId = input.orgId?.trim();
  if (orgId && orgId !== "personal") return `org:${orgId}`;
  return `user:${input.userId}`;
}

export function clampPickupDelayMs(raw: unknown, fallback = DEFAULT_PICKUP_DELAY_MS): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(MAX_PICKUP_DELAY_MS, Math.max(MIN_PICKUP_DELAY_MS, Math.round(n)));
}

export function clampMaxConcurrent(raw: unknown): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_MAX_CONCURRENT_ISSUES;
  return Math.min(
    MAX_CONCURRENT_ISSUES_CAP,
    Math.max(1, Math.round(n)),
  );
}

export function parseGithubHttpsRepo(raw: string): string | null {
  const trimmed = raw.trim().replace(/\.git$/i, "");
  const m = trimmed.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+?)\/?$/i);
  if (!m) return null;
  return `https://github.com/${m[1]}/${m[2]}`;
}

export function issueStatusLabel(status: IssueStatus): string {
  switch (status) {
    case "draft":
      return "Draft";
    case "queued":
      return "Queued";
    case "running":
      return "Running";
    case "needs_input":
      return "Needs input";
    case "in_review":
      return "In review";
    case "done":
      return "Done";
    case "failed":
      return "Failed";
    case "cancelled":
      return "Cancelled";
  }
}

export function canEditIssue(
  issue: { creatorId: string; orgId?: string | null },
  actor: { userId: string; orgRole?: string | null },
): boolean {
  if (issue.creatorId === actor.userId) return true;
  return actor.orgRole === "owner" || actor.orgRole === "admin";
}

export function canQueueIssue(status: IssueStatus): boolean {
  return status === "draft" || status === "failed" || status === "cancelled";
}

export function canCancelIssue(status: IssueStatus): boolean {
  return status === "draft" || status === "queued" || status === "running";
}

export function canRetryIssue(status: IssueStatus): boolean {
  return status === "failed" || status === "cancelled" || status === "needs_input";
}

/** Unwrap a full-document markdown fence the model sometimes wraps around writeups. */
export function sanitizeIssueWriteup(raw: string): string {
  let text = raw.replace(/\u0000/g, "").trim();
  if (!text) return "";
  const fenced = text.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```\s*$/i);
  if (fenced?.[1]) text = fenced[1].trim();
  if (text.length > MAX_WRITEUP_CHARS) {
    text = text.slice(0, MAX_WRITEUP_CHARS).trimEnd();
  }
  return text;
}

export function buildIssueFixPrompt(input: {
  issueId: string;
  title: string;
  description: string;
  repoUrl: string;
  startingRef: string;
  attachmentNotes?: string;
}): string {
  const desc = input.description.trim() || "(no additional description)";
  const attachments = input.attachmentNotes?.trim()
    ? `\n\n${input.attachmentNotes.trim()}`
    : "";
  return [
    `You are fixing Steer issue ${input.issueId} in ${input.repoUrl} (base branch: ${input.startingRef}).`,
    "",
    `Title: ${input.title}`,
    "",
    "Description:",
    desc,
    attachments,
    "",
    "Rules:",
    "- Implement the fix on a feature branch and open a pull request to the base branch.",
    "- Pull request title/body may be short. Do not put a long writeup in the PR or in any repository file.",
    "- Do not create or edit markdown/docs files for this issue (no ISSUE.md, WRITEUP.md, architecture notes, etc.).",
    "- Do not ask clarifying questions. If something is ambiguous, pick the safest reasonable default and continue.",
    "- Do not wait for a human. Finish the change and the pull request.",
  ].join("\n");
}

export function buildIssueWriteupPrompt(input: {
  issueId: string;
  title: string;
  prUrl?: string | null;
}): string {
  const pr = input.prUrl?.trim()
    ? `A pull request is at ${input.prUrl.trim()}.`
    : "If a pull request was opened, mention it in one line; do not invent a URL.";
  return [
    `The code change for Steer issue ${input.issueId} ("${input.title}") is done. ${pr}`,
    "",
    "Write a markdown note for the issue tracker only. Output markdown text and nothing else.",
    "Do not create or edit any files. Do not run more implementation work.",
    "",
    "Cover:",
    "- What the issue was",
    "- The cause",
    "- What you changed",
    "",
    "Markdown only. No JSON. No tool calls unless you must recall what you already changed.",
  ].join("\n");
}
