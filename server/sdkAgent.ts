import {
  Agent,
  Cursor,
  CursorAgentError,
  type ModelSelection,
  type Run,
  type SDKAgent,
  type SDKMessage,
} from "@cursor/sdk";
import type { AgentRuntime, AgentTodoItem } from "../shared/events.js";
import {
  isTodoTool,
  todoStatusSummary,
  todosFromToolArgs,
} from "../shared/backends/cursor.js";
import { diffFromToolArgs, isEditTool } from "./gitDiff.js";

export interface RunGitInfo {
  branches: Array<{
    repoUrl: string;
    branch?: string;
    prUrl?: string;
  }>;
}

export type SdkStreamEvent =
  | { kind: "session"; sessionId: string }
  | { kind: "assistant_delta"; text: string }
  | { kind: "assistant_final"; text: string }
  | {
      kind: "tool_start";
      callId: string;
      name: string;
      detail: string;
      path?: string;
      todos?: AgentTodoItem[];
    }
  | {
      kind: "tool_done";
      callId: string;
      name: string;
      detail: string;
      path?: string;
      /** Synthetic or tool-provided unified diff for chat display. */
      diffPatch?: string;
      todos?: AgentTodoItem[];
    }
  | { kind: "error"; message: string }
  | { kind: "done"; result: string; git?: RunGitInfo };

export interface SdkAgentConfig {
  runtime: AgentRuntime;
  apiKey: string;
  model: ModelSelection;
  name: string;
  agentId?: string | null;
  localCwd?: string;
  repoUrl?: string;
  startingRef?: string;
  autoCreatePR?: boolean;
}

interface QueueItem {
  prompt: string;
  onEvent: (event: SdkStreamEvent) => void;
  resolve: () => void;
  reject: (err: Error) => void;
}

function extractAssistantText(message: SDKMessage): string {
  if (message.type !== "assistant") return "";
  return message.message.content
    .map((block) => (block.type === "text" ? block.text : ""))
    .join("");
}

function toolDetail(name: string, args: unknown): string {
  if (!args || typeof args !== "object") return "";
  const a = args as Record<string, unknown>;
  if (isTodoTool(name)) {
    const todos = todosFromToolArgs(a);
    return todos.length
      ? `${todos.length} todo${todos.length === 1 ? "" : "s"} · ${todoStatusSummary(todos)}`
      : "Updating todos";
  }
  const v =
    a.command ??
    a.globPattern ??
    a.path ??
    a.filePath ??
    a.file_path ??
    a.target_file ??
    a.targetDirectory ??
    a.pattern;
  if (typeof v === "string") return v.slice(0, 160);
  try {
    return JSON.stringify(args).slice(0, 160);
  } catch {
    return "";
  }
}

function toolPath(args: unknown): string | undefined {
  if (!args || typeof args !== "object") return undefined;
  const a = args as Record<string, unknown>;
  for (const k of [
    "path",
    "filePath",
    "file_path",
    "target_file",
    "targetFile",
  ]) {
    if (typeof a[k] === "string" && a[k].trim()) return String(a[k]).trim();
  }
  return undefined;
}

export class SdkAgentSession {
  private agent: SDKAgent | null = null;
  private processing = false;
  private queue: QueueItem[] = [];
  private activeRun: Run | null = null;
  /** Bumped on each abort so in-flight execute/start can detect cancellation. */
  private abortGeneration = 0;

  constructor(private config: SdkAgentConfig) {}

  getAgentId(): string | null {
    return this.agent?.agentId ?? this.config.agentId ?? null;
  }

  /** SDK agents use agentId, not CLI session ids. */
  getSessionId(): string | null {
    return null;
  }

  setModel(modelId: string): void {
    this.config.model = { id: modelId };
  }

  getModel(): string {
    return this.config.model.id;
  }

  isBusy(): boolean {
    return this.processing || this.queue.length > 0;
  }

  /** Fire-and-forget abort (stopRoom / stopAgent). Prefer abortAndWait. */
  abort(): void {
    void this.abortAndWait();
  }

  /**
   * Cancel queued + in-flight work and wait for the active SDK run to stop.
   * Keeps the agent session alive so the next prompt can continue the conversation.
   */
  async abortAndWait(): Promise<void> {
    this.abortGeneration += 1;

    const pending = this.queue.splice(0);
    for (const item of pending) {
      item.resolve();
    }

    const run = this.activeRun;
    if (run) {
      try {
        if (run.supports("cancel")) {
          await run.cancel();
        }
      } catch {
        // ignore cancel failures — dispose path is separate
      }
    }

    this.processing = false;
  }

