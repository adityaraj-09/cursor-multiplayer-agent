import {
  Agent,
  AgentBusyError,
  Cursor,
  CursorAgentError,
  type AgentUsage,
  type GetRunOptions,
  type ListRunsOptions,
  type McpServerConfig,
  type ModelSelection,
  type Run,
  type RunResult,
  type SDKAgent,
  type SDKMessage,
  type SDKUserMessage,
} from "@cursor/sdk";
import type { AgentRuntime, AgentTodoItem, ClarifyingQuestion } from "../shared/events.js";
import {
  isQuestionTool,
  isTodoTool,
  parseQuestionToolArgs,
  todoStatusSummary,
  todosFromToolArgs,
} from "../shared/backends/cursor.js";import {
  diffFromToolEvent,
  formatToolResultDetail,
  unwrapToolResultPayload,
} from "../shared/backends/cursor.js";

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
      questions?: ClarifyingQuestion[];
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
      questions?: ClarifyingQuestion[];
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
  /** Cursor SDK conversation mode. */
  mode?: "agent" | "plan";
  /** Cloud only: start a no-repo agent (research workers) instead of cloning `repoUrl`. */
  noRepo?: boolean;
  /**
   * Inline MCP servers, resolved on every create / resume / send. Cursor replaces
   * creation-time servers per send and does not persist them across resume, so
   * callers that rotate credentials pass a factory.
   */
  mcpServers?: () => Record<string, McpServerConfig> | undefined;
  /** Cloud only: caller tags persisted on the Cursor agent. */
  metadata?: Record<string, string>;
}

export type SdkPrompt = string | SDKUserMessage;

