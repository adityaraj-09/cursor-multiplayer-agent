import { existsSync } from "fs";
import { resolve, relative, isAbsolute } from "path";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

const EDIT_TOOL_RE =
  /^(write|edit|strreplace|searchreplace|delete|applypatch|editnotebook|create|updatefile|deletefile|writefile)/i;

export function isEditTool(name: string): boolean {
  return EDIT_TOOL_RE.test(name.replace(/ToolCall$/i, ""));
}

export function extractToolPath(
  detail: string,
  args?: Record<string, unknown> | null,
): string | null {
  if (args && typeof args === "object") {
    for (const key of [
      "path",
      "filePath",
      "file_path",
      "target_file",
      "targetFile",
      "absolutePath",
      "absolute_path",
    ]) {
      const v = args[key];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
  }

  const d = detail?.trim();
  if (!d) return null;
  // Heuristic: look like a path, not a shell command
  if (d.includes(" ") && !d.includes("/") && !d.includes("\\")) return null;
  if (/^(ls|cd|git|npm|pnpm|yarn|cat|echo)\b/i.test(d)) return null;
  return d.split(/\s/)[0] || null;
}

function resolveInRepo(repoPath: string, filePath: string): string | null {
  const abs = isAbsolute(filePath)
    ? filePath
    : resolve(repoPath, filePath);
  const rel = relative(repoPath, abs);
  if (rel.startsWith("..") || rel === "") return null;
  return rel.replace(/\\/g, "/");
}

async function runGit(
  repoPath: string,
  args: string[],
): Promise<string> {
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
    await execFileAsync(
      "git",
      ["ls-files", "--error-unmatch", "--", rel],
      { cwd: repoPath, encoding: "utf8" },
    );
    return true;
  } catch {
    return false;
  }
}

/** Unified diff for a single path (working tree / index / new file). */
export async function getFileDiff(
  repoPath: string,
  filePath: string,
): Promise<string> {
  const rel = resolveInRepo(repoPath, filePath);
  if (!rel) return "";

  const abs = resolve(repoPath, rel);

  // Tracked: show uncommitted changes vs HEAD
  let patch = await runGit(repoPath, ["diff", "HEAD", "--", rel]);
  if (!patch) patch = await runGit(repoPath, ["diff", "--", rel]);
  if (!patch) patch = await runGit(repoPath, ["diff", "--cached", "--", rel]);

  // Untracked new file
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

/** Build a minimal unified diff from before/after text (no repo required). */
export function buildUnifiedDiff(
  filePath: string,
  before: string,
  after: string,
): string {
  const path = filePath.replace(/\\/g, "/").replace(/^\.\//, "") || "file";
  if (before === after) return "";

  const oldLines = before.length ? before.replace(/\n$/, "").split("\n") : [];
  const newLines = after.length ? after.replace(/\n$/, "").split("\n") : [];
  const deleted = after.length === 0 && before.length > 0;
  const created = before.length === 0 && after.length > 0;

  const hunk: string[] = [
    `@@ -${created ? 0 : 1},${oldLines.length} +${deleted ? 0 : 1},${newLines.length} @@`,
  ];
  for (const line of oldLines) hunk.push(`-${line}`);
  for (const line of newLines) hunk.push(`+${line}`);

  return [
    `diff --git a/${path} b/${path}`,
    deleted ? `deleted file mode 100644` : "",
    created ? `new file mode 100644` : "",
    created ? `--- /dev/null` : `--- a/${path}`,
    deleted ? `+++ /dev/null` : `+++ b/${path}`,
    ...hunk,
  ]
    .filter((line) => line !== "")
    .join("\n");
}

function argString(
  args: Record<string, unknown>,
  keys: string[],
): string | undefined {
  for (const k of keys) {
    const v = args[k];
    if (typeof v === "string") return v;
  }
  return undefined;
}

/**
 * Synthesize a unified diff from edit-tool arguments (works for cloud agents
 * where we can't read a local git working tree).
 */
export function diffFromToolArgs(
  toolName: string,
  args?: Record<string, unknown> | null,
): string {
  if (!args || typeof args !== "object") return "";
  const path =
    extractToolPath("", args) ||
    argString(args, ["path", "file_path", "target_file"]) ||
    "file";
  const name = toolName.replace(/ToolCall$/i, "").toLowerCase();

  const oldStr = argString(args, [
    "old_string",
    "oldString",
    "old_str",
    "OldString",
  ]);
  const newStr = argString(args, [
    "new_string",
    "newString",
    "new_str",
    "NewString",
  ]);
  if (typeof oldStr === "string" && typeof newStr === "string") {
    return buildUnifiedDiff(path, oldStr, newStr);
  }

  const contents = argString(args, [
    "contents",
    "content",
    "new_contents",
    "newContents",
    "text",
  ]);
  if (
    typeof contents === "string" &&
    /^(write|create|updatefile|writefile|editnotebook)/i.test(name)
  ) {
    return buildUnifiedDiff(path, "", contents);
  }

  if (/^delete/i.test(name)) {
    return buildUnifiedDiff(path, `/* deleted: ${path} */\n`, "");
  }

  // ApplyPatch-style: some tools send a ready-made patch
  const patch = argString(args, ["patch", "diff", "unifiedDiff", "unified_diff"]);
  if (typeof patch === "string" && /diff --git|@@ /.test(patch)) {
    return patch.trim();
  }

  return "";
}
