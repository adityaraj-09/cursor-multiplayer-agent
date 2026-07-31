import { Sandbox } from "e2b";
import { nanoid } from "nanoid";
import {
  getBackend,
  isEditTool,
  type NormalizedAgentEvent,
  type RunGitInfo,
} from "../shared/backends/index.js";
import {
  authedGithubHttpsUrl,
  createPullRequest,
  githubTokenFromEnv,
  parseGithubRepoUrl,
  slugifyBranchPart,
} from "./githubPr.js";

export type ClaudeSandboxStreamEvent = NormalizedAgentEvent;

const REPO_DIR = "/home/user/repo";
const SANDBOX_IDLE_MS = 60 * 60 * 1000;
const CLONE_TIMEOUT_MS = 180_000;
const RUN_TIMEOUT_MS = 45 * 60 * 1000;

export interface ClaudeSandboxConfig {
  /** Anthropic API key (BYOK or server). */
  apiKey: string;
  e2bApiKey?: string;
  model: string;
  name: string;
  repoUrl: string;
  startingRef?: string;
  githubToken?: string;
  autoCreatePR?: boolean;
  /** Resume Claude conversation id across turns */
  sessionId?: string | null;
  /** Persist E2B sandbox id across reconnects */
  sandboxId?: string | null;
  /** Persist working branch name across reconnects */
  branch?: string | null;
  /** Already-opened PR URL (skip recreate) */
  prUrl?: string | null;
  /** Fired once the sandbox + working branch are ready (for durable identity). */
  onReady?: (info: {
    sandboxId: string;
    branch: string | null;
  }) => void;
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

function shellQuote(s: string): string {
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(s)) return s;
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/**
 * Cloud Claude Code agent running inside an E2B sandbox.
 *
 * Lifecycle:
 *  1. Create/reconnect sandbox with Anthropic key
 *  2. Clone repo at startingRef, create dedicated working branch
 *  3. Stream `claude -p --output-format stream-json`
 *  4. Enrich edit tools with live `git diff` from the sandbox
 *  5. On success: commit, push, optionally open a PR; emit `done.git`
 */
export class ClaudeSandboxSession {
  private sandbox: Sandbox | null = null;
  private sessionId: string | null;
  private sandboxId: string | null;
  private branch: string | null;
  private prUrl: string | null;
  private queue: QueueItem[] = [];
  private processing = false;
  private aborted = false;
  private activeAbort: (() => void) | null = null;
  private repoReady = false;