interface QueueItem {
  prompt: SdkPrompt;
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
  const todos = todosFromToolArgs(a);
  if (isTodoTool(name) || todos.length > 0) {
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

/** Stream dropped, websocket blip, or the cloud agent is still on a previous run. */
export function isTransientRunStreamError(err: unknown): boolean {
  if (err instanceof AgentBusyError) return true;
  if (
    err &&
    typeof err === "object" &&
    "isRetryable" in err &&
    (err as { isRetryable?: unknown }).isRetryable === true
  ) {
    return true;
  }
  const msg = err instanceof Error ? err.message : String(err);
  const code =
    err && typeof err === "object" && "code" in err
      ? String((err as { code?: unknown }).code || "")
      : "";
  const name =
    err && typeof err === "object" && "name" in err
      ? String((err as { name?: unknown }).name || "")
      : "";
  const blob = `${name} ${msg} ${code}`.toLowerCase();
  return (
    blob.includes("stream is no longer available") ||
    blob.includes("no longer available") ||
    blob.includes("agent_busy") ||
    blob.includes("already has an active run") ||
    blob.includes("rst_stream") ||
    blob.includes("econnreset") ||
    blob.includes("socket hang up") ||
    blob.includes("websocket") ||
    blob.includes("networkerror") ||
    blob.includes("network error") ||
    blob.includes("deadline_exceeded") ||
    blob.includes("service unavailable") ||
    (blob.includes("unavailable") && blob.includes("stream")) ||
    (blob.includes("connect") &&
      (blob.includes("reset") ||
        blob.includes("closed") ||
        blob.includes("refus")))
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function terminalResult(run: Run): RunResult | null {
  if (run.status === "running") return null;
  return {
    id: run.id,
    requestId: run.requestId,
    status: run.status,
    result: run.result,
    error: run.error,
    model: run.model,
    durationMs: run.durationMs,
    git: run.git,
    usage: run.usage,
  };
}

function cancelledResult(runId: string, partial?: Partial<RunResult>): RunResult {
  return {
    id: runId,
    status: "cancelled",
    result: partial?.result,
    error: partial?.error,
    model: partial?.model,
    durationMs: partial?.durationMs,
    git: partial?.git,
    usage: partial?.usage,
  };
}

export class SdkAgentSession {
  private agent: SDKAgent | null = null;
  private processing = false;
  private queue: QueueItem[] = [];
  private activeRun: Run | null = null;
  private lastRunId: string | null = null;
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

  setMode(mode: "agent" | "plan"): void {
    this.config.mode = mode === "plan" ? "plan" : "agent";
  }

  getMode(): "agent" | "plan" {
    return this.config.mode === "plan" ? "plan" : "agent";
  }

  wantsAutoCreatePR(): boolean {
    return Boolean(this.config.autoCreatePR);
  }

  isCloudRuntime(): boolean {
    return this.config.runtime === "cloud";
  }

  /**
   * Download a walkthrough artifact by relative path (`artifacts/foo.webp`).
   * Cloud only — local agents throw / return empty from the SDK.
   */
  async downloadArtifact(path: string): Promise<Buffer> {
    await this.ensureStarted();
    if (!this.agent) throw new Error("Agent failed to start");
    return this.agent.downloadArtifact(path);
  }

  async listArtifacts(): Promise<Array<{ path: string; sizeBytes: number }>> {
    await this.ensureStarted();
    if (!this.agent) return [];
    const items = await this.agent.listArtifacts();
    return items.map((a) => ({ path: a.path, sizeBytes: a.sizeBytes }));
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

    const mcpServers = this.config.mcpServers?.();
    const base = {
      apiKey: this.config.apiKey,
      model: this.config.model,
      name: this.config.name,
      ...(mcpServers ? { mcpServers } : {}),
    };
    const metadata = this.config.metadata ? { metadata: this.config.metadata } : {};

    if (this.config.agentId) {
      this.agent = await Agent.resume(this.config.agentId, {
        ...base,
        ...(this.config.runtime === "local"
          ? { local: { cwd: this.config.localCwd } }
          : {
              cloud: {
                autoCreatePR: Boolean(this.config.autoCreatePR),
                skipReviewerRequest: true,
              },
            }),
      });
    } else if (this.config.runtime === "cloud") {
      if (!this.config.repoUrl && !this.config.noRepo) {
        throw new Error("Cloud runtime requires repoUrl");
      }
      this.agent = await Agent.create({
        ...base,
        mode: this.config.mode === "plan" ? "plan" : "agent",
        cloud: {
          ...(this.config.noRepo || !this.config.repoUrl
            ? {}
            : {
                repos: [
                  {
                    url: this.config.repoUrl,
                    startingRef: this.config.startingRef || "main",
                  },
                ],
              }),
          autoCreatePR: this.config.noRepo ? false : Boolean(this.config.autoCreatePR),
          skipReviewerRequest: true,
          ...metadata,
        },
      });
    } else {
      if (!this.config.localCwd) {
        throw new Error("Local runtime requires cwd");
      }
      this.agent = await Agent.create({
        ...base,
        mode: this.config.mode === "plan" ? "plan" : "agent",
        local: { cwd: this.config.localCwd },
      });
    }

    this.config.agentId = this.agent.agentId;
    return this.agent.agentId;
  }

  run(
    prompt: SdkPrompt,
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
    const assistantBuf = { value: "" };
    const gen = this.abortGeneration;

    try {
      await this.ensureStarted();
      if (gen !== this.abortGeneration) return;
      if (!this.agent) throw new Error("Agent failed to start");

      const run = await this.sendOrJoinActive(item, gen, assistantBuf);
      if (gen !== this.abortGeneration) {
        try {
          if (run.supports("cancel")) await run.cancel();
        } catch {
          // ignore
        }
        return;
      }

      this.lastRunId = run.id;
      this.activeRun = run;
      const result = await this.followRun(run, item, gen, assistantBuf);
      if (gen !== this.abortGeneration || !result || result.status === "cancelled") {
        return;
      }

      this.emitRunOutcome(item, result, assistantBuf);
    } catch (err) {
      if (gen !== this.abortGeneration) return;

      // Live websocket/stream handles die often; settle via getRun/listRuns
      // before surfacing anything to chat / issue runners.
      if (isTransientRunStreamError(err)) {
        const recovered = await this.recoverAfterStreamLoss(
          item,
          gen,
          assistantBuf,
        );
        if (recovered || gen !== this.abortGeneration) return;
      }

      const message =
        err instanceof CursorAgentError
          ? err.message
          : err instanceof Error
            ? err.message
            : String(err);
      item.onEvent({ kind: "error", message });
      throw err instanceof Error ? err : new Error(message);
    } finally {
      this.activeRun = null;
    }
  }

  private sendOptions(): {
    model: ModelSelection;
    mode: "agent" | "plan";
    mcpServers?: Record<string, McpServerConfig>;
  } {
    const mcpServers = this.config.mcpServers?.();
    return {
      model: this.config.model,
      mode: this.config.mode === "plan" ? "plan" : "agent",
      ...(mcpServers ? { mcpServers } : {}),
    };
  }

  /** Billed tokens + dollar cost for this agent (cloud). Null when unavailable. */
  async getUsage(): Promise<AgentUsage | null> {
    try {
      await this.ensureStarted();
      if (!this.agent) return null;
      return await this.agent.getUsage();
    } catch {
      return null;
    }
  }

  /** Best-effort refresh of the SDK transport after a dropped stream. */
  private async reloadAgentTransport(): Promise<void> {
    if (!this.agent) return;
    try {
      await this.agent.reload();
    } catch {
      // reload is best-effort; resume path below can still settle via REST.
    }
  }

  /**
   * After the live stream dies, poll Cursor for the active/last run and emit
   * its outcome. Returns true when the prompt was settled (done or cancelled).
   */
  private async recoverAfterStreamLoss(
    item: QueueItem,
    gen: number,
    assistantBuf: { value: string },
  ): Promise<boolean> {
    await this.reloadAgentTransport();
    const active =
      (this.lastRunId ? await this.refetchRun(this.lastRunId) : null) ||
      (await this.lookupActiveRun());
    if (!active) return false;
    try {
      const recovered = await this.followRun(active, item, gen, assistantBuf);
      if (gen !== this.abortGeneration) return true;
      this.emitRunOutcome(item, recovered, assistantBuf);
      return true;
    } catch (err) {
      if (!isTransientRunStreamError(err)) throw err;
      const settled = await this.pollRunUntilSettled(active.id, gen);
      if (gen !== this.abortGeneration) return true;
      if (settled) {
        this.emitRunOutcome(item, settled, assistantBuf);
        return true;
      }
      return false;
    }
  }

  /** Start a new run, or finish a leftover cloud run first if the agent is busy. */
  private async sendOrJoinActive(
    item: QueueItem,
    gen: number,
    assistantBuf: { value: string },
  ): Promise<Run> {
    let lastErr: unknown;
    for (let attempt = 0; attempt < 8; attempt++) {
      if (gen !== this.abortGeneration) {
        throw lastErr instanceof Error
          ? lastErr
          : new Error("Agent run aborted");
      }
      try {
        return await this.agent!.send(item.prompt, this.sendOptions());
      } catch (err) {
        lastErr = err;
        if (!isTransientRunStreamError(err)) throw err;
        await this.reloadAgentTransport();
        const active = await this.lookupActiveRun();
        if (active) {
          try {
            const recovered = await this.followRun(
              active,
              item,
              gen,
              assistantBuf,
            );
            if (gen !== this.abortGeneration) throw err;
            this.emitRunOutcome(item, recovered, assistantBuf);
            assistantBuf.value = "";
            continue;
          } catch (followErr) {
            if (!isTransientRunStreamError(followErr)) throw followErr;
            const settled = await this.pollRunUntilSettled(active.id, gen);
            if (gen !== this.abortGeneration) throw err;
            if (settled) {
              this.emitRunOutcome(item, settled, assistantBuf);
              assistantBuf.value = "";
              continue;
            }
          }
        }
        await sleep(Math.min(400 * 2 ** attempt, 8000));
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  }

  private async followRun(
    run: Run,
    item: QueueItem,
    gen: number,
    assistantBuf: { value: string },
  ): Promise<RunResult | null> {
    this.lastRunId = run.id;
    this.activeRun = run;
    // Live updates are best-effort. Status polling is the source of truth when
    // Cursor's websocket/stream handle disappears mid-run.
    await this.consumeStream(run, item, gen, assistantBuf);
    if (gen !== this.abortGeneration) return null;
    return this.waitForRun(run, gen);
  }

  private async consumeStream(
    run: Run,
    item: QueueItem,
    gen: number,
    assistantBuf: { value: string },
  ): Promise<void> {
    let current = run;
    let delay = 300;
    for (let attempt = 0; attempt < 6; attempt++) {
      if (gen !== this.abortGeneration) return;
      try {
        for await (const event of current.stream()) {
          if (gen !== this.abortGeneration) return;
          this.dispatchStreamEvent(event, item, assistantBuf);
        }
        return;
      } catch (err) {
        if (gen !== this.abortGeneration) return;
        if (!isTransientRunStreamError(err)) throw err;
        // Live stream dropped — reattach while the run is still active. If the
        // run already finished (or we cannot refetch), stop streaming; waitForRun
        // / pollRunUntilSettled will collect the terminal result over REST.
        if (attempt === 0) await this.reloadAgentTransport();
        const again = await this.refetchRun(current.id);
        if (!again) {
          await sleep(delay);
          delay = Math.min(delay * 2, 4000);
          continue;
        }
        current = again;
        this.activeRun = current;
        this.lastRunId = current.id;
        if (again.status !== "running") return;
        await sleep(delay);
        delay = Math.min(delay * 2, 4000);
      }
    }
  }

  private dispatchStreamEvent(
    event: SDKMessage,
    item: QueueItem,
    assistantBuf: { value: string },
  ): void {
    if (event.type === "assistant") {
      const chunk = extractAssistantText(event);
      if (!chunk) return;
      if (!assistantBuf.value || chunk.startsWith(assistantBuf.value)) {
        assistantBuf.value = chunk;
      } else if (!assistantBuf.value.startsWith(chunk)) {
        assistantBuf.value += chunk;
      }
      item.onEvent({ kind: "assistant_delta", text: assistantBuf.value });
      return;
    }

    if (event.type !== "tool_call") return;
    const args =
      event.args && typeof event.args === "object"
        ? (event.args as Record<string, unknown>)
        : undefined;
    const result =
      "result" in event ? (event as { result?: unknown }).result : undefined;
    const startDetail = toolDetail(event.name, event.args);
    const resultPayload = unwrapToolResultPayload(result);
    const pathFromResult =
      resultPayload && typeof resultPayload.path === "string"
        ? resultPayload.path.trim()
        : undefined;
    const path = toolPath(event.args) || pathFromResult || undefined;
    const todos = args ? todosFromToolArgs(args) : [];
    const toolName =
      todos.length > 0 && !isTodoTool(event.name) ? "todo" : event.name;
    if (event.status === "running") {
      item.onEvent({
        kind: "tool_start",
        callId: event.call_id,
        name: toolName,
        detail: startDetail,
        path,
        todos: todos.length ? todos : undefined,
      });
    } else {
      const detail = formatToolResultDetail(
        event.name,
        args,
        result,
        startDetail || (event.status === "error" ? "error" : path || "done"),
      );
      const diffPatch = !todos.length
        ? diffFromToolEvent(event.name, args, result)
        : undefined;
      item.onEvent({
        kind: "tool_done",
        callId: event.call_id,
        name: toolName,
        detail,
        path,
        diffPatch: diffPatch || undefined,
        todos: todos.length ? todos : undefined,
      });
    }
  }

  private emitRunOutcome(
    item: QueueItem,
    result: RunResult | null,
    assistantBuf: { value: string },
  ): void {
    if (!result || result.status === "cancelled") return;
    if (result.status === "error") {
      item.onEvent({
        kind: "error",
        message: result.error?.message || result.result || "Agent run failed",
      });
      return;
    }
    item.onEvent({
      kind: "done",
      result: result.result || assistantBuf.value,
      git: result.git,
    });
  }

  private async waitForRun(run: Run, gen: number): Promise<RunResult> {
    let current = run;
    let delay = 400;
    let lastErr: unknown;
    let reloaded = false;

    while (true) {
      if (gen !== this.abortGeneration) {
        return cancelledResult(current.id, {
          result: current.result,
          error: current.error,
          model: current.model,
          durationMs: current.durationMs,
          git: current.git,
          usage: current.usage,
        });
      }

      const done = terminalResult(current);
      if (done) return done;

      try {
        return await current.wait();
      } catch (err) {
        lastErr = err;
        if (!isTransientRunStreamError(err)) throw err;
        if (!reloaded) {
          reloaded = true;
          await this.reloadAgentTransport();
        }
      }

      const settled = await this.pollRunUntilSettled(current.id, gen, {
        maxMs: Math.min(delay * 4, 12_000),
        initialDelayMs: delay,
      });
      if (settled) return settled;
      if (gen !== this.abortGeneration) {
        return cancelledResult(current.id);
      }

      const again = await this.refetchRun(current.id);
      if (again) {
        current = again;
        this.activeRun = current;
        this.lastRunId = current.id;
        const terminal = terminalResult(current);
        if (terminal) return terminal;
      }

      await sleep(delay);
      delay = Math.min(Math.round(delay * 1.5), 8000);
      // Bound only by abort — cloud issue agents can run for a long time after
      // the websocket dies. Throwing the raw stream error is what used to leave
      // Steer showing "Run stream is no longer available".
      if (delay >= 8000 && !again) {
        // Still nothing from getRun; keep trying but surface if listRuns finds
        // a different active/finished run for this agent.
        const listed = await this.lookupActiveOrRecentRun();
        if (listed && listed.id !== current.id) {
          current = listed;
          this.activeRun = current;
          this.lastRunId = current.id;
        } else if (!listed && lastErr) {
          throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
        }
      }
    }
  }

  /**
   * Poll Agent.getRun until the run leaves `running`, or `maxMs` elapses.
   * Used when stream()/wait() fail because the Cursor stream handle is gone.
   */
  private async pollRunUntilSettled(
    runId: string,
    gen: number,
    opts?: { maxMs?: number; initialDelayMs?: number },
  ): Promise<RunResult | null> {
    const maxMs = opts?.maxMs ?? 120_000;
    let delay = opts?.initialDelayMs ?? 400;
    const started = Date.now();
    while (Date.now() - started < maxMs) {
      if (gen !== this.abortGeneration) return cancelledResult(runId);
      const again = await this.refetchRun(runId);
      if (again) {
        this.activeRun = again;
        this.lastRunId = again.id;
        const done = terminalResult(again);
        if (done) return done;
      }
      await sleep(delay);
      delay = Math.min(Math.round(delay * 1.5), 5000);
    }
    const last = await this.refetchRun(runId);
    return last ? terminalResult(last) : null;
  }

  private async refetchRun(runId: string): Promise<Run | null> {
    const agentId = this.getAgentId();
    if (!agentId || !runId) return null;
    try {
      return await Agent.getRun(runId, this.getRunOptions(agentId));
    } catch {
      return null;
    }
  }

  private async lookupActiveRun(): Promise<Run | null> {
    if (this.lastRunId) {
      const cached = await this.refetchRun(this.lastRunId);
      if (cached && cached.status === "running") return cached;
    }
    const listed = await this.listAgentRuns();
    return listed.find((r) => r.status === "running") ?? null;
  }

  /** Prefer a running run; otherwise the newest finished/errored run. */
  private async lookupActiveOrRecentRun(): Promise<Run | null> {
    const listed = await this.listAgentRuns();
    const running = listed.find((r) => r.status === "running");
    if (running) return running;
    return listed[0] ?? null;
  }

  private async listAgentRuns(): Promise<Run[]> {
    const agentId = this.getAgentId();
    if (!agentId) return [];
    try {
      const listed = await Agent.listRuns(agentId, this.listRunsOptions());
      return [...(listed.items ?? [])].sort((a, b) => {
        const ta = a.createdAt ?? 0;
        const tb = b.createdAt ?? 0;
        if (ta !== tb) return tb - ta;
        return b.id.localeCompare(a.id);
      });
    } catch {
      return [];
    }
  }

  private getRunOptions(agentId: string): GetRunOptions {
    if (this.config.runtime === "cloud") {
      return { runtime: "cloud", agentId, apiKey: this.config.apiKey };
    }
    return { runtime: "local", cwd: this.config.localCwd };
  }

  private listRunsOptions(): ListRunsOptions {
    if (this.config.runtime === "cloud") {
      return { runtime: "cloud", apiKey: this.config.apiKey };
    }
    return { runtime: "local", cwd: this.config.localCwd };
  }

  async dispose(): Promise<void> {
    this.abortGeneration += 1;
    this.queue = [];
    this.activeRun = null;
    this.lastRunId = null;
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
