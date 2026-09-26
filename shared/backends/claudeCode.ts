import type {
  BuildArgsOptions,
  NormalizedAgentEvent,
  ParseLineContext,
  WorkerBackend,
} from "./types.js";
import {
  diffFromToolArgs,
  formatToolResultDetail,
  isEditTool,
  isQuestionTool,
  isTodoTool,
  parseQuestionToolArgs,
  todoStatusSummary,
  todosFromToolArgs,
  TOOL_RESULT_DETAIL_LIMIT,
  stringifyUnknown,
} from "./cursor.js";

interface PendingTool {
  name: string;
  path?: string;
  args?: Record<string, unknown>;
}

/** In-flight tool_use block while input_json_delta chunks arrive. */
interface StreamingToolBlock {
  callId: string;
  name: string;
  inputJson: string;
  parentCallId: string | null;
}

function extractText(message: unknown): string {
  if (!message || typeof message !== "object") return "";
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (
        part &&
        typeof part === "object" &&
        (part as { type?: string }).type === "text" &&
        "text" in part
      ) {
        return String((part as { text: unknown }).text ?? "");
      }
      return "";
    })
    .join("");
}

function parentCallIdOf(ev: Record<string, unknown>): string | null {
  return typeof ev.parent_tool_use_id === "string" && ev.parent_tool_use_id
    ? ev.parent_tool_use_id
    : null;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function blockIndex(event: Record<string, unknown>): number {
  return typeof event.index === "number" && Number.isFinite(event.index)
    ? event.index
    : Number(event.index ?? 0) || 0;
}

function tryParseToolArgs(raw: string): Record<string, unknown> | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  try {
    return asRecord(JSON.parse(trimmed));
  } catch {
    return undefined;
  }
}

/** `message.content` on assistant/user rows, or top-level `content` fallback. */
function messageContent(ev: Record<string, unknown>): unknown {
  const message = asRecord(ev.message);
  if (message && message.content !== undefined) return message.content;
  return ev.content;
}

function toolPathFromArgs(args: Record<string, unknown> | undefined): string | undefined {
  if (!args) return undefined;
  for (const k of [
    "file_path",
    "filePath",
    "path",
    "target_file",
    "targetFile",
  ]) {
    if (typeof args[k] === "string" && String(args[k]).trim()) {
      return String(args[k]).trim();
    }
  }
  return undefined;
}

/** Normalize Claude tool_result `content` (string or content-block array). */
function extractToolResultContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) {
    if (content && typeof content === "object") {
      try {
        return JSON.stringify(content);
      } catch {
        return "";
      }
    }
    return "";
  }
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (!part || typeof part !== "object") return "";
      const p = part as Record<string, unknown>;
      if (typeof p.text === "string") return p.text;
      if (typeof p.content === "string") return p.content;
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function toolDetail(
  name: string,
  args: Record<string, unknown> | undefined,
  path?: string,
): string {
  if (!args) return name;
  const todos = todosFromToolArgs(args);
  if (isTodoTool(name) || todos.length > 0) {
    return todos.length
      ? `${todos.length} todo${todos.length === 1 ? "" : "s"} · ${todoStatusSummary(todos)}`
      : "Updating todos";
  }
  const command =
    typeof args.command === "string"
      ? args.command
      : typeof args.pattern === "string"
        ? args.pattern
        : typeof args.glob === "string"
          ? args.glob
          : typeof args.glob_pattern === "string"
            ? args.glob_pattern
            : undefined;
  if (command) return String(command).slice(0, 160);
  if (path) return path;
  try {
    return JSON.stringify(args).slice(0, 120);
  } catch {
    return name;
  }
}

/**
 * Claude Code CLI headless backend.
 * Spawns: `claude -p --output-format stream-json --verbose ...`
 *
 * Stateful: create a fresh instance per run so pending tool_use ids
 * do not leak across concurrent agents.
 */
export class ClaudeCodeBackend implements WorkerBackend {
  readonly kind = "claude-code" as const;
  readonly available = true;
  readonly command = "claude";

  /** tool_use id → metadata, filled on assistant/stream tool_use, consumed on tool_result */
  private pendingTools = new Map<string, PendingTool>();
  /** content_block index → accumulating tool_use input JSON */
  private streamingBlocks = new Map<number, StreamingToolBlock>();