  async ensureStarted(): Promise<string> {
    if (this.agent) return this.agent.agentId;

    const base = {
      apiKey: this.config.apiKey,
      model: this.config.model,
      name: this.config.name,
    };

    if (this.config.agentId) {
      this.agent = await Agent.resume(this.config.agentId, {
        ...base,
        ...(this.config.runtime === "local"
          ? { local: { cwd: this.config.localCwd } }
          : { cloud: {} }),
      });
    } else if (this.config.runtime === "cloud") {
      if (!this.config.repoUrl) {
        throw new Error("Cloud runtime requires repoUrl");
      }
      this.agent = await Agent.create({
        ...base,
        cloud: {
          repos: [
            {
              url: this.config.repoUrl,
              startingRef: this.config.startingRef || "main",
            },
          ],
          autoCreatePR: Boolean(this.config.autoCreatePR),
          skipReviewerRequest: true,
        },
      });
    } else {
      if (!this.config.localCwd) {
        throw new Error("Local runtime requires cwd");
      }
      this.agent = await Agent.create({
        ...base,
        local: { cwd: this.config.localCwd },
      });
    }

    this.config.agentId = this.agent.agentId;
    return this.agent.agentId;
  }

  run(
    prompt: string,
    onEvent: (event: SdkStreamEvent) => void,
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
      void this.pump();
    }
  }

  private async execute(item: QueueItem): Promise<void> {
    let assistantBuf = "";
    const gen = this.abortGeneration;

    try {
      await this.ensureStarted();
      if (gen !== this.abortGeneration) return;
      if (!this.agent) throw new Error("Agent failed to start");

      const run = await this.agent.send(item.prompt, {
        model: this.config.model,
      });

      if (gen !== this.abortGeneration) {
        try {
          if (run.supports("cancel")) await run.cancel();
        } catch {
          // ignore
        }
        return;
      }

      this.activeRun = run;

      for await (const event of run.stream()) {
        if (gen !== this.abortGeneration) break;

        if (event.type === "assistant") {
          const chunk = extractAssistantText(event);
          if (!chunk) continue;
          if (!assistantBuf || chunk.startsWith(assistantBuf)) {
            assistantBuf = chunk;
          } else if (!assistantBuf.startsWith(chunk)) {
            assistantBuf += chunk;
          }
          item.onEvent({ kind: "assistant_delta", text: assistantBuf });
          continue;
        }

        if (event.type === "tool_call") {
          const args =
            event.args && typeof event.args === "object"
              ? (event.args as Record<string, unknown>)
              : undefined;
          const detail = toolDetail(event.name, event.args);
          const path = toolPath(event.args);
          const todos =
            isTodoTool(event.name) && args
              ? todosFromToolArgs(args)
              : undefined;
          if (event.status === "running") {
            item.onEvent({
              kind: "tool_start",
              callId: event.call_id,
              name: event.name,
              detail,
              path,
              todos: todos?.length ? todos : undefined,
            });
          } else {
            const diffPatch =
              isEditTool(event.name) && args
                ? diffFromToolArgs(event.name, args)
                : undefined;
            item.onEvent({
              kind: "tool_done",
              callId: event.call_id,
              name: event.name,
              detail: detail || (event.status === "error" ? "error" : "done"),
              path,
              diffPatch: diffPatch || undefined,
              todos: todos?.length ? todos : undefined,
            });
          }
        }
      }

      if (gen !== this.abortGeneration) return;

      const result = await run.wait();
      if (gen !== this.abortGeneration || result.status === "cancelled") {
        return;
      }

      if (result.status === "error") {
        const msg =
          result.error?.message || result.result || "Agent run failed";
        item.onEvent({ kind: "error", message: msg });
        return;
      }

      item.onEvent({
        kind: "done",
        result: result.result || assistantBuf,
        git: result.git,
      });
    } catch (err) {
      if (gen !== this.abortGeneration) return;
      const message =
        err instanceof CursorAgentError
          ? err.message
          : err instanceof Error
            ? err.message
            : String(err);
      item.onEvent({ kind: "error", message });
      throw err instanceof Error ? err : new Error(message);
    } finally {
      if (this.activeRun) this.activeRun = null;
    }
  }

  async dispose(): Promise<void> {
    this.abortGeneration += 1;
    this.queue = [];
    this.activeRun = null;
    if (!this.agent) return;
    try {
      await this.agent[Symbol.asyncDispose]();
    } catch {
      try {
        this.agent.close();
      } catch {
        // ignore
      }
    }
    this.agent = null;
  }
}

export async function listModelsForKey(apiKey: string) {
  const models = await Cursor.models.list({ apiKey });
  return models.map((m) => ({
    id: m.id,
    displayName: m.displayName || m.id,
    description: m.description,
  }));
}

export async function listReposForKey(apiKey: string) {
  const repos = await Cursor.repositories.list({ apiKey });
  // Cursor returns repos oldest-first; reverse so the latest connected repo is first in the UI.
  return repos.map((r) => ({ url: r.url })).reverse();
}
