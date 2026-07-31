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

function toolInfo(toolCall: Record<string, unknown> | undefined): {
  name: string;
  detail: string;
  path?: string;
  args?: Record<string, unknown>;
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
    const todos = todosFromToolArgs(args);
    if (isTodoTool(name) || todos.length > 0) {
      detail = todos.length
        ? `${todos.length} todo${todos.length === 1 ? "" : "s"} · ${todoStatusSummary(todos)}`
        : "Updating todos";
    } else {
      detail =
        String(
          args.command ?? args.globPattern ?? path ?? args.targetDirectory ?? "",
        ) || JSON.stringify(args).slice(0, 120);
    }
  }
  const parentCallId =
    typeof toolCall.parentToolCallId === "string"
      ? toolCall.parentToolCallId
      : typeof toolCall.parent_tool_call_id === "string"
        ? (toolCall.parent_tool_call_id as string)
        : undefined;
  return { name, detail, path, args, parentCallId };
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
    "file";
  const name = toolName.replace(/ToolCall$/i, "").toLowerCase();
  const oldStr =
    (typeof args.old_string === "string" && args.old_string) ||
    (typeof args.oldString === "string" && args.oldString) ||
    undefined;
  const newStr =
    (typeof args.new_string === "string" && args.new_string) ||
    (typeof args.newString === "string" && args.newString) ||
    undefined;
  if (typeof oldStr === "string" && typeof newStr === "string") {
    return buildUnifiedDiff(path, oldStr, newStr);
  }
  const contents =
    (typeof args.contents === "string" && args.contents) ||
    (typeof args.content === "string" && args.content) ||
    undefined;
  if (
    typeof contents === "string" &&
    /^(write|create|updatefile|writefile)/i.test(name)
  ) {
    return buildUnifiedDiff(path, "", contents);
  }
  if (typeof args.patch === "string" && /diff --git|@@ /.test(args.patch)) {
    return args.patch.trim();
  }
  return "";
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
      if (ev.subtype === "started") {
        out.push({
          kind: "tool_start",
          callId,
          name: todoTool && !isTodoTool(info.name) ? "todo" : info.name,
          detail: info.detail,
          path: info.path,
          todos: todos.length ? todos : undefined,
        });
      } else if (ev.subtype === "completed") {
        const diffPatch =
          isEditTool(info.name) && info.args
            ? diffFromToolArgs(info.name, info.args)
            : undefined;
        out.push({
          kind: "tool_done",
          callId,
          name: todoTool && !isTodoTool(info.name) ? "todo" : info.name,
          detail: info.detail,
          path: info.path,
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
