import type {
  BuildArgsOptions,
  NormalizedAgentEvent,
  ParseLineContext,
  WorkerBackend,
} from "./types.js";
import { diffFromToolArgs, isEditTool } from "./cursor.js";

interface PendingTool {
  name: string;
  path?: string;
  args?: Record<string, unknown>;
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

function toolDetail(
  name: string,
  args: Record<string, unknown> | undefined,
  path?: string,
): string {
  if (!args) return name;
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

  /** tool_use id → metadata, filled on assistant tool_use, consumed on tool_result */
  private pendingTools = new Map<string, PendingTool>();

  buildArgs(opts: BuildArgsOptions): string[] {
    const args = [
      "-p",
      "--output-format",
      "stream-json",
      "--verbose",
      "--include-partial-messages",
      "--dangerously-skip-permissions",
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

    // Token-level streaming (requires --include-partial-messages)
    if (type === "stream_event") {
      const event = ev.event as Record<string, unknown> | undefined;
      if (!event || typeof event !== "object") return out;
      if (event.type === "content_block_delta") {
        const delta = event.delta as Record<string, unknown> | undefined;
        if (delta?.type === "text_delta" && typeof delta.text === "string") {
          ctx.assistantBuf.value += delta.text;
          out.push({
            kind: "assistant_delta",
            text: ctx.assistantBuf.value,
          });
        }
      }
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

      const content =
        message && typeof message === "object"
          ? (message as { content?: unknown }).content
          : undefined;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (!block || typeof block !== "object") continue;
          const b = block as Record<string, unknown>;
          if (b.type !== "tool_use") continue;
          const callId = String(b.id ?? "");
          if (!callId) continue;
          const name = String(b.name ?? "tool");
          const args =
            b.input && typeof b.input === "object"
              ? (b.input as Record<string, unknown>)
              : undefined;
          const path = toolPathFromArgs(args);
          const parentCallId =
            typeof ev.parent_tool_use_id === "string"
              ? ev.parent_tool_use_id
              : null;

          this.pendingTools.set(callId, { name, path, args });

          if (parentCallId) {
            out.push({
              kind: "subagent_nested",
              parentCallId,
              callId,
              name,
              detail: toolDetail(name, args, path),
              path,
              status: "started",
            });
          } else {
            out.push({
              kind: "tool_start",
              callId,
              name,
              detail: toolDetail(name, args, path),
              path,
            });
          }
        }
      }
      return out;
    }

    if (type === "user") {
      const message = ev.message;
      const content =
        message && typeof message === "object"
          ? (message as { content?: unknown }).content
          : undefined;
      if (!Array.isArray(content)) return out;

      const parentCallId =
        typeof ev.parent_tool_use_id === "string"
          ? ev.parent_tool_use_id
          : null;

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
        const detail =
          typeof b.content === "string"
            ? b.content.slice(0, 160)
            : toolDetail(name, pending?.args, path);

        if (parentCallId) {
          out.push({
            kind: "subagent_nested",
            parentCallId,
            callId,
            name,
            detail,
            path,
            status: "completed",
          });
        } else {
          const diffPatch =
            isEditTool(name) && pending?.args
              ? diffFromToolArgs(name, pending.args)
              : undefined;
          out.push({
            kind: "tool_done",
            callId,
            name,
            detail,
            path,
            diffPatch: diffPatch || undefined,
          });
        }
      }
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
        const msg = String(
          (typeof ev.result === "string" && ev.result) ||
            (typeof ev.errors === "string" && ev.errors) ||
            ctx.stderr ||
            `Claude Code error (${subtype || "unknown"})`,
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

export const claudeCodeBackend = new ClaudeCodeBackend();
