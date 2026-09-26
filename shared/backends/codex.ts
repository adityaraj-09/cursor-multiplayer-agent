import type {
  AgentTodoItem,
  BuildArgsOptions,
  NormalizedAgentEvent,
  ParseLineContext,
  WorkerBackend,
} from "./types.js";
import {
  formatToolResultDetail,
  isEditTool,
  TOOL_RESULT_DETAIL_LIMIT,
} from "./cursor.js";
import { stringifyUnknown } from "../stringifyUnknown";

/**
 * OpenAI Codex CLI headless backend.
 * Spawns: `codex exec --json --dangerously-bypass-approvals-and-sandbox …`
 *
 * Event stream is JSONL (`thread.*`, `item.*`, `turn.*`).
 */
export class CodexBackend implements WorkerBackend {
  readonly kind = "codex" as const;
  readonly available = true;
  readonly command = "codex";

  buildArgs(opts: BuildArgsOptions): string[] {
    const args = ["exec", "--json"];
    if (opts.mode === "plan") {
      args.push("--sandbox", "read-only");
    } else {
      args.push("--dangerously-bypass-approvals-and-sandbox");
    }
    if (opts.modelId && opts.modelId !== "auto") {
      args.push("--model", opts.modelId);
    }
    if (opts.sessionId) {
      args.push("resume", opts.sessionId);
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
    const type = String(ev.type ?? "");
    const out: NormalizedAgentEvent[] = [];

    if (type === "thread.started" && ev.thread_id) {
      out.push({ kind: "session", sessionId: String(ev.thread_id) });
      return out;
    }

    if (type === "error") {
      ctx.gotTerminalEvent.value = true;
      out.push({
        kind: "error",
        message:
          stringifyUnknown(ev.message) ||
          stringifyUnknown(ev.error) ||
          ctx.stderr ||
          "Codex error",
      });
      return out;
    }

    if (type === "turn.failed") {
      ctx.gotTerminalEvent.value = true;
      out.push({
        kind: "error",
        message:
          stringifyUnknown(ev.error) ||
          stringifyUnknown(ev.message) ||
          ctx.stderr ||
          "Codex turn failed",
      });
      return out;
    }

    if (type === "turn.completed") {
      ctx.gotTerminalEvent.value = true;
      out.push({
        kind: "done",
        result: ctx.assistantBuf.value || "",
      });
      return out;
    }

    if (
      type === "item.started" ||
      type === "item.updated" ||
      type === "item.completed"
    ) {
      const item = ev.item;
      if (!item || typeof item !== "object") return out;
      const rec = item as Record<string, unknown>;
      const itemType = String(rec.type ?? "");
      const callId = String(rec.id ?? `${itemType}-${type}`);

      if (itemType === "agent_message") {
        const text = typeof rec.text === "string" ? rec.text : "";
        if (!text) return out;
        if (type === "item.completed") {
          ctx.assistantBuf.value = text;
          out.push({ kind: "assistant_final", text });
        } else if (text.length >= ctx.assistantBuf.value.length) {
          ctx.assistantBuf.value = text;
          out.push({ kind: "assistant_delta", text });
        }
        return out;
      }

      if (itemType === "command_execution") {
        const command = typeof rec.command === "string" ? rec.command : "shell";
        const path = firstPath(rec);
        if (type === "item.started") {
          out.push({
            kind: "tool_start",
            callId,
            name: "Bash",
            detail: command.slice(0, 160),
            path,
          });
        } else if (type === "item.completed") {
          const output =
            typeof rec.aggregated_output === "string"
              ? rec.aggregated_output
              : typeof rec.output === "string"
                ? rec.output
                : command;
          out.push({
            kind: "tool_done",
            callId,
            name: "Bash",
            detail: formatToolResultDetail(
              "Bash",
              { command },
              { success: { content: output } },
              output,
            ).slice(0, TOOL_RESULT_DETAIL_LIMIT),
            path,
          });
        }
        return out;
      }

      if (itemType === "file_change" || itemType === "mcp_tool_call") {
        const name = itemType === "file_change" ? "Edit" : String(rec.name || "mcp");
        const path = firstPath(rec);
        const detail =
          typeof rec.command === "string"
            ? rec.command
            : path || name;
        if (type === "item.started") {
          out.push({
            kind: "tool_start",
            callId,
            name: isEditTool(name) ? name : name,
            detail: String(detail).slice(0, 160),
            path,
          });
        } else if (type === "item.completed") {
          out.push({
            kind: "tool_done",
            callId,
            name,
            detail: String(detail).slice(0, TOOL_RESULT_DETAIL_LIMIT),
            path,
          });
        }
        return out;
      }

      if (itemType === "todo_list" && Array.isArray(rec.items)) {
        const todos = rec.items
          .filter((row): row is Record<string, unknown> =>
            Boolean(row && typeof row === "object"),
          )
          .map((row, index) => {
            const raw = String(row.status ?? "");
            const status: AgentTodoItem["status"] =
              raw === "completed" ||
              raw === "in_progress" ||
              raw === "cancelled"
                ? raw
                : "pending";
            return {
              id: String(row.id ?? `todo-${index}`),
              content: String(row.text ?? row.content ?? ""),
              status,
            };
          });
        if (todos.length) {
          out.push({
            kind: type === "item.started" ? "tool_start" : "tool_done",
            callId,
            name: "todo",
            detail: `${todos.length} todos`,
            todos,
          });
        }
        return out;
      }
    }

    return out;
  }
}

function firstPath(rec: Record<string, unknown>): string | undefined {
  for (const key of ["path", "file_path", "filePath", "target_file"]) {
    if (typeof rec[key] === "string" && rec[key].trim()) {
      return String(rec[key]).trim();
    }
  }
  const changes = rec.changes;
  if (Array.isArray(changes)) {
    for (const change of changes) {
      if (change && typeof change === "object" && "path" in change) {
        const path = String((change as { path?: unknown }).path ?? "").trim();
        if (path) return path;
      }
    }
  }
  return undefined;
}

export const codexBackend = new CodexBackend();
