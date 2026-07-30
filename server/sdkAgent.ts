import {
  Agent,
  Cursor,
  CursorAgentError,
  type ModelSelection,
  type SDKAgent,
  type SDKMessage,
} from "@cursor/sdk";
import type { AgentRuntime } from "../shared/events.js";

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
    }
  | {
      kind: "tool_done";
      callId: string;
      name: string;
      detail: string;
      path?: string;
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

function toolDetail(args: unknown): string {
  if (!args || typeof args !== "object") return "";
  const a = args as Record<string, unknown>;
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

  /** Stop queued + in-flight work (best-effort for SDK runs). */
  abort(): void {
    const pending = this.queue.splice(0);
    for (const item of pending) {
      try {
        item.onEvent({ kind: "error", message: "Aborted" });
      } catch {
        // ignore listener errors
      }
      item.resolve();
    }
    this.processing = false;

    const agent = this.agent;
    this.agent = null;
    if (!agent) return;
    void Promise.resolve()
      .then(async () => {
        try {
          await agent[Symbol.asyncDispose]();
        } catch {
          try {
            agent.close();
          } catch {
            // ignore
          }
        }
      })
      .catch(() => {
        // ignore dispose failures on abort
      });
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

    try {
      await this.ensureStarted();
      if (!this.agent) throw new Error("Agent failed to start");

      const run = await this.agent.send(item.prompt, {
        model: this.config.model,
      });

      for await (const event of run.stream()) {
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
          const detail = toolDetail(event.args);
          const path = toolPath(event.args);
          if (event.status === "running") {
            item.onEvent({
              kind: "tool_start",
              callId: event.call_id,
              name: event.name,
              detail,
              path,
            });
          } else {
            item.onEvent({
              kind: "tool_done",
              callId: event.call_id,
              name: event.name,
              detail: detail || (event.status === "error" ? "error" : "done"),
              path,
            });
          }
        }
      }

      const result = await run.wait();
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
      const message =
        err instanceof CursorAgentError
          ? err.message
          : err instanceof Error
            ? err.message
            : String(err);
      item.onEvent({ kind: "error", message });
      throw err instanceof Error ? err : new Error(message);
    }
  }

  async dispose(): Promise<void> {
    this.queue = [];
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
  return repos.map((r) => ({ url: r.url }));
}