  buildArgs(opts: BuildArgsOptions): string[] {
    const args = [
      "-p",
      "--output-format",
      "stream-json",
      "--verbose",
      "--include-partial-messages",
    ];
    if (opts.mode === "plan") {
      // Plan mode: explore + propose, no edits until the room exits plan.
      args.push("--permission-mode", "plan");
    } else {
      args.push("--dangerously-skip-permissions");
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

    // Token-level streaming (requires --include-partial-messages).
    // Tool calls start as content_block_start { type: tool_use, input: {} }
    // with args arriving later as input_json_delta — must not return after
    // text_delta only or the room UI never gets tool_start cards.
    if (type === "stream_event") {
      const event = asRecord(ev.event);
      if (!event) return out;
      this.parseContentBlockEvent(event, parentCallIdOf(ev), ctx, out);
      return out;
    }

    if (
      type === "content_block_start" ||
      type === "content_block_delta" ||
      type === "content_block_stop"
    ) {
      this.parseContentBlockEvent(ev, parentCallIdOf(ev), ctx, out);
      return out;
    }

    if (type === "assistant") {
      const message = ev.message;
      const text = extractText(message);
      if (text) {
        // Prefer stream_event deltas when available; still emit final text
        // when no partials were seen (or as a catch-up).
        if (!ctx.assistantBuf.value) {
          ctx.assistantBuf.value = text;
          out.push({ kind: "assistant_delta", text });
        } else if (text.length >= ctx.assistantBuf.value.length) {
          ctx.assistantBuf.value = text;
          out.push({ kind: "assistant_final", text });
        }
      }

      const content = messageContent(ev);
      if (Array.isArray(content)) {
        for (const block of content) {
          const b = asRecord(block);
          if (!b || b.type !== "tool_use") continue;
          this.startTool(
            String(b.id ?? ""),
            String(b.name ?? "tool"),
            asRecord(b.input),
            parentCallIdOf(ev),
            out,
          );
        }
      }
      return out;
    }

    if (type === "user") {
      const content = messageContent(ev);
      if (!Array.isArray(content)) return out;

      const parentCallId = parentCallIdOf(ev);

      for (const block of content) {
        if (!block || typeof block !== "object") continue;
        const b = block as Record<string, unknown>;
        if (b.type !== "tool_result") continue;
        const callId = String(b.tool_use_id ?? "");
        if (!callId) continue;
        const pending = this.pendingTools.get(callId);
        this.pendingTools.delete(callId);
        const name = pending?.name || "tool";
        const path = pending?.path;
        const resultText = extractToolResultContent(b.content);
        const startDetail = toolDetail(name, pending?.args, path);
        const detail = formatToolResultDetail(
          name,
          pending?.args,
          resultText ? { success: { content: resultText } } : undefined,
          resultText || startDetail || path || "Done",
        );

        if (parentCallId) {
          out.push({
            kind: "subagent_nested",
            parentCallId,
            callId,
            name,
            detail:
              detail.length > 200 ? `${detail.slice(0, 200)}…` : detail,
            path,
            status: "completed",
          });
        } else {
          const diffPatch =
            isEditTool(name) && pending?.args
              ? diffFromToolArgs(name, pending.args)
              : undefined;
          const todos = pending?.args ? todosFromToolArgs(pending.args) : [];
          const questions = pending?.args ? parseQuestionToolArgs(pending.args) : [];
          out.push({
            kind: "tool_done",
            callId,
            name:
              todos.length && !isTodoTool(name)
                ? "todo"
                : isQuestionTool(name)
                  ? "AskUserQuestion"
                  : name,
            detail:
              todos.length
                ? `${todos.length} todo${todos.length === 1 ? "" : "s"} · ${todoStatusSummary(todos)}`
                : detail.slice(0, TOOL_RESULT_DETAIL_LIMIT),
            path,
            diffPatch: diffPatch || undefined,
            todos: todos.length ? todos : undefined,
            questions: questions.length ? questions : undefined,
          });
        }
      }
      return out;
    }

    if (type === "error") {
      ctx.gotTerminalEvent.value = true;
      out.push({
        kind: "error",
        message:
          stringifyUnknown(ev.error) ||
          stringifyUnknown(ev.message) ||
          stringifyUnknown(ev.result) ||
          ctx.stderr ||
          "Claude Code error",
      });
      return out;
    }

    if (type === "result") {
      ctx.gotTerminalEvent.value = true;
      if (ev.session_id) {
        out.push({ kind: "session", sessionId: String(ev.session_id) });
      }
      const subtype = String(ev.subtype ?? "");
      const isError =
        Boolean(ev.is_error) ||
        subtype.startsWith("error") ||
        subtype === "error_during_execution" ||
        subtype === "error_max_turns";
      if (isError) {
        const msg =
          stringifyUnknown(ev.result) ||
          stringifyUnknown(ev.errors) ||
          stringifyUnknown(ev.error) ||
          ctx.stderr ||
          `Claude Code error (${subtype || "unknown"})`;
        out.push({ kind: "error", message: msg });
      } else {
        out.push({
          kind: "done",
          result:
            stringifyUnknown(ev.result) ||
            ctx.assistantBuf.value ||
            "",
        });
      }
    }

    return out;
  }

  private parseContentBlockEvent(
    event: Record<string, unknown>,
    parentCallId: string | null,
    ctx: ParseLineContext,
    out: NormalizedAgentEvent[],
  ): void {
    const eventType = String(event.type ?? "");
    const index = blockIndex(event);

    if (eventType === "content_block_start") {
      const block = asRecord(event.content_block);
      if (!block || block.type !== "tool_use") return;
      const callId = String(block.id ?? "");
      if (!callId) return;
      const name = String(block.name ?? "tool");
      const args = asRecord(block.input);
      this.streamingBlocks.set(index, {
        callId,
        name,
        inputJson:
          args && Object.keys(args).length > 0 ? JSON.stringify(args) : "",
        parentCallId,
      });
      this.startTool(callId, name, args, parentCallId, out);
      return;
    }

    if (eventType === "content_block_delta") {
      const delta = asRecord(event.delta);
      if (!delta) return;
      if (delta.type === "text_delta" && typeof delta.text === "string") {
        ctx.assistantBuf.value += delta.text;
        out.push({
          kind: "assistant_delta",
          text: ctx.assistantBuf.value,
        });
        return;
      }
      if (
        delta.type === "input_json_delta" &&
        typeof delta.partial_json === "string"
      ) {
        const streaming = this.streamingBlocks.get(index);
        if (!streaming) return;
        streaming.inputJson += delta.partial_json;
        const args = tryParseToolArgs(streaming.inputJson);
        if (args) {
          this.startTool(
            streaming.callId,
            streaming.name,
            args,
            streaming.parentCallId,
            out,
          );
        }
      }
      return;
    }

    if (eventType === "content_block_stop") {
      const streaming = this.streamingBlocks.get(index);
      if (!streaming) return;
      this.streamingBlocks.delete(index);
      const args = tryParseToolArgs(streaming.inputJson);
      if (args) {
        this.startTool(
          streaming.callId,
          streaming.name,
          args,
          streaming.parentCallId,
          out,
        );
      }
    }
  }

  /**
   * Record a tool_use and emit tool_start once. Re-emits when args go from
   * empty `{}` (content_block_start placeholder) to a real path/command so
   * the existing chat row can pick up a useful title.
   */
  private startTool(
    callId: string,
    name: string,
    args: Record<string, unknown> | undefined,
    parentCallId: string | null,
    out: NormalizedAgentEvent[],
  ): void {
    if (!callId) return;
    const path = toolPathFromArgs(args);
    const existing = this.pendingTools.get(callId);
    const hasArgs = Boolean(args && Object.keys(args).length > 0);
    const hadArgs = Boolean(
      existing?.args && Object.keys(existing.args).length > 0,
    );
    const mergedArgs = hasArgs ? args : existing?.args;
    const mergedPath = path || existing?.path;
    const mergedName = existing?.name || name;
    this.pendingTools.set(callId, {
      name: mergedName,
      path: mergedPath,
      args: mergedArgs,
    });

    const alreadyStarted = Boolean(existing);
    const detailImproved = alreadyStarted && hasArgs && !hadArgs;
    if (alreadyStarted && !detailImproved) return;

    const todos = mergedArgs ? todosFromToolArgs(mergedArgs) : [];
    const questions = mergedArgs ? parseQuestionToolArgs(mergedArgs) : [];
    if (parentCallId) {
      out.push({
        kind: "subagent_nested",
        parentCallId,
        callId,
        name: mergedName,
        detail: toolDetail(mergedName, mergedArgs, mergedPath),
        path: mergedPath,
        status: "started",
      });
      return;
    }
    out.push({
      kind: "tool_start",
      callId,
      name:
        todos.length && !isTodoTool(mergedName)
          ? "todo"
          : isQuestionTool(mergedName)
            ? "AskUserQuestion"
            : mergedName,
      detail: toolDetail(mergedName, mergedArgs, mergedPath),
      path: mergedPath,
      todos: todos.length ? todos : undefined,
      questions: questions.length ? questions : undefined,
    });
  }
}

export const claudeCodeBackend = new ClaudeCodeBackend();
