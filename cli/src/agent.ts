import { spawn, type ChildProcess } from "child_process";
import { createInterface } from "readline";
import { existsSync } from "fs";
import { resolve, relative, isAbsolute } from "path";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

// ── Stream event types ──────────────────────────────────────────────

export type AgentStreamEvent =
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
  | { kind: "done"; result: string };

// ── Helpers (from server/agentRunner.ts) ─────────────────────────────

function extractText(message: unknown): string {
  if (!message || typeof message !== "object") return "";
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (part && typeof part === "object" && "text" in part) {
        return String((part as { text: unknown }).text ?? "");
      }
      return "";
    })
    .join("");
}

function toolInfo(toolCall: Record<string, unknown> | undefined): {
  name: string;
  detail: string;
  path?: string;
} {
  if (!toolCall) return { name: "tool", detail: "" };
  const key = Object.keys(toolCall).find(
    (k) =>
      k.endsWith("ToolCall") ||
      (!["hookAdditionalContexts", "toolCallId", "startedAtMs", "completedAtMs"].includes(k) &&
        typeof toolCall[k] === "object"),
  );
  const name = key ? key.replace(/ToolCall$/, "") : "tool";
  const body = key ? (toolCall[key] as Record<string, unknown>) : undefined;
  const args =
    body?.args && typeof body.args === "object"
      ? (body.args as Record<string, unknown>)
      : undefined;
  let detail = "";
  let path: string | undefined;
  if (args) {
    for (const k of ["path", "filePath", "file_path", "target_file", "targetFile"]) {
      if (typeof args[k] === "string" && String(args[k]).trim()) {
        path = String(args[k]).trim();
        break;
      }
    }
    detail =
      String(args.command ?? args.globPattern ?? path ?? args.targetDirectory ?? "") ||
      JSON.stringify(args).slice(0, 120);
  }
  return { name, detail, path };
}

// ── Edit-tool detection (from server/gitDiff.ts) ─────────────────────

const EDIT_TOOL_RE =
  /^(write|edit|strreplace|searchreplace|delete|applypatch|editnotebook|create|updatefile|deletefile|writefile)/i;

export function isEditTool(name: string): boolean {
  return EDIT_TOOL_RE.test(name.replace(/ToolCall$/i, ""));
}

// ── Agent runner ─────────────────────────────────────────────────────

let activeChild: ChildProcess | null = null;

export function abortAgent(): void {
  activeChild?.kill("SIGTERM");
  activeChild = null;
}

export function runAgent(
  repoPath: string,
  prompt: string,
  modelId: string,
  onEvent: (event: AgentStreamEvent) => void,
  sessionId?: string | null,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = [
      "agent",
      "--print",
      "--output-format",
      "stream-json",
      "--stream-partial-output",
      "--force",
      "--trust",
    ];
    if (modelId && modelId !== "auto") {
      args.push("--model", modelId);
    }
    if (sessionId) {
      args.push("--resume", sessionId);
    }
    args.push(prompt);

    const child = spawn("cursor", args, {
      cwd: repoPath,
      env: process.env as NodeJS.ProcessEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });
    activeChild = child;

    let stderr = "";
    let settled = false;
    let assistantBuf = "";
    let gotTerminalEvent = false;

    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      activeChild = null;
      if (err) reject(err);
      else resolve();
    };

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    const rl = createInterface({ input: child.stdout });
    rl.on("line", (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      let ev: Record<string, unknown>;
      try {
        ev = JSON.parse(trimmed) as Record<string, unknown>;
      } catch {
        return;
      }

      const type = ev.type as string;

      if (type === "system" && ev.subtype === "init" && ev.session_id) {
        onEvent({ kind: "session", sessionId: String(ev.session_id) });
        return;
      }

      if (type === "assistant") {
        const text = extractText(ev.message);
        if (!text) return;
        if ("timestamp_ms" in ev) {
          assistantBuf += text;
          onEvent({ kind: "assistant_delta", text: assistantBuf });
        } else {
          assistantBuf = text;
          onEvent({ kind: "assistant_final", text });
        }
        return;
      }

      if (type === "tool_call") {
        const callId = String(ev.call_id ?? "");
        const info = toolInfo(ev.tool_call as Record<string, unknown>);
        if (ev.subtype === "started") {
          onEvent({
            kind: "tool_start",
            callId,
            name: info.name,
            detail: info.detail,
            path: info.path,
          });
        } else if (ev.subtype === "completed") {
          onEvent({
            kind: "tool_done",
            callId,
            name: info.name,
            detail: info.detail,
            path: info.path,
          });
        }
        return;
      }

      if (type === "result") {
        gotTerminalEvent = true;
        if (ev.session_id) {
          onEvent({ kind: "session", sessionId: String(ev.session_id) });
        }
        if (ev.is_error) {
          const msg = String(
            ev.result != null && ev.result !== "" ? ev.result : stderr || "Agent error",
          );
          onEvent({ kind: "error", message: msg });
        } else {
          const result = String(ev.result ?? assistantBuf);
          onEvent({ kind: "done", result });
        }
      }
    });

    child.on("error", (err) => {
      if (!gotTerminalEvent) {
        onEvent({ kind: "error", message: err.message });
      }
      finish(err);
    });

    child.on("close", (code) => {
      if (settled) return;
      if (code === 0) {
        if (!gotTerminalEvent && assistantBuf) {
          onEvent({ kind: "done", result: assistantBuf });
        }
        finish();
      } else {
        const msg = stderr.trim() || `Agent exited with code ${code ?? "unknown"}`;
        if (!gotTerminalEvent) {
          onEvent({ kind: "error", message: msg });
        }
        finish(new Error(msg));
      }
    });
  });
}

// ── File diff (from server/gitDiff.ts) ───────────────────────────────

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

export async function getFileDiff(repoPath: string, filePath: string): Promise<string> {
  const rel = resolveInRepo(repoPath, filePath);
  if (!rel) return "";

  const abs = resolve(repoPath, rel);

  let patch = await runGit(repoPath, ["diff", "HEAD", "--", rel]);
  if (!patch) patch = await runGit(repoPath, ["diff", "--", rel]);
  if (!patch) patch = await runGit(repoPath, ["diff", "--cached", "--", rel]);

  if (!patch && existsSync(abs) && !(await isTracked(repoPath, rel))) {
    patch = await runGit(repoPath, ["diff", "--no-index", "--", "/dev/null", rel]);
  }

  return patch.trim();
}
