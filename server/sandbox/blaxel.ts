import { SandboxInstance } from "@blaxel/core";
import { nanoid } from "nanoid";

const DEFAULT_IMAGE = "blaxel/base-image:latest";
const DEFAULT_MEMORY_MB = 4096;
const DEFAULT_TTL = "1h";
const SANDBOX_NAME_MAX = 63;

export const BLAXEL_REPO_DIR = "/home/user/repo";
export const BLAXEL_HOME = "/home/user";

export interface BlaxelExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface BlaxelExecOptions {
  command: string;
  workingDir?: string;
  env?: Record<string, string>;
  timeoutMs: number;
  name?: string;
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
  signal?: AbortSignal;
}

export function isBlaxelConfigured(): boolean {
  return Boolean(
    process.env.BL_API_KEY?.trim() && process.env.BL_WORKSPACE?.trim(),
  );
}

export function assertBlaxelConfigured(): void {
  if (!isBlaxelConfigured()) {
    throw new Error(
      "Claude Code and Codex cloud sessions require BL_API_KEY and BL_WORKSPACE on the server",
    );
  }
}

export function blaxelImage(): string {
  return process.env.BLAXEL_SANDBOX_IMAGE?.trim() || DEFAULT_IMAGE;
}

export function blaxelMemoryMb(): number {
  const raw = Number(process.env.BLAXEL_SANDBOX_MEMORY);
  return Number.isFinite(raw) && raw >= 512 ? Math.floor(raw) : DEFAULT_MEMORY_MB;
}

export function blaxelTtl(): string {
  return process.env.BLAXEL_SANDBOX_TTL?.trim() || DEFAULT_TTL;
}

export function blaxelRegion(): string | undefined {
  const region = process.env.BLAXEL_REGION?.trim();
  return region || undefined;
}

/** DNS-1123 sandbox name, stable per room+agent. */
export function sandboxNameFor(roomId: string, agentId: string): string {
  const raw = `s-${roomId}-${agentId}`
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  const sliced = raw.slice(0, SANDBOX_NAME_MAX).replace(/-+$/g, "");
  return isValidBlaxelName(sliced) ? sliced : `s-${nanoid(10).toLowerCase()}`;
}

export function isValidBlaxelName(name: string): boolean {
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(name);
}

export function sandboxExternalId(roomId: string, agentId: string): string {
  return `steer:${roomId}:${agentId}`.slice(0, 128);
}

function processName(prefix: string): string {
  return `${prefix}-${nanoid(6).toLowerCase()}`.replace(/[^a-z0-9-]/g, "-");
}

function toEnvList(env: Record<string, string>): Array<{ name: string; value: string }> {
  return Object.entries(env)
    .filter(([, value]) => Boolean(value))
    .map(([name, value]) => ({ name, value }));
}

/**
 * Create or reconnect a named Blaxel sandbox.
 * Persisted `sdk_agent_id` is the sandbox name so follow-up turns resume
 * the same filesystem after a server restart.
 */
export async function createOrReconnectSandbox(opts: {
  name: string;
  env?: Record<string, string>;
  labels?: Record<string, string>;
  externalId?: string;
}): Promise<SandboxInstance> {
  assertBlaxelConfigured();
  const name = isValidBlaxelName(opts.name)
    ? opts.name
    : sandboxNameFor(opts.name, nanoid(6));

  const create = () =>
    SandboxInstance.createIfNotExists({
      name,
      image: blaxelImage(),
      memory: blaxelMemoryMb(),
      ttl: blaxelTtl(),
      region: blaxelRegion(),
      envs: opts.env ? toEnvList(opts.env) : undefined,
      labels: {
        app: "steer",
        ...(opts.labels ?? {}),
      },
      externalId: opts.externalId,
    });

  try {
    const existing = await SandboxInstance.get(name);
    const status = String(existing.status ?? "").toUpperCase();
    if (status === "ARCHIVED" || status === "UNARCHIVING") {
      await existing.unarchive().catch(() => undefined);
    }
    if (status === "FAILED" || status === "DELETED" || status === "TERMINATED") {
      await SandboxInstance.delete(name).catch(() => undefined);
      return create();
    }
    return existing;
  } catch {
    return create();
  }
}

export async function refreshSandboxTtl(name: string): Promise<void> {
  if (!name || !isBlaxelConfigured()) return;
  try {
    await SandboxInstance.updateTtl(name, blaxelTtl());
  } catch {
    // non-fatal — idle expiry is a backstop, not the run timeout
  }
}

export async function deleteSandbox(name: string): Promise<void> {
  if (!name) return;
  try {
    await SandboxInstance.delete(name);
  } catch {
    // already gone
  }
}

/**
 * Run a command inside a sandbox.
 *
 * Blaxel `waitForCompletion` is capped at ~60s, which is too short for
 * clone / CLI agent turns. We start the process with keepAlive, stream
 * logs, then wait up to timeoutMs.
 */
export async function execInSandbox(
  sandbox: SandboxInstance,
  opts: BlaxelExecOptions,
): Promise<BlaxelExecResult> {
  const name = opts.name || processName("steer");
  const timeoutSec = Math.max(1, Math.ceil(opts.timeoutMs / 1000));
  let stdout = "";
  let stderr = "";
  let stream: { close: () => void } | null = null;

  if (opts.signal?.aborted) {
    throw new Error("Aborted");
  }

  await sandbox.process.exec({
    name,
    command: opts.command,
    workingDir: opts.workingDir,
    env: opts.env,
    keepAlive: true,
    timeout: timeoutSec,
    waitForCompletion: false,
  });

  stream = sandbox.process.streamLogs(name, {
    onStdout: (chunk) => {
      stdout += chunk;
      opts.onStdout?.(chunk);
    },
    onStderr: (chunk) => {
      stderr += chunk;
      opts.onStderr?.(chunk);
    },
  });

  const abort = () => {
    void sandbox.process.kill(name).catch(() => undefined);
  };
  if (opts.signal) {
    if (opts.signal.aborted) abort();
    else opts.signal.addEventListener("abort", abort, { once: true });
  }

  try {
    const result = await sandbox.process.wait(name, {
      maxWait: opts.timeoutMs,
      signal: opts.signal,
    });
    const exitCode =
      typeof result.exitCode === "number"
        ? result.exitCode
        : result.status === "completed"
          ? 0
          : 1;
    return {
      exitCode,
      stdout: (result.stdout || stdout).trimEnd(),
      stderr: (result.stderr || stderr).trimEnd(),
    };
  } catch (err) {
    if (opts.signal?.aborted) throw new Error("Aborted");
    throw err instanceof Error ? err : new Error(String(err));
  } finally {
    try {
      stream?.close();
    } catch {
      // ignore
    }
    if (opts.signal) {
      opts.signal.removeEventListener("abort", abort);
    }
  }
}

export async function killSandboxProcess(
  sandbox: SandboxInstance,
  name: string,
): Promise<void> {
  try {
    await sandbox.process.kill(name);
  } catch {
    try {
      await sandbox.process.stop(name);
    } catch {
      // ignore
    }
  }
}

export function shellQuote(s: string): string {
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(s)) return s;
  return `'${s.replace(/'/g, `'\\''`)}'`;
}
