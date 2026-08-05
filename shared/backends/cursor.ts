import type { AgentTodoItem } from "../events.js";
import type {
  BuildArgsOptions,
  NormalizedAgentEvent,
  ParseLineContext,
  WorkerBackend,
} from "./types.js";

function extractText(message: unknown): string {
  if (!message || typeof message !== "object") return "";
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (part && typeof part === "object" && "text" in part) {
        return String((part as { text: unknown }).text ?? "");
      }
      return "";
    })
    .join("");
}

/** Max chars of tool result text we persist into chat content. */
export const TOOL_RESULT_DETAIL_LIMIT = 8_000;

function toolInfo(toolCall: Record<string, unknown> | undefined): {
  name: string;
  detail: string;
  path?: string;
  args?: Record<string, unknown>;
  result?: unknown;
  parentCallId?: string;
} {
  if (!toolCall) return { name: "tool", detail: "" };
  // Prefer explicit *ToolCall keys — Cursor sometimes also attaches metadata
  // objects that would otherwise win Object.keys().find().
  const toolCallKey = Object.keys(toolCall).find((k) => k.endsWith("ToolCall"));
  const key =
    toolCallKey ||
    Object.keys(toolCall).find(
      (k) =>
        ![
          "hookAdditionalContexts",
          "toolCallId",
          "startedAtMs",
          "completedAtMs",
          "parentToolCallId",
          "parent_tool_call_id",
        ].includes(k) && typeof toolCall[k] === "object",
    );
  const name = key ? key.replace(/ToolCall$/, "") : "tool";
  const body = key ? (toolCall[key] as Record<string, unknown>) : undefined;
  const rawArgs = body?.args ?? body?.input ?? body?.parameters;
  const args = coerceArgsObject(rawArgs);
  const result = body?.result;
  let detail = "";
  let path: string | undefined;
  if (args) {
    for (const k of [
      "path",
      "filePath",
      "file_path",
      "target_file",
      "targetFile",
    ]) {
      if (typeof args[k] === "string" && String(args[k]).trim()) {
        path = String(args[k]).trim();
        break;
      }
    }
    // editToolCall.result.success.path is often the authoritative absolute path
    const resultPath = pathFromToolResult(result);
    if (!path && resultPath) path = resultPath;
    const todos = todosFromToolArgs(args);
    if (isTodoTool(name) || todos.length > 0) {
      detail = todos.length
        ? `${todos.length} todo${todos.length === 1 ? "" : "s"} · ${todoStatusSummary(todos)}`
        : "Updating todos";
    } else {
      detail =
        String(
          args.command ??
            args.pattern ??
            args.globPattern ??
            args.glob_pattern ??
            args.query ??
            path ??
            args.targetDirectory ??
            "",
        ) || JSON.stringify(args).slice(0, 120);
    }
  } else {
    const resultPath = pathFromToolResult(result);
    if (resultPath) path = resultPath;
  }
  const parentCallId =
    typeof toolCall.parentToolCallId === "string"
      ? toolCall.parentToolCallId
      : typeof toolCall.parent_tool_call_id === "string"
        ? (toolCall.parent_tool_call_id as string)
        : undefined;
  return { name, detail, path, args, result, parentCallId };
}

/** Unwrap CLI `{success:{…}}` / SDK `{status,value}` / bare object result shapes. */
export function unwrapToolResultPayload(result: unknown): Record<string, unknown> | null {
  if (!result || typeof result !== "object") return null;
  const r = result as Record<string, unknown>;
  if (r.success && typeof r.success === "object") {
    return r.success as Record<string, unknown>;
  }
  if (r.failure && typeof r.failure === "object") {
    return r.failure as Record<string, unknown>;
  }
  if (r.error && typeof r.error === "object") {
    return r.error as Record<string, unknown>;
  }
  if (
    (r.status === "success" || r.status === "error" || r.status === "failure") &&
    r.value &&
    typeof r.value === "object"
  ) {
    return r.value as Record<string, unknown>;
  }
  return r;
}

