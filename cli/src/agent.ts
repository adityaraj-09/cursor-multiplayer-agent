import { spawn, type ChildProcess } from "child_process";
import { createInterface } from "readline";
import { existsSync, promises as fsPromises } from "fs";
import { resolve, relative, isAbsolute } from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import {
  getBackend,
  isEditTool,
  type AgentBackendKind,
  type NormalizedAgentEvent,
} from "../../shared/backends/index.js";

const execFileAsync = promisify(execFile);

export type AgentStreamEvent = NormalizedAgentEvent;
export { isEditTool };

// ── Concurrent child registry ────────────────────────────────────────

const activeChildren = new Map<string, ChildProcess>();

export function abortRun(runKey: string): void {
  const child = activeChildren.get(runKey);
  if (child) {
    child.kill("SIGTERM");
    activeChildren.delete(runKey);
  }
}

export function abortAll(): void {
  for (const [key, child] of activeChildren) {
    child.kill("SIGTERM");
    activeChildren.delete(key);
  }
}

/** @deprecated Use abortRun(runKey) or abortAll(). */
export function abortAgent(runKey?: string): void {
  if (runKey) abortRun(runKey);
  else abortAll();
}

export interface RunHandle {
  runKey: string;
  abort: () => void;
  promise: Promise<void>;
}

export function runAgent(
  repoPath: string,
  prompt: string,
  modelId: string,
  onEvent: (event: AgentStreamEvent) => void,
  sessionId?: string | null,
  runKey = `run_${Date.now()}`,
  backendKind: AgentBackendKind = "cursor",
  mode: "agent" | "plan" = "agent",
): Promise<void> {
  return runAgentWithHandle(
    repoPath,
    prompt,
    modelId,
    onEvent,
    sessionId,
    runKey,
    backendKind,
    mode,
  ).promise;
}

export function runAgentWithHandle(
  repoPath: string,
  prompt: string,
  modelId: string,
  onEvent: (event: AgentStreamEvent) => void,
  sessionId?: string | null,
  runKey = `run_${Date.now()}`,
  backendKind: AgentBackendKind = "cursor",
  mode: "agent" | "plan" = "agent",
): RunHandle {
  const kind: AgentBackendKind =
    backendKind === "claude-code" ? "claude-code" : "cursor";
  const backend = getBackend(kind);

  const promise = new Promise<void>((resolvePromise, reject) => {
    const args = backend.buildArgs({
      prompt,
      modelId,
      sessionId,
      mode,
    });

    const child = spawn(backend.command, args, {
      cwd: repoPath,
      env: process.env as NodeJS.ProcessEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });
    activeChildren.set(runKey, child);

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
      if (activeChildren.get(runKey) === child) {
        activeChildren.delete(runKey);
      }
      if (err) reject(err);
      else resolvePromise();
    };

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
      ctx.stderr = stderr;
    });

    const rl = createInterface({ input: child.stdout });
    rl.on("line", (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      let ev: unknown;
      try {
        ev = JSON.parse(trimmed);
      } catch {
        return;
      }
      for (const event of backend.parseLine(ev, ctx)) {
        onEvent(event);
      }
    });

    child.on("error", (err) => {
      const message =
        (err as NodeJS.ErrnoException).code === "ENOENT"
          ? `${backend.command} CLI not found — install it and ensure it is on PATH`
          : err.message;
      if (!ctx.gotTerminalEvent.value) {
        onEvent({ kind: "error", message });
      }
      finish(new Error(message));
    });

    child.on("close", (code) => {
      if (settled) return;
      if (code === 0) {
        if (!ctx.gotTerminalEvent.value && ctx.assistantBuf.value) {
          onEvent({ kind: "done", result: ctx.assistantBuf.value });
        }
        finish();
      } else {
        const msg =
          stderr.trim() || `Agent exited with code ${code ?? "unknown"}`;
        if (!ctx.gotTerminalEvent.value) {
          onEvent({ kind: "error", message: msg });
        }
        finish(new Error(msg));
      }
    });
  });

  return {
    runKey,
    abort: () => abortRun(runKey),
    promise,
  };
}

// ── File diff ────────────────────────────────────────────────────────

function resolveInRepo(repoPath: string, filePath: string): string | null {
  const abs = isAbsolute(filePath) ? filePath : resolve(repoPath, filePath);
  const rel = relative(repoPath, abs);
  if (rel.startsWith("..") || rel === "") return null;
  return rel.replace(/\\/g, "/");
}

async function runGit(repoPath: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", args, {
      cwd: repoPath,
      maxBuffer: 8 * 1024 * 1024,
      encoding: "utf8",
    });
    return stdout;
  } catch (err) {
    const e = err as { stdout?: string };
    return e.stdout || "";
  }
}

async function isTracked(repoPath: string, rel: string): Promise<boolean> {
  try {
    await execFileAsync("git", ["ls-files", "--error-unmatch", "--", rel], {
      cwd: repoPath,
      encoding: "utf8",
    });
    return true;
  } catch {
    return false;
  }
}

export async function getFileDiff(
  repoPath: string,
  filePath: string,
): Promise<string> {
  const rel = resolveInRepo(repoPath, filePath);
  if (!rel) return "";

  const abs = resolve(repoPath, rel);

  let patch = await runGit(repoPath, ["diff", "HEAD", "--", rel]);
  if (!patch) patch = await runGit(repoPath, ["diff", "--", rel]);
  if (!patch) patch = await runGit(repoPath, ["diff", "--cached", "--", rel]);

  if (!patch && existsSync(abs) && !(await isTracked(repoPath, rel))) {
    patch = await runGit(repoPath, [
      "diff",
      "--no-index",
      "--",
      "/dev/null",
      rel,
    ]);
  }

  return patch.trim();
}

export async function revertFiles(
  repoPath: string,
  filePaths: string[],
): Promise<{ reverted: string[]; errors: string[] }> {
  const reverted: string[] = [];
  const errors: string[] = [];

  for (const rawPath of filePaths) {
    if (!rawPath || !rawPath.trim()) continue;
    const rel = resolveInRepo(repoPath, rawPath.trim());
    if (!rel) continue;

    const abs = resolve(repoPath, rel);

    try {
      const tracked = await isTracked(repoPath, rel);
      if (tracked) {
        await runGit(repoPath, ["reset", "HEAD", "--", rel]);
        await runGit(repoPath, ["checkout", "HEAD", "--", rel]);
        reverted.push(rel);
      } else if (existsSync(abs)) {
        await fsPromises.rm(abs, { force: true, recursive: true });
        reverted.push(rel);
      } else {
        reverted.push(rel);
      }
    } catch (err) {
      errors.push(
        `Failed to revert ${rel}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return { reverted, errors };
}

