import type { SwarmMessageInfo } from "../../shared/swarm.js";
import type { SdkStreamEvent } from "../sdkAgent.js";
import { upsertSwarmMessages } from "./store.js";
import { logWarn } from "../logger.js";

const FLUSH_MS = 2_000;
const MAX_CONTENT = 60_000;

function clip(text: string): string {
  return text.length > MAX_CONTENT ? `${text.slice(0, MAX_CONTENT)}\n…(truncated)` : text;
}

/**
 * Collects one cycle's stream into swarm_messages. Token deltas are coalesced
 * in memory and flushed on a timer (plus on tool boundaries / end of cycle), so
 * the database is not written per token.
 */
export class SwarmTranscriptSink {
  private readonly messages = new Map<string, SwarmMessageInfo>();
  private readonly dirty = new Set<string>();
  private seq = 0;
  private assistantId: string | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  finalText = "";
  error: string | null = null;
  git: Extract<SdkStreamEvent, { kind: "done" }>["git"];

  constructor(
    private readonly swarmId: string,
    private readonly agentId: string,
    private readonly cycle: number,
  ) {
    this.timer = setInterval(() => this.flush(), FLUSH_MS);
    this.timer.unref?.();
  }

  private nextId(suffix: string): string {
    this.seq += 1;
    return `${this.agentId}:${this.cycle}:${this.seq}:${suffix}`;
  }

  private put(message: SwarmMessageInfo): void {
    this.messages.set(message.id, message);
    this.dirty.add(message.id);
  }

  user(text: string): void {
    this.put({
      id: this.nextId("user"),
      agentId: this.agentId,
      cycle: this.cycle,
      role: "user",
      content: clip(text),
      toolName: null,
      status: "done",
      ts: Date.now(),
    });
  }

  private assistant(text: string, status: "running" | "done"): void {
    if (!text.trim()) return;
    if (!this.assistantId) this.assistantId = this.nextId("assistant");
    const prev = this.messages.get(this.assistantId);
    this.put({
      id: this.assistantId,
      agentId: this.agentId,
      cycle: this.cycle,
      role: "assistant",
      content: clip(text),
      toolName: null,
      status,
      ts: prev?.ts ?? Date.now(),
    });
  }

  handle(event: SdkStreamEvent): void {
    switch (event.kind) {
      case "assistant_delta":
      case "assistant_final":
        this.finalText = event.text || this.finalText;
        this.assistant(event.text, event.kind === "assistant_final" ? "done" : "running");
        return;
      case "tool_start":
      case "tool_done": {
        if (this.assistantId) {
          const prev = this.messages.get(this.assistantId);
          if (prev) this.put({ ...prev, status: "done" });
          this.assistantId = null;
        }
        const id = `${this.agentId}:${this.cycle}:tool:${event.callId}`;
        const prev = this.messages.get(id);
        this.put({
          id,
          agentId: this.agentId,
          cycle: this.cycle,
          role: "tool",
          content: clip(event.detail || event.path || event.name),
          toolName: event.name,
          status: event.kind === "tool_start" ? "running" : "done",
          ts: prev?.ts ?? Date.now(),
        });
        if (event.kind === "tool_done") this.flush();
        return;
      }
      case "error":
        this.error = event.message;
        this.put({
          id: this.nextId("error"),
          agentId: this.agentId,
          cycle: this.cycle,
          role: "error",
          content: clip(event.message),
          toolName: null,
          status: "error",
          ts: Date.now(),
        });
        return;
      case "done":
        this.error = null;
        this.git = event.git;
        if (event.result) this.finalText = event.result;
        this.assistant(this.finalText, "done");
        return;
      default:
        return;
    }
  }

  flush(): void {
    if (!this.dirty.size) return;
    const batch = [...this.dirty].map((id) => this.messages.get(id)!).filter(Boolean);
    this.dirty.clear();
    try {
      upsertSwarmMessages(this.swarmId, batch);
    } catch (err) {
      logWarn("swarm", "transcript flush failed", { swarmId: this.swarmId, err });
      for (const m of batch) this.dirty.add(m.id);
    }
  }

  close(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const [id, m] of this.messages) {
      if (m.status === "running") this.put({ ...m, status: "done" });
      else if (!this.dirty.has(id)) continue;
    }
    this.flush();
  }
}
