import { nanoid } from "nanoid";
import type { SandboxInstance } from "@blaxel/core";
import {
  getBackend,
  isCliSandboxBackend,
  isEditTool,
  type CliSandboxBackendKind,
  type NormalizedAgentEvent,
  type RunGitInfo,
} from "../shared/backends/index.js";
import {
  buildAttributedCommitMessage,
  steeredByLine,
  type SteerAuthor,
} from "../shared/attribution.js";
import {
  authedGithubHttpsUrl,
  createPullRequest,
  githubTokenFromEnv,
  parseGithubRepoUrl,
  slugifyBranchPart,
} from "./githubPr.js";
import {
  BLAXEL_HOME,
  BLAXEL_REPO_DIR,
  createOrReconnectSandbox,
  deleteSandbox,
  execInSandbox,
  isBlaxelConfigured,
  isValidBlaxelName,
  killSandboxProcess,
  refreshSandboxTtl,
  sandboxExternalId,
  sandboxNameFor,
  shellQuote,
} from "./sandbox/blaxel.js";
import { DEFAULT_CLAUDE_MODEL } from "../shared/claudeModels.js";
import { DEFAULT_CODEX_MODEL } from "../shared/codexModels.js";

export type CliSandboxStreamEvent = NormalizedAgentEvent;

const CLONE_TIMEOUT_MS = 180_000;
const RUN_TIMEOUT_MS = 45 * 60 * 1000;
const BOOTSTRAP_TIMEOUT_MS = 180_000;
const GIT_TIMEOUT_MS = 120_000;

const CLI_PACKAGES: Record<CliSandboxBackendKind, string> = {
  "claude-code": "@anthropic-ai/claude-code",
  codex: "@openai/codex",
};

const CLI_BINARIES: Record<CliSandboxBackendKind, string> = {
  "claude-code": "claude",
  codex: "codex",
};

export interface CliSandboxConfig {
  backend: CliSandboxBackendKind;
  /** Provider API key (Anthropic for Claude, OpenAI for Codex). */
  apiKey: string;
  model: string;
  name: string;
  repoUrl: string;
  startingRef?: string;
  githubToken?: string;
  /** Live token lookup so a later Settings → GitHub connect is picked up. */
  resolveGithubToken?: () => string | null | undefined;
  autoCreatePR?: boolean;
  sessionId?: string | null;
  /** Persist Blaxel sandbox name across reconnects (`sdk_agent_id`). */
  sandboxId?: string | null;
  branch?: string | null;
  prUrl?: string | null;
  mode?: "agent" | "plan";
  steeredBy?: { name: string; email: string; userId?: string } | null;
  roomId?: string;
  agentId?: string;
  onReady?: (info: {
    sandboxId: string;
    branch: string | null;
  }) => void;
}

interface QueueItem {
  prompt: string;
  onEvent: (event: CliSandboxStreamEvent) => void;
  resolve: () => void;
  reject: (err: Error) => void;
}

function requireApiKey(config: CliSandboxConfig): string {
  const key = config.apiKey.trim();
  if (!key) {
    throw new Error(
      config.backend === "codex"
        ? "OpenAI API key is not configured"
        : "Anthropic API key is not configured",
    );
  }
  return key;
}

function defaultModel(backend: CliSandboxBackendKind): string {
  return backend === "codex" ? DEFAULT_CODEX_MODEL : DEFAULT_CLAUDE_MODEL;
}

function gitUserName(backend: CliSandboxBackendKind): string {
  return backend === "codex" ? "Steer Codex Agent" : "Steer Claude Agent";
}

function branchPrefix(backend: CliSandboxBackendKind): string {
  return backend === "codex" ? "steer/codex" : "steer/claude";
}

function productLabel(backend: CliSandboxBackendKind): string {
  return backend === "codex" ? "Codex" : "Claude Code";
}

