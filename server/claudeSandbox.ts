import { Sandbox } from "e2b";
import {
  getBackend,
  type NormalizedAgentEvent,
} from "../shared/backends/index.js";

export type ClaudeSandboxStreamEvent = NormalizedAgentEvent;

export interface ClaudeSandboxConfig {
  apiKey: string; // Anthropic API key
  e2bApiKey?: string;
  model: string;
  name: string;
  repoUrl: string;
  startingRef?: string;
  githubToken?: string;
  /** Resume Claude session id across turns */
  sessionId?: string | null;
  /** Keep sandbox alive between turns (E2B sandbox id) */
  sandboxId?: string | null;
}

interface QueueItem {
  prompt: string;
  onEvent: (event: ClaudeSandboxStreamEvent) => void;
  resolve: () => void;
  reject: (err: Error) => void;
}

function requireEnv(name: string, fallback?: string): string {
  const v = fallback?.trim() || process.env[name]?.trim() || "";
  if (!v) throw new Error(`${name} is not configured`);
  return v;
}

/**
 * Cloud Claude Code agent running inside an E2B sandbox.
 * Mirrors SdkAgentSession / AgentRunner surface used by RoomManager.
 */
export class ClaudeSandboxSession {
  private sandbox: Sandbox | null = null;
  private sessionId: string | null;
  private sandboxId: string | null;
  private queue: QueueItem[] = [];
  private processing = false;
  private aborted = false;
  private activeAbort: (() => void) | null = null;

  constructor(private config: ClaudeSandboxConfig) {
    this.sessionId = config.sessionId ?? null;
    this.sandboxId = config.sandboxId ?? null;
  }

  getSessionId(): string | null {
    return this.sessionId;
  }

  setSessionId(sessionId: string | null): void {
    this.sessionId = sessionId?.trim() || null;
  }

  getSandboxId(): string | null {
    return this.sandboxId;
  }

  setModel(modelId: string): void {
    this.config.model = modelId || "sonnet";
  }

  getModel(): string {
    return this.config.model;
  }

  /**
   * Reuse sdk_agent_id column to persist the E2B sandbox id so the
   * sandbox can be reconnected across server restarts / follow-up turns.
   */
  getAgentId(): string | null {
    return this.sandboxId;
  }

  isBusy(): boolean {
    return this.processing || this.queue.length > 0;
  }

  abort(): void {
    void this.abortAndWait();
  }

  async abortAndWait(): Promise<void> {
    this.aborted = true;
    this.queue = [];
    try {
      this.activeAbort?.();
    } catch {
      // ignore
    }
    this.activeAbort = null;
    this.processing = false;
  }

  async dispose(): Promise<void> {
    await this.abortAndWait();
    const sbx = this.sandbox;
    this.sandbox = null;
    if (!sbx) return;
    try {
      await sbx.kill();
    } catch {
      // ignore
    }
    this.sandboxId = null;
  }

