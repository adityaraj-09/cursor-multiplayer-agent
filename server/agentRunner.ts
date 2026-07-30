import { spawn, type ChildProcess } from "child_process";
import { createInterface } from "readline";
import {
  cursorAgentBackend,
  type NormalizedAgentEvent,
} from "../shared/backends/index.js";

export type AgentStreamEvent = NormalizedAgentEvent;

interface QueueItem {
  prompt: string;
  onEvent: (event: AgentStreamEvent) => void;
  resolve: () => void;
  reject: (err: Error) => void;
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
  private aborted = false;

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

  setSessionId(sessionId: string | null): void {
    this.sessionId = sessionId?.trim() || null;
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

  /** Fire-and-forget abort. Prefer abortAndWait. */
  abort(): void {
    void this.abortAndWait();
  }

  /** SIGTERM the active child and wait for it to exit (with a short timeout). */
  async abortAndWait(): Promise<void> {
    this.aborted = true;
    this.queue = [];
    const child = this.active;
    if (!child) {
      this.processing = false;
      return;
    }

    await new Promise<void>((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      child.once("close", done);
      child.once("error", done);
      try {
        child.kill("SIGTERM");
      } catch {
        done();
        return;
      }
      setTimeout(done, 2000);
    });

    this.active = null;
    this.processing = false;
  }

  async dispose(): Promise<void> {
    await this.abortAndWait();
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
    this.aborted = false;
    try {
      await this.execute(item);
      item.resolve();
    } catch (err) {
      if (this.aborted) {
        item.resolve();
      } else {
        item.reject(err instanceof Error ? err : new Error(String(err)));
      }
    } finally {
      this.processing = false;
      this.active = null;
      void this.pump();
    }
  }

  private execute(item: QueueItem): Promise<void> {
    return new Promise((resolve, reject) => {
      const args = cursorAgentBackend.buildArgs({
        prompt: item.prompt,
        modelId: this.modelId,
        sessionId: this.sessionId,
      });

      const child = spawn(cursorAgentBackend.command, args, {
        cwd: this.repoPath,
        env: process.env as NodeJS.ProcessEnv,
        stdio: ["ignore", "pipe", "pipe"],
      });
      this.active = child;

      let stderr = "";
      let settled = false;
      const ctx = {
        assistantBuf: { value: "" },
        gotTerminalEvent: { value: false },
        stderr: "",
      };

      const finish = (err?: Error) => {
        if (settled) return;
        settled = true;
        if (err) reject(err);
        else resolve();
      };

      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
        ctx.stderr = stderr;
      });

      const rl = createInterface({ input: child.stdout });
      rl.on("line", (line) => {
        if (this.aborted) return;
        const trimmed = line.trim();
        if (!trimmed) return;
        let ev: unknown;
        try {
          ev = JSON.parse(trimmed);
        } catch {
          return;
        }

        for (const event of cursorAgentBackend.parseLine(ev, ctx)) {
          if (event.kind === "session") {
            this.sessionId = event.sessionId;
          }
          item.onEvent(event);
        }
      });

      child.on("error", (err) => {
        if (this.aborted) {
          finish();
          return;
        }
        if (!ctx.gotTerminalEvent.value) {
          item.onEvent({ kind: "error", message: err.message });
        }
        finish(err);
      });

      child.on("close", (code) => {
        if (settled) return;
        if (this.aborted) {
          finish();
          return;
        }
        if (code === 0) {
          if (!ctx.gotTerminalEvent.value && ctx.assistantBuf.value) {
            item.onEvent({ kind: "done", result: ctx.assistantBuf.value });
          }
          finish();
        } else {
          const msg =
            stderr.trim() || `Agent exited with code ${code ?? "unknown"}`;
          if (!ctx.gotTerminalEvent.value) {
            item.onEvent({ kind: "error", message: msg });
          }
          finish(new Error(msg));
        }
      });
    });
  }
}
