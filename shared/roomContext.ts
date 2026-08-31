/** Room-scoped repo map + shared memory contracts. */

export const MEMORY_KINDS = [
  "goal",
  "decision",
  "constraint",
  "discovery",
  "handoff",
] as const;

export type MemoryKind = (typeof MEMORY_KINDS)[number];

export const MEMORY_STATUSES = [
  "active",
  "proposed",
  "archived",
  "superseded",
] as const;

export type MemoryStatus = (typeof MEMORY_STATUSES)[number];

export type RepoMapStatus = "idle" | "scanning" | "ready" | "error";

export type RepoMapNodeKind = "file" | "symbol";
export type RepoMapEdgeRel = "contains" | "imports" | "requires" | "references";

export interface RepoMapNode {
  id: string;
  kind: RepoMapNodeKind;
  path: string;
  ext?: string;
  keywords: string[];
  name?: string;
  symbolType?: string;
  lineStart?: number;
  lineEnd?: number;
  exported?: boolean;
}

export interface RepoMapEdge {
  from: string;
  to: string;
  rel: RepoMapEdgeRel;
}

export interface RepoMapGraph {
  nodes: RepoMapNode[];
  edges: RepoMapEdge[];
}

export interface RepoMapInfo {
  id: string;
  roomId: string;
  repoKey: string;
  gitSha: string | null;
  status: RepoMapStatus;
  error?: string | null;
  fileCount: number;
  symbolCount: number;
  edgeCount: number;
  generatedAt: number;
}

export interface MemoryEntryInfo {
  id: string;
  roomId: string;
  kind: MemoryKind;
  title: string;
  content: string;
  status: MemoryStatus;
  pinned: boolean;
  revision: number;
  createdByUserId?: string | null;
  createdByAgentId?: string | null;
  createdAt: number;
  updatedAt: number;
  sourceMessageId?: string | null;
  sourcePath?: string | null;
  supersedesId?: string | null;
}

export interface AgentContextReceiptInfo {
  id: string;
  roomId: string;
  agentId: string;
  runId: string;
  mapId?: string | null;
  gitSha?: string | null;
  memoryVersion: number;
  entryIds: string[];
  fileIds: string[];
  isBaseline: boolean;
  createdAt: number;
}

export interface HandoffDraft {
  title: string;
  content: string;
  sourcePath?: string;
  branch?: string | null;
  prUrl?: string | null;
  touchedPaths: string[];
}

export interface RoomContextSnapshot {
  memoryVersion: number;
  map: RepoMapInfo | null;
  entries: MemoryEntryInfo[];
  lastReceiptByAgent: Record<string, AgentContextReceiptInfo>;
}

export interface PackedContext {
  text: string;
  memoryVersion: number;
  mapId: string | null;
  gitSha: string | null;
  entryIds: string[];
  fileIds: string[];
  isBaseline: boolean;
  estimatedChars: number;
}

export const MEMORY_TITLE_MAX = 160;
export const MEMORY_CONTENT_MAX = 4000;
export const CONTEXT_BUDGET_CHARS = 12_000;
export const BASELINE_BUDGET_CHARS = 8_000;
export const TASK_PACK_FILES = 12;
export const TASK_PACK_EDGES = 20;

const SECRET_PATTERNS: RegExp[] = [
  /\b(sk|rk|pk)-[A-Za-z0-9_-]{16,}\b/g,
  /\b(ghp|gho|github_pat)_[A-Za-z0-9_]{20,}\b/g,
  /\b(xox[baprs]-)[A-Za-z0-9-]{10,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bBearer\s+[A-Za-z0-9._\-+=/]{20,}\b/gi,
];

export function isMemoryKind(v: unknown): v is MemoryKind {
  return typeof v === "string" && (MEMORY_KINDS as readonly string[]).includes(v);
}

export function isMemoryStatus(v: unknown): v is MemoryStatus {
  return typeof v === "string" && (MEMORY_STATUSES as readonly string[]).includes(v);
}

export function stripControlChars(input: string): string {
  return input.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
}

export function redactSecrets(input: string): string {
  let out = input;
  for (const re of SECRET_PATTERNS) {
    out = out.replace(re, "[redacted]");
  }
  return out;
}

export function sanitizeMemoryText(
  input: unknown,
  max: number,
): string {
  if (typeof input !== "string") return "";
  return redactSecrets(stripControlChars(input)).trim().slice(0, max);
}

export function tokenizeQuery(text: string): string[] {
  const stop = new Set([
    "a",
    "an",
    "the",
    "to",
    "for",
    "with",
    "from",
    "and",
    "or",
    "of",
    "on",
    "in",
    "by",
    "you",
    "your",
    "can",
    "please",
    "fix",
    "update",
    "make",
    "show",
    "change",
    "do",
    "it",
    "this",
    "that",
    "api",
  ]);
  const words = text.toLowerCase().match(/[a-zA-Z0-9_]+/g) || [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const w of words) {
    if (w.length < 2 || stop.has(w) || seen.has(w)) continue;
    seen.add(w);
    out.push(w);
  }
  return out;
}

export type ContextIntent =
  | "debug"
  | "explain"
  | "test"
  | "refactor"
  | "feature"
  | "edit"
  | "general";

export function classifyIntent(query: string): ContextIntent {
  const q = query.toLowerCase();
  if (/\b(GET|POST|PUT|DELETE|PATCH)\s+\//i.test(query)) return "debug";
  if (/\b(why|explain|architecture|how does)\b/.test(q)) return "explain";
  if (/\b(error|bug|crash|failing|broken|exception|404|500)\b/.test(q)) {
    return "debug";
  }
  if (/\b(test|coverage|spec)\b/.test(q)) return "test";
  if (/\b(refactor|cleanup|simplify|optimize)\b/.test(q)) return "refactor";
  if (/\b(add|create|implement|build|support)\b/.test(q)) return "feature";
  if (/\b(fix|update|change|edit|modify|patch)\b/.test(q)) return "edit";
  return "general";
}

export function wrapUntrustedBlock(tag: string, attrs: string, body: string): string {
  return `<${tag}${attrs ? ` ${attrs}` : ""}>\n${body.trim()}\n</${tag}>`;
}
