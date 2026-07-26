import { execFile } from "child_process";
import { promisify } from "util";
import type { ModelInfo } from "../shared/events.js";

const execFileAsync = promisify(execFile);

const ANSI_RE = /\x1b\[[0-9;]*[a-zA-Z]/g;
const MODEL_LINE_RE = /^([a-zA-Z0-9][a-zA-Z0-9._-]*)\s+[-–—]\s+(.+)$/;

let cache: { at: number; models: ModelInfo[] } | null = null;
const CACHE_MS = 60_000;

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
          // Avoid interactive/TUI noise when spawned from the server
          NO_COLOR: "1",
          FORCE_COLOR: "0",
          TERM: "dumb",
        },
      },
    );
    return stdout || "";
  } catch (err) {
    // cursor sometimes exits non-zero even with a full model list on stdout
    const e = err as { stdout?: string; stderr?: string; message?: string };
    if (e.stdout && String(e.stdout).trim()) return String(e.stdout);
    throw new Error(
      e.stderr?.trim() ||
        e.message ||
        "Failed to run `cursor agent --list-models`",
    );
  }
}

/** Models available to the logged-in Cursor CLI (no API key). */
export async function listCliModels(): Promise<ModelInfo[]> {
  if (cache && Date.now() - cache.at < CACHE_MS) {
    return cache.models;
  }

  const stdout = await runListModels();
  const models = parseModels(stdout);

  if (models.length === 0) {
    console.warn(
      "[cliModels] parsed 0 models; stdout head:",
      JSON.stringify(stripAnsi(stdout).slice(0, 240)),
    );
    return [{ id: "auto", displayName: "Auto" }];
  }

  console.log(`[cliModels] loaded ${models.length} models via CLI`);
  cache = { at: Date.now(), models };
  return models;
}