/**
 * Cloud Claude Code / Codex agent running inside a Blaxel sandbox.
 *
 * Lifecycle:
 *  1. Create/reconnect a named sandbox (BL_API_KEY + BL_WORKSPACE)
 *  2. Bootstrap the CLI on Alpine, clone repo, create a working branch
 *  3. Stream `claude` or `codex` with env passed on every exec
 *  4. Enrich edit tools with live `git diff` from the sandbox
 *  5. On success: commit, push, optionally open a PR; emit `done.git`
 */
export class CliSandboxSession {
  private sandbox: SandboxInstance | null = null;
  private sessionId: string | null;
  private sandboxId: string | null;
  private branch: string | null;
  private prUrl: string | null;
  private queue: QueueItem[] = [];
  private processing = false;
  private aborted = false;
  private activeAbort: (() => void) | null = null;
  private repoReady = false;
  private cliReady = false;
  private activeProcessName: string | null = null;

  constructor(private config: CliSandboxConfig) {
    if (!isCliSandboxBackend(config.backend)) {
      throw new Error(`Unsupported CLI sandbox backend: ${config.backend}`);
    }
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
    this.config.model = modelId || defaultModel(this.config.backend);
  }

  getModel(): string {
    return this.config.model;
  }

  setMode(mode: "agent" | "plan"): void {
    this.config.mode = mode === "plan" ? "plan" : "agent";
  }

  getMode(): "agent" | "plan" {
    return this.config.mode === "plan" ? "plan" : "agent";
  }

  setSteeredBy(author: SteerAuthor | null | undefined): void {
    if (!author?.name?.trim()) {
      this.config.steeredBy = null;
      return;
    }
    this.config.steeredBy = {
      name: author.name.trim(),
      email: author.email?.trim() || "",
      userId: author.userId,
    };
  }