  constructor(private config: ClaudeSandboxConfig) {
    this.sessionId = config.sessionId ?? null;
    this.sandboxId = config.sandboxId ?? null;
    this.branch = config.branch ?? null;
    this.prUrl = config.prUrl ?? null;
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

  getBranch(): string | null {
    return this.branch;
  }

  getPrUrl(): string | null {
    return this.prUrl;
  }

  setModel(modelId: string): void {
    this.config.model = modelId || "sonnet";
  }

  getModel(): string {
    return this.config.model;
  }

  /**
   * Persist E2B sandbox id in `sdk_agent_id` so reconnects work across
   * server restarts and follow-up turns.
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
    this.repoReady = false;
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

  private token(): string | undefined {
    return githubTokenFromEnv(this.config.githubToken);
  }

  private async ensureSandbox(): Promise<Sandbox> {
    if (this.sandbox && this.repoReady) {
      await this.refreshTimeout();
      return this.sandbox;
    }

    const e2bKey = requireEnv("E2B_API_KEY", this.config.e2bApiKey);
    const anthropicKey = requireEnv("ANTHROPIC_API_KEY", this.config.apiKey);

    if (this.sandboxId) {
      try {
        this.sandbox = await Sandbox.connect(this.sandboxId, {
          apiKey: e2bKey,
        });
        // Ensure Anthropic key is present for resumed sandboxes
        await this.sandbox.commands
          .run(
            `export ANTHROPIC_API_KEY=${shellQuote(anthropicKey)}`,
            { timeoutMs: 5_000 },
          )
          .catch(() => undefined);
        const check = await this.sandbox.commands.run(
          `test -d ${REPO_DIR}/.git && echo OK`,
          { timeoutMs: 10_000 },
        );
        if (check.stdout?.includes("OK")) {
          this.repoReady = true;
          await this.refreshTimeout();
          if (this.branch) {
            await this.sandbox.commands
              .run(`git checkout ${shellQuote(this.branch)}`, {
                cwd: REPO_DIR,
                timeoutMs: 30_000,
              })
              .catch(() => undefined);
          }
          return this.sandbox;
        }
      } catch {
        this.sandboxId = null;
        this.sandbox = null;
        this.repoReady = false;
      }
    }

    this.sandbox = await Sandbox.create("claude", {
      apiKey: e2bKey,
      envs: {
        ANTHROPIC_API_KEY: anthropicKey,
        ...(this.token() ? { GITHUB_TOKEN: this.token()! } : {}),
      },
      timeoutMs: SANDBOX_IDLE_MS,
    });
    this.sandboxId = this.sandbox.sandboxId;
    await this.cloneAndPrepareRepo(this.sandbox);
    this.repoReady = true;
    return this.sandbox;
  }

  private async refreshTimeout(): Promise<void> {
    if (!this.sandboxId) return;
    try {
      await Sandbox.setTimeout(this.sandboxId, SANDBOX_IDLE_MS, {
        apiKey: requireEnv("E2B_API_KEY", this.config.e2bApiKey),
      });
    } catch {
      // non-fatal
    }
  }

  private async cloneAndPrepareRepo(sbx: Sandbox): Promise<void> {
    const repoUrl = this.config.repoUrl.trim();
    if (!repoUrl) throw new Error("Cloud Claude Code requires repoUrl");

    const parsed = parseGithubRepoUrl(repoUrl);
    if (!parsed) {
      throw new Error("Cloud Claude Code requires an https://github.com/... URL");
    }

    const ref = this.config.startingRef?.trim() || "main";
    const token = this.token();
    const cloneUrl = token
      ? authedGithubHttpsUrl(parsed.httpsUrl, token)
      : parsed.httpsUrl;

    // Always shell-clone so startingRef is honored (E2B git.clone omits branch).
    await sbx.commands.run(`rm -rf ${REPO_DIR}`, { timeoutMs: 30_000 });

    try {
      await sbx.commands.run(
        `git clone --depth 50 --branch ${shellQuote(ref)} ${shellQuote(cloneUrl)} ${REPO_DIR}`,
        { timeoutMs: CLONE_TIMEOUT_MS },
      );
    } catch {
      // Ref may be a commit SHA or missing as a branch name — clone default, then checkout.
      await sbx.commands.run(
        [
          `git clone --depth 50 ${shellQuote(cloneUrl)} ${REPO_DIR}`,
          `cd ${REPO_DIR}`,
          `git checkout ${shellQuote(ref)}`,
        ].join(" && "),
        { timeoutMs: CLONE_TIMEOUT_MS },
      );
    }

    // Dedicated working branch (stable across turns when persisted).
    if (!this.branch) {
      this.branch = `steer/claude-${slugifyBranchPart(this.config.name)}-${nanoid(6)}`;
    }

    await sbx.commands.run(
      [
        `git config user.email "steer-bot@users.noreply.github.com"`,
        `git config user.name "Steer Claude Agent"`,
        // Rewrite remote to authenticated URL when we have a token (for push).
        token
          ? `git remote set-url origin ${shellQuote(cloneUrl)}`
          : `true`,
        `git checkout -B ${shellQuote(this.branch)}`,
      ].join(" && "),
      { cwd: REPO_DIR, timeoutMs: 60_000 },
    );
  }

  private async sandboxGitDiff(
    sbx: Sandbox,
    filePath: string,
  ): Promise<string> {
    const rel = filePath.replace(/^\.\//, "").replace(/^\/+/, "");
    if (!rel || rel.includes("..")) return "";
    try {
      const tracked = await sbx.commands.run(
        `git ls-files --error-unmatch -- ${shellQuote(rel)} >/dev/null 2>&1 && echo TRACKED || echo NEW`,
        { cwd: REPO_DIR, timeoutMs: 15_000 },
      );
      const isNew = tracked.stdout?.includes("NEW");
      const result = isNew
        ? await sbx.commands.run(
            `git diff --no-index -- /dev/null ${shellQuote(rel)} || true`,
            { cwd: REPO_DIR, timeoutMs: 30_000 },
          )
        : await sbx.commands.run(`git diff -- ${shellQuote(rel)} || true`, {
            cwd: REPO_DIR,
            timeoutMs: 30_000,
          });
      return (result.stdout || "").trim();
    } catch {
      return "";
    }
  }

  private async finalizeGit(sbx: Sandbox): Promise<RunGitInfo | undefined> {
    const parsed = parseGithubRepoUrl(this.config.repoUrl);
    if (!parsed || !this.branch) return undefined;

    const status = await sbx.commands.run(
      `git status --porcelain`,
      { cwd: REPO_DIR, timeoutMs: 30_000 },
    );
    const dirty = Boolean(status.stdout?.trim());

    const token = this.token();
    if (!token) {
      // Still report the working branch even if we cannot push.
      return {
        branches: [
          {
            repoUrl: parsed.httpsUrl,
            branch: this.branch,
            prUrl: this.prUrl || undefined,
          },
        ],
      };
    }

    if (dirty) {
      const msg = `steer: ${this.config.name.slice(0, 60)}`.replace(
        /"/g,
        "'",
      );
      await sbx.commands.run(
        [
          `git add -A`,
          `git diff --cached --quiet || git commit -m ${shellQuote(msg)}`,
        ].join(" && "),
        { cwd: REPO_DIR, timeoutMs: 60_000 },
      );
    }

    // Push even if this turn was clean (branch may exist from prior turn).
    try {
      await sbx.commands.run(
        `git push -u origin ${shellQuote(this.branch)}`,
        { cwd: REPO_DIR, timeoutMs: 120_000 },
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(
        `Failed to push branch ${this.branch}: ${message}. Ensure GITHUB_TOKEN has repo write access.`,
      );
    }

    const base = this.config.startingRef?.trim() || "main";
    let prUrl = this.prUrl || undefined;

    if (this.config.autoCreatePR && !prUrl) {
      try {
        const pr = await createPullRequest({
          owner: parsed.owner,
          repo: parsed.repo,
          title: `[Steer] ${this.config.name}`.slice(0, 100),
          body: [
            `Automated pull request from a Steer Claude Code cloud agent.`,
            ``,
            `- Agent: \`${this.config.name}\``,
            `- Branch: \`${this.branch}\``,
            `- Base: \`${base}\``,
          ].join("\n"),
          head: this.branch,
          base,
          token,
        });
        prUrl = pr.url;
        this.prUrl = prUrl;
      } catch (err) {
        console.warn(
          `[ClaudeSandbox] PR create failed:`,
          err instanceof Error ? err.message : err,
        );
      }
    }

    return {
      branches: [
        {
          repoUrl: parsed.httpsUrl,
          branch: this.branch,
          prUrl,
        },
      ],
    };
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

    if (this.sandboxId) {
      try {
        this.config.onReady?.({
          sandboxId: this.sandboxId,
          branch: this.branch,
        });
      } catch {
        // persistence hooks must not abort the run
      }
    }

    // Keep Anthropic key in the process environment for the run.
    const anthropicKey = requireEnv("ANTHROPIC_API_KEY", this.config.apiKey);
    const cmd = [
      `ANTHROPIC_API_KEY=${shellQuote(anthropicKey)}`,
      backend.command,
      ...args.map(shellQuote),
    ].join(" ");

    const ctx = {
      assistantBuf: { value: "" },
      gotTerminalEvent: { value: false },
      stderr: "",
    };

    let lineBuf = "";
    let killed = false;
    let pendingDone: Extract<NormalizedAgentEvent, { kind: "done" }> | null =
      null;
    let sawError = false;

    this.activeAbort = () => {
      killed = true;
      void sbx.commands
        .run("pkill -f '[c]laude' || true", { timeoutMs: 5_000 })
        .catch(() => undefined);
    };

    const emit = async (event: NormalizedAgentEvent) => {
      if (event.kind === "session") {
        this.sessionId = event.sessionId;
        item.onEvent(event);
        return;
      }
      if (event.kind === "done") {
        pendingDone = event;
        return;
      }
      if (event.kind === "error") {
        sawError = true;
        item.onEvent(event);
        return;
      }
      if (
        event.kind === "tool_done" &&
        event.path &&
        event.name &&
        isEditTool(event.name) &&
        !event.diffPatch
      ) {
        const patch = await this.sandboxGitDiff(sbx, event.path);
        item.onEvent(patch ? { ...event, diffPatch: patch } : event);
        return;
      }
      item.onEvent(event);
    };

    const flushLine = async (line: string) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      let ev: unknown;
      try {
        ev = JSON.parse(trimmed);
      } catch {
        return;
      }
      for (const event of backend.parseLine(ev, ctx)) {
        await emit(event);
      }
    };

    try {
      let result: { exitCode: number; stderr?: string };
      let stdoutChain: Promise<void> = Promise.resolve();
      try {
        result = await sbx.commands.run(cmd, {
          cwd: REPO_DIR,
          timeoutMs: RUN_TIMEOUT_MS,
          onStdout: (data: string) => {
            if (this.aborted || killed) return;
            stdoutChain = stdoutChain.then(async () => {
              lineBuf += data;
              const lines = lineBuf.split("\n");
              lineBuf = lines.pop() || "";
              for (const line of lines) {
                await flushLine(line);
              }
            });
          },
          onStderr: (data: string) => {
            ctx.stderr += data;
          },
        });
      } catch (err) {
        const e = err as {
          exitCode?: number;
          stderr?: string;
          message?: string;
        };
        if (typeof e.exitCode === "number") {
          result = { exitCode: e.exitCode, stderr: e.stderr };
        } else {
          throw err;
        }
      }

      await stdoutChain.catch(() => undefined);
      if (lineBuf.trim()) await flushLine(lineBuf);

      if (this.aborted || killed) {
        item.onEvent({ kind: "error", message: "Aborted" });
        return;
      }

      if (!ctx.gotTerminalEvent.value && !pendingDone) {
        if (result.exitCode !== 0) {
          const msg =
            ctx.stderr.trim() ||
            result.stderr?.trim() ||
            `Claude Code exited with code ${result.exitCode}`;
          item.onEvent({ kind: "error", message: msg });
          sawError = true;
        } else {
          pendingDone = {
            kind: "done",
            result: ctx.assistantBuf.value || "",
          };
        }
      }

      let git: RunGitInfo | undefined;
      if (!sawError && !this.aborted) {
        try {
          git = await this.finalizeGit(sbx);
        } catch (err) {
          const message =
            err instanceof Error ? err.message : String(err);
          // Surface push failures without discarding the assistant result.
          item.onEvent({ kind: "error", message });
        }
      }

      if (pendingDone) {
        item.onEvent({
          kind: "done",
          result: pendingDone.result,
          git,
        });
      }

      await this.refreshTimeout();
    } catch (err) {
      if (this.aborted || killed) {
        item.onEvent({ kind: "error", message: "Aborted" });
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      if (!ctx.gotTerminalEvent.value && !pendingDone) {
        item.onEvent({ kind: "error", message });
      }
      throw err instanceof Error ? err : new Error(message);
    }
  }
}

/** E2B sandbox host is server-configured; Anthropic key is BYOK / server fallback. */
export function isClaudeSandboxConfigured(): boolean {
  return Boolean(process.env.E2B_API_KEY?.trim());
}