function pathFromToolResult(result: unknown): string | undefined {
  const payload = unwrapToolResultPayload(result);
  if (!payload) return undefined;
  for (const k of ["path", "filePath", "file_path", "target_file"]) {
    if (typeof payload[k] === "string" && String(payload[k]).trim()) {
      return String(payload[k]).trim();
    }
  }
  return undefined;
}

function truncateDetail(text: string, limit = TOOL_RESULT_DETAIL_LIMIT): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n…(truncated)`;
}

/**
 * Human-readable tool output for chat. Prefers completed `result` payloads
 * (stdout, file content, diff summary) over the start-time args summary.
 */
export function formatToolResultDetail(
  name: string,
  args: Record<string, unknown> | undefined,
  result: unknown,
  fallback = "",
): string {
  const payload = unwrapToolResultPayload(result);
  if (payload) {
    if (typeof payload.stdout === "string" || typeof payload.stderr === "string") {
      const stdout = typeof payload.stdout === "string" ? payload.stdout : "";
      const stderr = typeof payload.stderr === "string" ? payload.stderr : "";
      const exit =
        typeof payload.exitCode === "number"
          ? `exit ${payload.exitCode}`
          : typeof payload.exit_code === "number"
            ? `exit ${payload.exit_code}`
            : "";
      const parts = [stdout, stderr].filter((s) => s.trim().length > 0);
      const body = parts.join(parts.length === 2 ? "\n--- stderr ---\n" : "");
      if (body.trim()) {
        return truncateDetail(exit ? `${exit}\n${body}` : body);
      }
      if (exit) return exit;
    }

    if (typeof payload.content === "string" && payload.content.length > 0) {
      return truncateDetail(payload.content);
    }
    if (typeof payload.resultForModel === "string" && payload.resultForModel.trim()) {
      const linesAdded =
        typeof payload.linesAdded === "number" ? payload.linesAdded : undefined;
      const linesRemoved =
        typeof payload.linesRemoved === "number" ? payload.linesRemoved : undefined;
      const stats =
        linesAdded != null || linesRemoved != null
          ? ` (+${linesAdded ?? 0}/-${linesRemoved ?? 0})`
          : "";
      return truncateDetail(`${payload.resultForModel}${stats}`);
    }
    if (typeof payload.diffString === "string" && payload.diffString.trim()) {
      const path =
        (typeof payload.path === "string" && payload.path) ||
        (args && typeof args.path === "string" && args.path) ||
        "file";
      const linesAdded =
        typeof payload.linesAdded === "number" ? payload.linesAdded : undefined;
      const linesRemoved =
        typeof payload.linesRemoved === "number" ? payload.linesRemoved : undefined;
      if (linesAdded != null || linesRemoved != null) {
        return `${path} (+${linesAdded ?? 0}/-${linesRemoved ?? 0})`;
      }
      return path;
    }
    if (typeof payload.errorMessage === "string" && payload.errorMessage.trim()) {
      return truncateDetail(payload.errorMessage);
    }
    if (Array.isArray(payload.content)) {
      const text = payload.content
        .map((item) => {
          if (typeof item === "string") return item;
          if (!item || typeof item !== "object") return "";
          const o = item as Record<string, unknown>;
          if (typeof o.text === "string") return o.text;
          if (o.text && typeof o.text === "object") {
            const inner = (o.text as { text?: unknown }).text;
            if (typeof inner === "string") return inner;
          }
          if (typeof o.content === "string") return o.content;
          return "";
        })
        .filter(Boolean)
        .join("\n");
      if (text.trim()) return truncateDetail(text);
    }
    if (Array.isArray(payload.entries)) {
      return truncateDetail(
        payload.entries
          .map((e) => (typeof e === "string" ? e : JSON.stringify(e)))
          .join("\n"),
      );
    }
    if (Array.isArray(payload.files)) {
      return truncateDetail(
        payload.files
          .map((e) => (typeof e === "string" ? e : JSON.stringify(e)))
          .join("\n"),
      );
    }
    if (Array.isArray(payload.matches)) {
      try {
        return truncateDetail(JSON.stringify(payload.matches, null, 2));
      } catch {
        /* fall through */
      }
    }
    if (typeof payload.linesCreated === "number") {
      const path =
        (typeof payload.path === "string" && payload.path) ||
        (args && typeof args.path === "string" && args.path) ||
        "file";
      return `${path} · ${payload.linesCreated} lines`;
    }
  }

  if (typeof result === "string" && result.trim()) {
    return truncateDetail(result);
  }

  // Fall back to args summary (start-time detail) when result has no text.
  if (args) {
    const todos = todosFromToolArgs(args);
    if (isTodoTool(name) || todos.length > 0) {
      return todos.length
        ? `${todos.length} todo${todos.length === 1 ? "" : "s"} · ${todoStatusSummary(todos)}`
        : "Updating todos";
    }
  }
  return fallback || "Done";
}

/**
 * Pull a unified diff out of a completed tool `result` payload.
 * Cursor editToolCall puts the real patch in `result.success.diffString`.
 */
export function diffFromToolResult(result: unknown, pathHint?: string): string {
  const payload = unwrapToolResultPayload(result);
  if (!payload) return "";

  const ready =
    (typeof payload.diffString === "string" && payload.diffString) ||
    (typeof payload.diff === "string" && payload.diff) ||
    (typeof payload.unifiedDiff === "string" && payload.unifiedDiff) ||
    (typeof payload.unified_diff === "string" && payload.unified_diff) ||
    (typeof payload.patch === "string" && payload.patch) ||
    "";
  if (ready && /diff --git|@@ /.test(ready)) {
    return ready.trim();
  }
  // editToolCall often emits a short hunk without git headers — wrap it.
  if (typeof payload.diffString === "string" && payload.diffString.trim()) {
    const path =
      (typeof payload.path === "string" && payload.path) ||
      pathHint ||
      "file";
    const body = payload.diffString.trim();
    if (body.startsWith("diff --git") || body.includes("\n@@ ") || body.startsWith("@@ ")) {
      if (body.startsWith("diff --git")) return body;
      return [
        `diff --git a/${path} b/${path}`,
        `--- a/${path}`,
        `+++ b/${path}`,
        body.startsWith("@@") ? body : `@@ -1,1 +1,1 @@\n${body}`,
      ].join("\n");
    }
    // Line-oriented +/- dump without hunk header
    if (/^[+-]/m.test(body) || body.includes("\n+") || body.includes("\n-")) {
      const lines = body.split("\n");
      return [
        `diff --git a/${path} b/${path}`,
        `--- a/${path}`,
        `+++ b/${path}`,
        `@@ -1,${lines.filter((l) => l.startsWith("-")).length || 0} +1,${lines.filter((l) => l.startsWith("+")).length || 0} @@`,
        body,
      ].join("\n");
    }
  }

  const after =
    (typeof payload.afterFullFileContent === "string" &&
      payload.afterFullFileContent) ||
    (typeof payload.afterContent === "string" && payload.afterContent) ||
    undefined;
  if (typeof after === "string") {
    const path =
      (typeof payload.path === "string" && payload.path) || pathHint || "file";
    return buildUnifiedDiff(path, "", after);
  }

  return "";
}

function buildUnifiedDiff(
  filePath: string,
  before: string,
  after: string,
): string {
  const path = filePath.replace(/\\/g, "/").replace(/^\.\//, "") || "file";
  if (before === after) return "";
  const oldLines = before.length
    ? before.replace(/\n$/, "").split("\n")
    : [];
  const newLines = after.length ? after.replace(/\n$/, "").split("\n") : [];
  const deleted = after.length === 0 && before.length > 0;
  const created = before.length === 0 && after.length > 0;
  const hunk: string[] = [
    `@@ -${created ? 0 : 1},${oldLines.length} +${deleted ? 0 : 1},${newLines.length} @@`,
  ];
  for (const line of oldLines) hunk.push(`-${line}`);
  for (const line of newLines) hunk.push(`+${line}`);
  return [
    `diff --git a/${path} b/${path}`,
    deleted ? `deleted file mode 100644` : "",
    created ? `new file mode 100644` : "",
    created ? `--- /dev/null` : `--- a/${path}`,
    deleted ? `+++ /dev/null` : `+++ b/${path}`,
    ...hunk,
  ]
    .filter((l) => l !== "")
    .join("\n");
}

export function diffFromToolArgs(
  toolName: string,
  args?: Record<string, unknown>,
): string {
  if (!args) return "";
  const path =
    (typeof args.path === "string" && args.path) ||
    (typeof args.file_path === "string" && args.file_path) ||
    (typeof args.target_file === "string" && args.target_file) ||
    (typeof args.filePath === "string" && args.filePath) ||
    "file";
  const name = toolName.replace(/ToolCall$/i, "").toLowerCase();

  // Flat StrReplace / Edit args (Claude + older Cursor)
  const oldStr =
    (typeof args.old_string === "string" && args.old_string) ||
    (typeof args.oldString === "string" && args.oldString) ||
    (typeof args.old_str === "string" && args.old_str) ||
    (typeof args.OldString === "string" && args.OldString) ||
    undefined;
  const newStr =
    (typeof args.new_string === "string" && args.new_string) ||
    (typeof args.newString === "string" && args.newString) ||
    (typeof args.new_str === "string" && args.new_str) ||
    (typeof args.NewString === "string" && args.NewString) ||
    undefined;
  if (typeof oldStr === "string" && typeof newStr === "string") {
    return buildUnifiedDiff(path, oldStr, newStr);
  }

  // Cursor editToolCall nested strategies
  const strReplace =
    args.strReplace && typeof args.strReplace === "object"
      ? (args.strReplace as Record<string, unknown>)
      : null;
  if (strReplace) {
    const oldText =
      (typeof strReplace.oldText === "string" && strReplace.oldText) ||
      (typeof strReplace.old_string === "string" && strReplace.old_string) ||
      undefined;
    const newText =
      (typeof strReplace.newText === "string" && strReplace.newText) ||
      (typeof strReplace.new_string === "string" && strReplace.new_string) ||
      undefined;
    if (typeof oldText === "string" && typeof newText === "string") {
      return buildUnifiedDiff(path, oldText, newText);
    }
  }

  const multi =
    args.multiStrReplace && typeof args.multiStrReplace === "object"
      ? (args.multiStrReplace as Record<string, unknown>)
      : null;
  if (multi && Array.isArray(multi.edits)) {
    const parts: string[] = [];
    for (const edit of multi.edits) {
      if (!edit || typeof edit !== "object") continue;
      const e = edit as Record<string, unknown>;
      const o =
        (typeof e.oldText === "string" && e.oldText) ||
        (typeof e.old_string === "string" && e.old_string) ||
        undefined;
      const n =
        (typeof e.newText === "string" && e.newText) ||
        (typeof e.new_string === "string" && e.new_string) ||
        undefined;
      if (typeof o === "string" && typeof n === "string") {
        const hunk = buildUnifiedDiff(path, o, n);
        if (hunk) parts.push(hunk);
      }
    }
    if (parts.length) return parts.join("\n");
  }

  const applyPatch =
    args.applyPatch && typeof args.applyPatch === "object"
      ? (args.applyPatch as Record<string, unknown>)
      : null;
  if (applyPatch) {
    const patchContent =
      (typeof applyPatch.patchContent === "string" && applyPatch.patchContent) ||
      (typeof applyPatch.patch === "string" && applyPatch.patch) ||
      "";
    if (patchContent && /diff --git|@@ /.test(patchContent)) {
      return patchContent.trim();
    }
    if (patchContent.trim()) {
      return [
        `diff --git a/${path} b/${path}`,
        `--- a/${path}`,
        `+++ b/${path}`,
        patchContent.trim().startsWith("@@")
          ? patchContent.trim()
          : `@@\n${patchContent.trim()}`,
      ].join("\n");
    }
  }

  // writeToolCall uses fileText (CLI) or contents/content
  const contents =
    (typeof args.fileText === "string" && args.fileText) ||
    (typeof args.file_text === "string" && args.file_text) ||
    (typeof args.contents === "string" && args.contents) ||
    (typeof args.content === "string" && args.content) ||
    (typeof args.new_contents === "string" && args.new_contents) ||
    (typeof args.newContents === "string" && args.newContents) ||
    (typeof args.text === "string" && args.text) ||
    undefined;
  if (
    typeof contents === "string" &&
    /^(write|create|updatefile|writefile|editnotebook)/i.test(name)
  ) {
    return buildUnifiedDiff(path, "", contents);
  }
  // Bare edit with only full contents (some agents)
  if (
    typeof contents === "string" &&
    name === "edit" &&
    !strReplace &&
    !multi &&
    !applyPatch
  ) {
    return buildUnifiedDiff(path, "", contents);
  }

  if (typeof args.patch === "string" && /diff --git|@@ /.test(args.patch)) {
    return args.patch.trim();
  }
  if (
    typeof args.unifiedDiff === "string" &&
    /diff --git|@@ /.test(args.unifiedDiff)
  ) {
    return args.unifiedDiff.trim();
  }
  if (
    typeof args.unified_diff === "string" &&
    /diff --git|@@ /.test(args.unified_diff)
  ) {
    return args.unified_diff.trim();
  }
  if (/^delete/i.test(name)) {
    return buildUnifiedDiff(path, `/* deleted: ${path} */\n`, "");
  }
  return "";
}

/** Prefer result.diffString, then synthesize from args. */
export function diffFromToolEvent(
  toolName: string,
  args?: Record<string, unknown>,
  result?: unknown,
): string {
  const fromResult = diffFromToolResult(
    result,
    args && typeof args.path === "string" ? args.path : undefined,
  );
  if (fromResult) return fromResult;
  return diffFromToolArgs(toolName, args);
}

const EDIT_TOOL_RE =
  /^(write|edit|strreplace|searchreplace|delete|applypatch|editnotebook|create|updatefile|deletefile|writefile)/i;

const TODO_TOOL_RE =
  /^(todo|todowrite|todoread|updatetodos|write_todos|todo_write|todo_read)$/i;

export function isEditTool(name: string): boolean {
  return EDIT_TOOL_RE.test(name.replace(/ToolCall$/i, ""));
}

export function isTodoTool(name: string): boolean {
  const n = name.replace(/ToolCall$/i, "");
  return TODO_TOOL_RE.test(n) || /todo/i.test(n);
}

function normalizeTodoStatus(
  raw: unknown,
): AgentTodoItem["status"] {
  let s = String(raw ?? "pending").toLowerCase().replace(/[\s-]/g, "_");
  // Cursor CLI enums: TODO_STATUS_COMPLETED, TODO_STATUS_IN_PROGRESS, …
  if (s.startsWith("todo_status_")) s = s.slice("todo_status_".length);
  if (s === "completed" || s === "complete" || s === "done") return "completed";
  if (s === "in_progress" || s === "inprogress" || s === "active")
    return "in_progress";
  if (s === "cancelled" || s === "canceled") return "cancelled";
  if (s === "pending" || s === "todo" || s === "not_started") return "pending";
  return "pending";
}

function coerceArgsObject(args: unknown): Record<string, unknown> | undefined {
  if (!args) return undefined;
  if (typeof args === "string") {
    try {
      const parsed = JSON.parse(args) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
      if (Array.isArray(parsed)) return { todos: parsed };
    } catch {
      return undefined;
    }
    return undefined;
  }
  if (typeof args === "object" && !Array.isArray(args)) {
    return args as Record<string, unknown>;
  }
  if (Array.isArray(args)) return { todos: args };
  return undefined;
}

export function todosFromToolArgs(
  args?: unknown,
): AgentTodoItem[] {
  const o = coerceArgsObject(args);
  if (!o) return [];
  const raw =
    (Array.isArray(o.todos) && o.todos) ||
    (Array.isArray(o.items) && o.items) ||
    (Array.isArray(o.todo_list) && o.todo_list) ||
    null;
  if (!raw) return [];
  const out: AgentTodoItem[] = [];
  for (let i = 0; i < raw.length; i++) {
    const item = raw[i];
    if (!item || typeof item !== "object") continue;
    const t = item as Record<string, unknown>;
    const content = String(
      t.content ?? t.text ?? t.title ?? t.description ?? "",
    ).trim();
    if (!content) continue;
    out.push({
      id: String(t.id ?? `todo-${i + 1}`),
      content,
      status: normalizeTodoStatus(t.status),
    });
  }
  return out;
}

/**
 * Recover structured todos from a chat message — prefers `message.todos`,
 * then parses JSON tool args that older servers stored as `content`.
 */
export function resolveMessageTodos(message: {
  todos?: AgentTodoItem[];
  content?: string;
  toolName?: string;
}): AgentTodoItem[] {
  if (message.todos && message.todos.length > 0) return message.todos;
  const content = message.content?.trim() ?? "";
  if (!content) return [];
  if (
    content.startsWith("{") ||
    content.startsWith("[") ||
    content.includes('"todos"')
  ) {
    const parsed = todosFromToolArgs(content);
    if (parsed.length) return parsed;
    // Truncated JSON from older servers (JSON.stringify(args).slice(0, N)).
    return todosFromTruncatedContent(content);
  }
  return [];
}

/** Whether a chat tool message should render as the Todos card. */
export function messageHasTodos(message: {
  role?: string;
  todos?: AgentTodoItem[];
  content?: string;
  toolName?: string;
}): boolean {
  if (message.todos && message.todos.length > 0) return true;
  if (message.toolName && isTodoTool(message.toolName)) return true;
  const content = message.content?.trim() ?? "";
  if (!content) return false;
  return (
    (content.startsWith("{") || content.startsWith("[")) &&
    /"todos"\s*:/.test(content)
  );
}

/**
 * Keep only the latest todos card per agent so successive TodoWrite updates
 * (2 → 3 → 4 items) don't stack as separate groups in the timeline.
 */
export function coalesceTodoMessages<
  T extends {
    id: string;
    role: string;
    agentId?: string;
    todos?: AgentTodoItem[];
    content?: string;
    toolName?: string;
  },
>(messages: T[]): T[] {
  const latestIdByAgent = new Map<string, string>();
  for (const msg of messages) {
    if (msg.role !== "tool" || !messageHasTodos(msg)) continue;
    latestIdByAgent.set(msg.agentId || "__default__", msg.id);
  }
  if (latestIdByAgent.size === 0) return messages;
  return messages.filter((msg) => {
    if (msg.role !== "tool" || !messageHasTodos(msg)) return true;
    return latestIdByAgent.get(msg.agentId || "__default__") === msg.id;
  });
}

/** Best-effort extraction when content is a sliced JSON blob. */
function todosFromTruncatedContent(content: string): AgentTodoItem[] {
  if (!/"content"\s*:/.test(content)) return [];
  const out: AgentTodoItem[] = [];
  const re =
    /\{\s*"id"\s*:\s*"((?:\\.|[^"\\])*)"\s*,\s*"content"\s*:\s*"((?:\\.|[^"\\])*)"\s*,\s*"status"\s*:\s*"((?:\\.|[^"\\])*)"/g;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(content)) !== null) {
    i += 1;
    const todoContent = m[2].replace(/\\"/g, '"').replace(/\\\\/g, "\\").trim();
    if (!todoContent) continue;
    out.push({
      id: m[1] || `todo-${i}`,
      content: todoContent,
      status: normalizeTodoStatus(m[3]),
    });
  }
  if (out.length) return out;
  // Looser: pull content fields even if id/status order differs or was cut off.
  const contentRe = /"content"\s*:\s*"((?:\\.|[^"\\])*)"/g;
  while ((m = contentRe.exec(content)) !== null) {
    i += 1;
    const todoContent = m[1].replace(/\\"/g, '"').replace(/\\\\/g, "\\").trim();
    if (!todoContent) continue;
    out.push({
      id: `todo-${i}`,
      content: todoContent,
      status: "pending",
    });
  }
  return out;
}

export function todoStatusSummary(todos: AgentTodoItem[]): string {
  const completed = todos.filter((t) => t.status === "completed").length;
  const active = todos.filter((t) => t.status === "in_progress").length;
  const pending = todos.filter((t) => t.status === "pending").length;
  const parts: string[] = [];
  if (active) parts.push(`${active} in progress`);
  if (completed) parts.push(`${completed} done`);
  if (pending) parts.push(`${pending} pending`);
  return parts.join(" · ") || "updated";
}

/**
 * Cursor CLI headless agent backend.
 * Spawns: `cursor agent --print --output-format stream-json ...`
 */
export class CursorAgentBackend implements WorkerBackend {
  readonly kind = "cursor" as const;
  readonly available = true;
  readonly command = "cursor";

  buildArgs(opts: BuildArgsOptions): string[] {
    const args = [
      "agent",
      "--print",
      "--output-format",
      "stream-json",
      "--stream-partial-output",
      "--force",
      "--trust",
    ];
    if (opts.mode === "plan") {
      args.push("--mode", "plan");
    }
    if (opts.modelId && opts.modelId !== "auto") {
      args.push("--model", opts.modelId);
    }
    if (opts.sessionId) {
      args.push("--resume", opts.sessionId);
    }
    args.push(opts.prompt);
    return args;
  }

  parseLine(
    json: unknown,
    ctx: ParseLineContext = {
      assistantBuf: { value: "" },
      gotTerminalEvent: { value: false },
    },
  ): NormalizedAgentEvent[] {
    if (!json || typeof json !== "object") return [];
    const ev = json as Record<string, unknown>;
    const type = ev.type as string;
    const out: NormalizedAgentEvent[] = [];

    if (type === "system" && ev.subtype === "init" && ev.session_id) {
      out.push({ kind: "session", sessionId: String(ev.session_id) });
      return out;
    }

    if (type === "assistant") {
      const text = extractText(ev.message);
      if (!text) return out;
      if ("timestamp_ms" in ev) {
        ctx.assistantBuf.value += text;
        out.push({
          kind: "assistant_delta",
          text: ctx.assistantBuf.value,
        });
      } else {
        ctx.assistantBuf.value = text;
        out.push({ kind: "assistant_final", text });
      }
      return out;
    }

    if (type === "tool_call") {
      const callId = String(ev.call_id ?? "");
      const info = toolInfo(ev.tool_call as Record<string, unknown>);
      if (info.parentCallId) {
        out.push({
          kind: "subagent_nested",
          parentCallId: info.parentCallId,
          callId,
          name: info.name,
          detail: info.detail,
          path: info.path,
          status: ev.subtype === "completed" ? "completed" : "started",
        });
        return out;
      }
      const todos = info.args ? todosFromToolArgs(info.args) : [];
      const todoTool = isTodoTool(info.name) || todos.length > 0;
      const toolName =
        todoTool && !isTodoTool(info.name) ? "todo" : info.name;
      if (ev.subtype === "started") {
        out.push({
          kind: "tool_start",
          callId,
          name: toolName,
          detail: info.detail,
          path: info.path,
          todos: todos.length ? todos : undefined,
        });
      } else if (ev.subtype === "completed") {
        const path = info.path || pathFromToolResult(info.result);
        const detail = formatToolResultDetail(
          info.name,
          info.args,
          info.result,
          info.detail || path || "Done",
        );
        const fromResult = !todoTool
          ? diffFromToolResult(info.result, path)
          : "";
        const diffPatch =
          fromResult ||
          (!todoTool && isEditTool(info.name)
            ? diffFromToolArgs(info.name, info.args)
            : "") ||
          undefined;
        out.push({
          kind: "tool_done",
          callId,
          name: toolName,
          detail,
          path,
          diffPatch: diffPatch || undefined,
          todos: todos.length ? todos : undefined,
        });
      }
      return out;
    }

    if (type === "result") {
      ctx.gotTerminalEvent.value = true;
      if (ev.session_id) {
        out.push({ kind: "session", sessionId: String(ev.session_id) });
      }
      if (ev.is_error) {
        const msg = String(
          ev.result != null && ev.result !== ""
            ? ev.result
            : ctx.stderr || "Agent error",
        );
        out.push({ kind: "error", message: msg });
      } else {
        out.push({
          kind: "done",
          result: String(ev.result ?? ctx.assistantBuf.value),
        });
      }
    }

    return out;
  }
}

export const cursorAgentBackend = new CursorAgentBackend();