  /** Persist Blaxel sandbox name in `sdk_agent_id` for reconnects. */
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
    const name = this.sandboxId;
    this.sandbox = null;
    this.repoReady = false;
    this.cliReady = false;
    if (name) {
      await deleteSandbox(name);
    }
    this.sandboxId = null;
  }

  run(
    prompt: string,
    onEvent: (event: CliSandboxStreamEvent) => void,
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
      this.activeProcessName = null;
      void this.pump();
    }
  }

  private token(): string | undefined {
    const live = this.config.resolveGithubToken?.() ?? this.config.githubToken;
    return githubTokenFromEnv(live);
  }

  private providerEnv(): Record<string, string> {
    const apiKey = requireApiKey(this.config);
    const token = this.token();
    const env: Record<string, string> = {
      HOME: BLAXEL_HOME,
      PATH: "/usr/local/bin:/usr/bin:/bin",
    };
    if (this.config.backend === "codex") {
      env.OPENAI_API_KEY = apiKey;
      env.CODEX_API_KEY = apiKey;
    } else {
      env.ANTHROPIC_API_KEY = apiKey;
    }
    if (token) env.GITHUB_TOKEN = token;
    return env;
  }

  private async sh(
    command: string,
    timeoutMs: number,
    cwd = BLAXEL_REPO_DIR,
  ): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    const sbx = this.sandbox;
    if (!sbx) throw new Error("Sandbox is not ready");
    return execInSandbox(sbx, {
      command,
      workingDir: cwd,
      env: this.providerEnv(),
      timeoutMs,
    });
  }

  private async ensureSandbox(): Promise<SandboxInstance> {
    if (this.sandbox && this.repoReady) {
      if (this.sandboxId) await refreshSandboxTtl(this.sandboxId);
      return this.sandbox;
    }

    const roomId = this.config.roomId?.trim() || "room";
    const agentId = this.config.agentId?.trim() || nanoid(8);
    const preferred =
      this.sandboxId && isValidBlaxelName(this.sandboxId)
        ? this.sandboxId
        : sandboxNameFor(roomId, agentId);

    this.sandbox = await createOrReconnectSandbox({
      name: preferred,
      env: this.providerEnv(),
      labels: {
        backend: this.config.backend,
        room: roomId.slice(0, 63),
        agent: agentId.slice(0, 63),
      },
      externalId: sandboxExternalId(roomId, agentId),
    });
    this.sandboxId =
      this.sandbox.metadata?.name?.trim() || preferred;

    await this.bootstrapCli(this.sandbox);
    await this.ensureRepo(this.sandbox);
    this.repoReady = true;
    if (this.sandboxId) await refreshSandboxTtl(this.sandboxId);
    return this.sandbox;
  }

  private async bootstrapCli(sbx: SandboxInstance): Promise<void> {
    if (this.cliReady) return;
    const bin = CLI_BINARIES[this.config.backend];
    const pkg = CLI_PACKAGES[this.config.backend];
    const marker = `${BLAXEL_HOME}/.steer/cli-${this.config.backend}.ok`;
    const result = await execInSandbox(sbx, {
      command: [
        `mkdir -p ${shellQuote(BLAXEL_HOME)} ${shellQuote(`${BLAXEL_HOME}/.steer`)} ${shellQuote(BLAXEL_REPO_DIR)}`,
        `if [ -f ${shellQuote(marker)} ] && command -v ${bin} >/dev/null 2>&1; then echo READY; exit 0; fi`,
        `command -v ${bin} >/dev/null 2>&1 || npm i -g ${shellQuote(pkg)}`,
        `command -v ${bin} >/dev/null 2>&1 || { echo "failed to install ${bin}" >&2; exit 1; }`,
        `touch ${shellQuote(marker)}`,
        `echo READY`,
      ].join(" && "),
      workingDir: BLAXEL_HOME,
      env: this.providerEnv(),
      timeoutMs: BOOTSTRAP_TIMEOUT_MS,
    });
    if (result.exitCode !== 0 || !result.stdout.includes("READY")) {
      throw new Error(
        `Failed to install ${productLabel(this.config.backend)} in the sandbox: ${
          result.stderr || result.stdout || `exit ${result.exitCode}`
        }`,
      );
    }
    this.cliReady = true;
  }

  private async ensureRepo(sbx: SandboxInstance): Promise<void> {
    const check = await execInSandbox(sbx, {
      command: `test -d ${shellQuote(`${BLAXEL_REPO_DIR}/.git`)} && echo OK || echo MISSING`,
      workingDir: BLAXEL_HOME,
      env: this.providerEnv(),
      timeoutMs: 15_000,
    });
    if (check.stdout.includes("OK")) {
      if (this.branch) {
        await this.sh(
          `git checkout ${shellQuote(this.branch)} || git checkout -B ${shellQuote(this.branch)}`,
          30_000,
        ).catch(() => undefined);
      }
      return;
    }
    await this.cloneAndPrepareRepo();
  }

  private async cloneAndPrepareRepo(): Promise<void> {
    const repoUrl = this.config.repoUrl.trim();
    if (!repoUrl) {
      throw new Error(
        `Cloud ${productLabel(this.config.backend)} requires repoUrl`,
      );
    }

    const parsed = parseGithubRepoUrl(repoUrl);
    if (!parsed) {
      throw new Error(
        `Cloud ${productLabel(this.config.backend)} requires an https://github.com/... URL`,
      );
    }

    const ref = this.config.startingRef?.trim() || "main";
    const token = this.token();
    const cloneUrl = token
      ? authedGithubHttpsUrl(parsed.httpsUrl, token)
      : parsed.httpsUrl;

    await this.sh(`rm -rf ${shellQuote(BLAXEL_REPO_DIR)}`, 30_000, BLAXEL_HOME);
    await this.sh(
      `mkdir -p ${shellQuote(BLAXEL_HOME)}`,
      10_000,
      BLAXEL_HOME,
    );

    const shallow = await this.sh(
      `git clone --depth 50 --branch ${shellQuote(ref)} ${shellQuote(cloneUrl)} ${shellQuote(BLAXEL_REPO_DIR)}`,
      CLONE_TIMEOUT_MS,
      BLAXEL_HOME,
    );
    if (shallow.exitCode !== 0) {
      const fallback = await this.sh(
        [
          `git clone --depth 50 ${shellQuote(cloneUrl)} ${shellQuote(BLAXEL_REPO_DIR)}`,
          `cd ${shellQuote(BLAXEL_REPO_DIR)}`,
          `git checkout ${shellQuote(ref)}`,
        ].join(" && "),
        CLONE_TIMEOUT_MS,
        BLAXEL_HOME,
      );
      if (fallback.exitCode !== 0) {
        throw new Error(
          `Failed to clone ${parsed.httpsUrl}: ${fallback.stderr || fallback.stdout}`,
        );
      }
    }

    if (!this.branch) {
      this.branch = `${branchPrefix(this.config.backend)}-${slugifyBranchPart(this.config.name)}-${nanoid(6)}`;
    }

    const prep = await this.sh(
      [
        `git config user.email "steer-bot@users.noreply.github.com"`,
        `git config user.name ${shellQuote(gitUserName(this.config.backend))}`,
        token ? `git remote set-url origin ${shellQuote(cloneUrl)}` : `true`,
        `git checkout -B ${shellQuote(this.branch)}`,
      ].join(" && "),
      60_000,
    );
    if (prep.exitCode !== 0) {
      throw new Error(
        `Failed to prepare working branch: ${prep.stderr || prep.stdout}`,
      );
    }
  }

  private async sandboxGitDiff(filePath: string): Promise<string> {
    const rel = filePath.replace(/^\.\//, "").replace(/^\/+/, "");
    if (!rel || rel.includes("..")) return "";
    try {
      const tracked = await this.sh(
        `git ls-files --error-unmatch -- ${shellQuote(rel)} >/dev/null 2>&1 && echo TRACKED || echo NEW`,
        15_000,
      );
      const isNew = tracked.stdout.includes("NEW");
      const result = isNew
        ? await this.sh(
            `git diff --no-index -- /dev/null ${shellQuote(rel)} || true`,
            30_000,
          )
        : await this.sh(`git diff -- ${shellQuote(rel)} || true`, 30_000);
      return (result.stdout || "").trim();
    } catch {
      return "";
    }
  }

  private async ensureAssignedBranch(): Promise<void> {
    if (!this.branch) return;
    const current = await this.sh(`git rev-parse --abbrev-ref HEAD`, 15_000);
    const head = current.stdout.trim();
    if (!head || head === this.branch || head === "HEAD") return;
    await this.sh(
      [
        `git checkout ${shellQuote(this.branch)} || git checkout -B ${shellQuote(this.branch)}`,
        `git merge --no-edit ${shellQuote(head)} || true`,
      ].join(" && "),
      60_000,
    );
  }

  private async finalizeGit(): Promise<RunGitInfo | undefined> {
    const parsed = parseGithubRepoUrl(this.config.repoUrl);
    if (!parsed || !this.branch) return undefined;
    const base = this.config.startingRef?.trim() || "main";
    if (this.branch === base || this.branch === "main" || this.branch === "master") {
      throw new Error(
        `Refusing to push base branch ${this.branch}. Feature agents must stay on their assigned branch.`,
      );
    }
    await this.ensureAssignedBranch();

    const status = await this.sh(`git status --porcelain`, 30_000);
    const dirty = Boolean(status.stdout.trim());
    const token = this.token();
    if (!token) {
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
      const msg = buildAttributedCommitMessage(
        `steer: ${this.config.name.slice(0, 60)}`,
        this.config.steeredBy,
      );
      const msgPath = `/tmp/steer-commit-${nanoid(8)}.txt`;
      const b64 = Buffer.from(msg, "utf8").toString("base64");
      const commit = await this.sh(
        [
          `printf '%s' ${shellQuote(b64)} | base64 -d > ${shellQuote(msgPath)}`,
          `git add -A`,
          `git diff --cached --quiet || git commit -F ${shellQuote(msgPath)}`,
          `rm -f ${shellQuote(msgPath)}`,
        ].join(" && "),
        60_000,
      );
      if (commit.exitCode !== 0) {
        throw new Error(
          `Failed to commit: ${commit.stderr || commit.stdout}`,
        );
      }
    }

    const push = await this.sh(
      `git push -u origin ${shellQuote(this.branch)}`,
      GIT_TIMEOUT_MS,
    );
    if (push.exitCode !== 0) {
      throw new Error(
        `Failed to push branch ${this.branch}: ${push.stderr || push.stdout}. Connect GitHub in Settings (or set GITHUB_TOKEN) with repo write access.`,
      );
    }

    let prUrl = this.prUrl || undefined;
    if (this.config.autoCreatePR && !prUrl) {
      try {
        const pr = await createPullRequest({
          owner: parsed.owner,
          repo: parsed.repo,
          title: `[Steer] ${this.config.name}`.slice(0, 100),
          body: [
            `Automated pull request from a Steer ${productLabel(this.config.backend)} cloud agent.`,
            ``,
            `- Agent: \`${this.config.name}\``,
            `- Backend: \`${this.config.backend}\``,
            `- Branch: \`${this.branch}\``,
            `- Base: \`${base}\``,
            steeredByLine(this.config.steeredBy)
              ? `- ${steeredByLine(this.config.steeredBy)}`
              : "",
          ]
            .filter(Boolean)
            .join("\n"),
          head: this.branch,
          base,
          token,
        });
        prUrl = pr.url;
        this.prUrl = prUrl;
      } catch (err) {
        console.warn(
          `[CliSandbox] PR create failed:`,
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
    const backend = getBackend(this.config.backend);
    const args = backend.buildArgs({
      prompt: item.prompt,
      modelId: this.config.model,
      sessionId: this.sessionId,
      mode: this.config.mode === "plan" ? "plan" : "agent",
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

    const cmd = [backend.command, ...args.map(shellQuote)].join(" ");
    const processName = `cli-${nanoid(6).toLowerCase()}`;
    this.activeProcessName = processName;

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
    const controller = new AbortController();

    this.activeAbort = () => {
      killed = true;
      controller.abort();
      if (this.activeProcessName) {
        void killSandboxProcess(sbx, this.activeProcessName);
      }
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
        const patch = await this.sandboxGitDiff(event.path);
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

    let stdoutChain: Promise<void> = Promise.resolve();
    const onStdout = (data: string) => {
      if (this.aborted || killed) return;
      stdoutChain = stdoutChain.then(async () => {
        lineBuf += data;
        const lines = lineBuf.split("\n");
        lineBuf = lines.pop() || "";
        for (const line of lines) {
          await flushLine(line);
        }
      });
    };

    try {
      let result: { exitCode: number; stderr?: string };
      try {
        result = await execInSandbox(sbx, {
          name: processName,
          command: cmd,
          workingDir: BLAXEL_REPO_DIR,
          env: this.providerEnv(),
          timeoutMs: RUN_TIMEOUT_MS,
          onStdout,
          onStderr: (data) => {
            ctx.stderr += data;
          },
          signal: controller.signal,
        });
      } catch (err) {
        if (this.aborted || killed || controller.signal.aborted) {
          item.onEvent({ kind: "error", message: "Aborted" });
          return;
        }
        throw err;
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
            `${productLabel(this.config.backend)} exited with code ${result.exitCode}`;
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
          git = await this.finalizeGit();
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
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

      if (this.sandboxId) await refreshSandboxTtl(this.sandboxId);
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

/** @deprecated Use CliSandboxSession — kept so existing imports keep compiling. */
export class ClaudeSandboxSession extends CliSandboxSession {
  constructor(
    config: Omit<CliSandboxConfig, "backend"> & { backend?: CliSandboxBackendKind },
  ) {
    super({ ...config, backend: config.backend ?? "claude-code" });
  }
}

export function isCliSandboxConfigured(): boolean {
  return isBlaxelConfigured();
}

/** @deprecated Use isCliSandboxConfigured. */
export function isClaudeSandboxConfigured(): boolean {
  return isBlaxelConfigured();
}
