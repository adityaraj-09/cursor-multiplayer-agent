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
  const key = Object.keys(toolCall).find(
    (k) =>
      k.endsWith("ToolCall") ||
      (![
        "hookAdditionalContexts",
        "toolCallId",
        "startedAtMs",
        "completedAtMs",
        "parentToolCallId",
      ].includes(k) &&
        typeof toolCall[k] === "object"),
  );
  const name = key ? key.replace(/ToolCall$/, "") : "tool";
  const body = key ? (toolCall[key] as Record<string, unknown>) : undefined;
  const args =
    body?.args && typeof body.args === "object"
      ? (body.args as Record<string, unknown>)
      : undefined;
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
    detail =
      String(
        args.command ?? args.globPattern ?? path ?? args.targetDirectory ?? "",
      ) || JSON.stringify(args).slice(0, 120);
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

export function isEditTool(name: string): boolean {
  return EDIT_TOOL_RE.test(name.replace(/ToolCall$/i, ""));
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
      if (ev.subtype === "started") {
        out.push({
          kind: "tool_start",
          callId,
          name: info.name,
          detail: info.detail,
          path: info.path,
        });
      } else if (ev.subtype === "completed") {
        const diffPatch =
          isEditTool(info.name) && info.args
            ? diffFromToolArgs(info.name, info.args)
            : undefined;
        out.push({
          kind: "tool_done",
          callId,
          name: info.name,
          detail: info.detail,
          path: info.path,
          diffPatch: diffPatch || undefined,
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