  run(
    prompt: string,
    onEvent: (event: ClaudeSandboxStreamEvent) => void,
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
      this.activeAbort = null;
      void this.pump();
    }
  }

  private async ensureSandbox(): Promise<Sandbox> {
    if (this.sandbox) return this.sandbox;

    const e2bKey = requireEnv("E2B_API_KEY", this.config.e2bApiKey);
    const anthropicKey = requireEnv("ANTHROPIC_API_KEY", this.config.apiKey);

    if (this.sandboxId) {
      try {
        this.sandbox = await Sandbox.connect(this.sandboxId, {
          apiKey: e2bKey,
        });
        return this.sandbox;
      } catch {
        this.sandboxId = null;
      }
    }

    this.sandbox = await Sandbox.create("claude", {
      apiKey: e2bKey,
      envs: { ANTHROPIC_API_KEY: anthropicKey },
      timeoutMs: 60 * 60 * 1000,
    });
    this.sandboxId = this.sandbox.sandboxId;

    const repoUrl = this.config.repoUrl.trim();
    if (!repoUrl) throw new Error("Cloud Claude Code requires repoUrl");

    const ref = this.config.startingRef?.trim() || "main";
    const token = this.config.githubToken?.trim() || process.env.GITHUB_TOKEN?.trim();
    const cloneOpts: {
      path: string;
      username?: string;
      password?: string;
      depth?: number;
    } = { path: "/home/user/repo", depth: 1 };
    if (token) {
      cloneOpts.username = "x-access-token";
      cloneOpts.password = token;
    }

    // Prefer git helper when available; fall back to shell clone.
    try {
      const git = (
        this.sandbox as unknown as {
          git?: {
            clone: (
              url: string,
              opts: typeof cloneOpts,
            ) => Promise<unknown>;
          };
        }
      ).git;
      if (git?.clone) {
        await git.clone(repoUrl, cloneOpts);
      } else {
        const authUrl = token
          ? repoUrl.replace(
              /^https:\/\//,
              `https://x-access-token:${token}@`,
            )
          : repoUrl;
        await this.sandbox.commands.run(
          `git clone --depth 1 --branch ${shellQuote(ref)} ${shellQuote(authUrl)} /home/user/repo`,
          { timeoutMs: 120_000 },
        );
      }
    } catch (err) {
      // Branch might not exist remotely yet — clone default then checkout
      const authUrl = token
        ? repoUrl.replace(/^https:\/\//, `https://x-access-token:${token}@`)
        : repoUrl;
      await this.sandbox.commands.run(
        `rm -rf /home/user/repo && git clone --depth 1 ${shellQuote(authUrl)} /home/user/repo && cd /home/user/repo && git checkout ${shellQuote(ref)} 2>/dev/null || true`,
        { timeoutMs: 180_000 },
      );
      if (err && !this.sandbox) throw err;
    }

    return this.sandbox;
  }

  private async execute(item: QueueItem): Promise<void> {
    const backend = getBackend("claude-code");
    const args = backend.buildArgs({
      prompt: item.prompt,
      modelId: this.config.model,
      sessionId: this.sessionId,
    });

    const sbx = await this.ensureSandbox();
    if (this.aborted) return;

    const cmd = [backend.command, ...args.map(shellQuote)].join(" ");

    const ctx = {
      assistantBuf: { value: "" },
      gotTerminalEvent: { value: false },
      stderr: "",
    };

    let lineBuf = "";
    let killed = false;

    this.activeAbort = () => {
      killed = true;
      // Best-effort: kill claude processes in the sandbox
      void sbx.commands
        .run("pkill -f 'claude' || true", { timeoutMs: 5_000 })
        .catch(() => undefined);
    };

    const flushLine = (line: string) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      let ev: unknown;
      try {
        ev = JSON.parse(trimmed);
      } catch {
        return;
      }
      for (const event of backend.parseLine(ev, ctx)) {
        if (event.kind === "session") {
          this.sessionId = event.sessionId;
        }
        item.onEvent(event);
      }
    };

    try {
      let result: { exitCode: number; stderr?: string };
      try {
        result = await sbx.commands.run(cmd, {
          cwd: "/home/user/repo",
          timeoutMs: 45 * 60 * 1000,
          onStdout: (data: string) => {
            if (this.aborted || killed) return;
            lineBuf += data;
            const lines = lineBuf.split("\n");
            lineBuf = lines.pop() || "";
            for (const line of lines) flushLine(line);
          },
          onStderr: (data: string) => {
            ctx.stderr += data;
          },
        });
      } catch (err) {
        // E2B throws CommandExitError on non-zero exit — treat as a result.
        const e = err as { exitCode?: number; stderr?: string; message?: string };
        if (typeof e.exitCode === "number") {
          result = { exitCode: e.exitCode, stderr: e.stderr };
        } else {
          throw err;
        }
      }

      if (this.aborted || killed) {
        item.onEvent({ kind: "error", message: "Aborted" });
        return;
      }

      if (lineBuf.trim()) flushLine(lineBuf);

      if (!ctx.gotTerminalEvent.value) {
        if (result.exitCode !== 0) {
          const msg =
            ctx.stderr.trim() ||
            result.stderr?.trim() ||
            `Claude Code exited with code ${result.exitCode}`;
          item.onEvent({ kind: "error", message: msg });
        } else if (ctx.assistantBuf.value) {
          item.onEvent({ kind: "done", result: ctx.assistantBuf.value });
        } else {
          item.onEvent({ kind: "done", result: "" });
        }
      }
    } catch (err) {
      if (this.aborted || killed) {
        item.onEvent({ kind: "error", message: "Aborted" });
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      if (!ctx.gotTerminalEvent.value) {
        item.onEvent({ kind: "error", message });
      }
      throw err instanceof Error ? err : new Error(message);
    }
  }
}

function shellQuote(s: string): string {
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(s)) return s;
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/** E2B sandbox host is server-configured; Anthropic key is BYOK / server fallback. */
export function isClaudeSandboxConfigured(): boolean {
  return Boolean(process.env.E2B_API_KEY?.trim());
}
