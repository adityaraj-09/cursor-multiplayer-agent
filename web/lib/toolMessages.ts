import type { ChatMessage } from "../../shared/events";
import { isEditTool, isTodoTool } from "../../shared/backends/cursor";

export type ToolCategoryKey =
  | "edit"
  | "search"
  | "read"
  | "terminal"
  | "todo"
  | "other";

export interface ToolTypeGroup {
  key: ToolCategoryKey;
  label: string;
  description: string;
  messages: ChatMessage[];
}

const CATEGORY_ORDER: ToolCategoryKey[] = [
  "search",
  "read",
  "terminal",
  "edit",
  "todo",
  "other",
];

export function normalizeToolName(name?: string): string {
  const raw = (name || "tool").replace(/ToolCall$/i, "");
  return raw || "tool";
}

export function toolCategoryFor(message: ChatMessage): ToolCategoryKey {
  const name = normalizeToolName(message.toolName).toLowerCase();
  if (isTodoTool(name) || message.todos?.length) return "todo";
  if (isEditTool(name) || Boolean(message.diffPatch)) return "edit";
  if (
    /^(grep|glob|search|semsearch|find|list|ls|rg|websearch|webfetch)$/i.test(
      name,
    )
  ) {
    return "search";
  }
  if (/^(read|readfile|cat|open|fetch|readlints)$/i.test(name)) return "read";
  if (/^(shell|terminal|bash|command|exec|run)$/i.test(name)) {
    return "terminal";
  }
  return "other";
}

export function toolCategoryMeta(key: ToolCategoryKey): {
  label: string;
  description: string;
} {
  switch (key) {
    case "search":
      return { label: "Search", description: "Searched the workspace and web" };
    case "read":
      return { label: "Read files", description: "Inspected code and configuration" };
    case "terminal":
      return { label: "Terminal", description: "Executed commands in terminal" };
    case "edit":
      return { label: "Edits", description: "Changed files and generated diffs" };
    case "todo":
      return { label: "Todos", description: "Updated the working checklist" };
    default:
      return { label: "Other actions", description: "Additional operations" };
  }
}

export function groupToolMessages(messages: ChatMessage[]): ToolTypeGroup[] {
  const groups = new Map<ToolCategoryKey, ChatMessage[]>();
  for (const message of messages) {
    const category = toolCategoryFor(message);
    const existing = groups.get(category) || [];
    existing.push(message);
    groups.set(category, existing);
  }
  return CATEGORY_ORDER.flatMap((key) => {
    const grouped = groups.get(key) || [];
    if (grouped.length === 0) return [];
    const meta = toolCategoryMeta(key);
    return [{ key, ...meta, messages: grouped }];
  });
}

export function resolveToolPath(message: ChatMessage): string | null {
  const patch = message.diffPatch || "";
  const fromGit = patch.match(/^diff --git a\/(.+?) b\//m)?.[1];
  if (fromGit) return fromGit;
  const fromNewFile = patch.match(/^\+\+\+ b\/(.+)$/m)?.[1];
  if (fromNewFile && fromNewFile !== "/dev/null") return fromNewFile;
  const fromOldFile = patch.match(/^--- a\/(.+)$/m)?.[1];
  if (fromOldFile && fromOldFile !== "/dev/null") return fromOldFile;

  const content = message.content?.trim();
  if (!content || content.includes("\n")) return null;
  if (content.includes("/") || content.includes("\\") || /\.[\w-]+$/.test(content)) {
    return content;
  }
  return null;
}

export function toolFileLabel(message: ChatMessage): string {
  const path = resolveToolPath(message);
  if (!path) return "file";
  const parts = path.split(/[/\\]/);
  return parts[parts.length - 1] || path;
}

export function toolCallTitle(message: ChatMessage): string {
  const path = resolveToolPath(message);
  if (path && (toolCategoryFor(message) === "edit" || message.diffPatch)) {
    return toolFileLabel(message);
  }
  return normalizeToolName(message.toolName);
}

