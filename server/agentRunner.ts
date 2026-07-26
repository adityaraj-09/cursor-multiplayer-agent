import { spawn, type ChildProcess } from "child_process";
import { createInterface } from "readline";

export type AgentStreamEvent =
  | { kind: "session"; sessionId: string }
  | { kind: "assistant_delta"; text: string }
  | { kind: "assistant_final"; text: string }
  | {
      kind: "tool_start";
      callId: string;
      name: string;
      detail: string;
      path?: string;
    }
  | {
      kind: "tool_done";
      callId: string;
      name: string;
      detail: string;
      path?: string;
    }
  | { kind: "error"; message: string }
  | { kind: "done"; result: string };

interface QueueItem {
  prompt: string;
  onEvent: (event: AgentStreamEvent) => void;
  resolve: () => void;
  reject: (err: Error) => void;
}

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
} {
  if (!toolCall) return { name: "tool", detail: "" };
  const key = Object.keys(toolCall).find(
    (k) =>
      k.endsWith("ToolCall") ||
      (!["hookAdditionalContexts", "toolCallId", "startedAtMs", "completedAtMs"].includes(
        k,
      ) &&
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
        args.command ??
          args.globPattern ??
          path ??
          args.targetDirectory ??
          "",
      ) || JSON.stringify(args).slice(0, 120);
  }
  return { name, detail, path };
}

/**
 * Local Cursor CLI agent — uses `cursor agent` login (no API key).
 * Multi-turn via --resume using the stored session id.
 */
export class AgentRunner {
  private sessionId: string | null;
  private queue: QueueItem[] = [];
  private active: ChildProcess | null = null;
  private processing = false;

  constructor(
    private repoPath: string,
    sessionId?: string | null,
    private modelId = "auto",
  ) {
    this.sessionId = sessionId ?? null;
  }

  getSessionId(): string | null {
    return this.sessionId;
  }

  setModel(modelId: string): void {
    this.modelId = modelId || "auto";
  }

  getModel(): string {
    return this.modelId;
  }

  /** CLI has no durable SDK agent id. */
  getAgentId(): string | null {
    return null;
  }

  isBusy(): boolean {
    return this.processing || this.queue.length > 0;
  }

  abort(): void {
    this.active?.kill("SIGTERM");
    this.active = null;
    this.queue = [];
    this.processing = false;
  }

  async dispose(): Promise<void> {
    this.abort();
  }

  run(
    prompt: string,
    onEvent: (event: AgentStreamEvent) => void,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      this.queue.push({ prompt, onEvent, resolve, reject });
      void this.pump();
    });
  }

  private async pump(): Promise<void> {
    if (this.processing) return;
    const item = this.queue.shift();
    if (!item) return;

    this.processing = true;
    try {
      await this.execute(item);
      item.resolve();
    } catch (err) {
      item.reject(err instanceof Error ? err : new Error(String(err)));
    } finally {
      this.processing = false;
      this.active = null;
      void this.pump();
    }
  }

  private execute(item: QueueItem): Promise<void> {
    return new Promise((resolve, reject) => {
      const args = [
        "agent",
        "--print",
        "--output-format",
        "stream-json",
        "--stream-partial-output",
        "--force",
        "--trust",
      ];
      if (this.modelId && this.modelId !== "auto") {
        args.push("--model", this.modelId);
      }
      if (this.sessionId) {
        args.push("--resume", this.sessionId);
      }
      args.push(item.prompt);

      const child = spawn("cursor", args, {
        cwd: this.repoPath,
        env: process.env as NodeJS.ProcessEnv,
        stdio: ["ignore", "pipe", "pipe"],
      });
      this.active = child;

      let stderr = "";
      let settled = false;
      let assistantBuf = "";
      let gotTerminalEvent = false;

      const finish = (err?: Error) => {
        if (settled) return;
        settled = true;
        if (err) reject(err);
        else resolve();
      };

      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      const rl = createInterface({ input: child.stdout });
      rl.on("line", (line) => {
        const trimmed = line.trim();
        if (!trimmed) return;
        let ev: Record<string, unknown>;
        try {
          ev = JSON.parse(trimmed) as Record<string, unknown>;
        } catch {
          return;
        }

        const type = ev.type as string;

        if (type === "system" && ev.subtype === "init" && ev.session_id) {
          this.sessionId = String(ev.session_id);
          item.onEvent({ kind: "session", sessionId: this.sessionId });
          return;
        }

        if (type === "assistant") {
          const text = extractText(ev.message);
          if (!text) return;
          // Partials include timestamp_ms; final full message usually doesn't.
          if ("timestamp_ms" in ev) {
            assistantBuf += text;
            item.onEvent({ kind: "assistant_delta", text: assistantBuf });
          } else {
            assistantBuf = text;
            item.onEvent({ kind: "assistant_final", text });
          }
          return;
        }

        if (type === "tool_call") {
          const callId = String(ev.call_id ?? "");
          const info = toolInfo(ev.tool_call as Record<string, unknown>);
          if (ev.subtype === "started") {
            item.onEvent({
              kind: "tool_start",
              callId,
              name: info.name,
              detail: info.detail,
              path: info.path,
            });
          } else if (ev.subtype === "completed") {
            item.onEvent({
              kind: "tool_done",
              callId,
              name: info.name,
              detail: info.detail,
              path: info.path,
            });
          }
          return;
        }

        if (type === "result") {
          gotTerminalEvent = true;
          if (ev.session_id) {
            this.sessionId = String(ev.session_id);
            item.onEvent({ kind: "session", sessionId: this.sessionId });
          }
          if (ev.is_error) {
            const msg = String(
              ev.result != null && ev.result !== ""
                ? ev.result
                : stderr || "Agent error",
            );
            item.onEvent({ kind: "error", message: msg });
          } else {
            const result = String(ev.result ?? assistantBuf);
            item.onEvent({ kind: "done", result });
          }
        }
      });

      child.on("error", (err) => {
        if (!gotTerminalEvent) {
          item.onEvent({ kind: "error", message: err.message });
        }
        finish(err);
      });

      child.on("close", (code) => {
        if (settled) return;
        if (code === 0) {
          if (!gotTerminalEvent && assistantBuf) {
            item.onEvent({ kind: "done", result: assistantBuf });
          }
          finish();
        } else {
          const msg =
            stderr.trim() || `Agent exited with code ${code ?? "unknown"}`;
          if (!gotTerminalEvent) {
            item.onEvent({ kind: "error", message: msg });
          }
          finish(new Error(msg));
        }
      });
    });
  }
}
