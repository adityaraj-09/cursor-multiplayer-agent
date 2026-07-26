import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

const ANSI_RE = /\x1b\[[0-9;]*[a-zA-Z]/g;
const MODEL_LINE_RE = /^([a-zA-Z0-9][a-zA-Z0-9._-]*)\s+[-–—]\s+(.+)$/;

export interface ModelInfo {
  id: string;
  displayName: string;
}

function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, "").replace(/\r/g, "");
}

function parseModels(stdout: string): ModelInfo[] {
  const models: ModelInfo[] = [];
  const seen = new Set<string>();
  for (const raw of stripAnsi(stdout).split("\n")) {
    const line = raw.trim();
    if (!line || /^available models$/i.test(line)) continue;
    const m = line.match(MODEL_LINE_RE);
    if (!m) continue;
    const id = m[1];
    if (seen.has(id)) continue;
    seen.add(id);
    models.push({ id, displayName: m[2].trim() });
  }
  return models;
}

async function runListModels(): Promise<string> {
  try {
    const { stdout } = await execFileAsync(
      "cursor",
      ["agent", "--list-models"],
      {
        timeout: 60_000,
        encoding: "utf8",
        maxBuffer: 16 * 1024 * 1024,
        env: {
          ...process.env,
          NO_COLOR: "1",
          FORCE_COLOR: "0",
          TERM: "dumb",
        },
      },
    );
    return stdout || "";
  } catch (err) {
    const e = err as {
      code?: string;
      stdout?: string;
      stderr?: string;
      message?: string;
    };
    if (e.stdout && String(e.stdout).trim()) return String(e.stdout);
    if (e.code === "ENOENT") {
      throw new Error(
        "cursor CLI not found. Install Cursor and ensure `cursor` is on PATH.",
      );
    }
    throw new Error(
      e.stderr?.trim() ||
        e.message ||
        "Failed to run `cursor agent --list-models`",
    );
  }
}

/** Models available to the logged-in Cursor CLI on this machine. */
export async function listLocalModels(): Promise<ModelInfo[]> {
  const stdout = await runListModels();
  const models = parseModels(stdout);
  if (models.length === 0) {
    return [{ id: "auto", displayName: "Auto" }];
  }
  return models;
}
