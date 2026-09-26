import { execFile } from "child_process";
import { promisify } from "util";
import type { ModelInfo } from "../shared/events.js";
import {
  fetchAnthropicModels,
  fetchOpenaiCodingModels,
  parseCodexDebugModels,
} from "../shared/providerModels.js";

const execFileAsync = promisify(execFile);
const CACHE_MS = 15 * 60_000;

const cache = new Map<string, { at: number; models: ModelInfo[] }>();

function cacheKeyHint(apiKey: string): string {
  return `${apiKey.length}:${apiKey.slice(-4)}`;
}

function readCache(key: string): ModelInfo[] | null {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.models;
  return null;
}

function writeCache(key: string, models: ModelInfo[]): ModelInfo[] {
  if (models.length) cache.set(key, { at: Date.now(), models });
  return models;
}

export async function listAnthropicModelsCached(
  apiKey: string,
): Promise<ModelInfo[]> {
  const key = `anthropic:${cacheKeyHint(apiKey)}`;
  const hit = readCache(key);
  if (hit) return hit;
  return writeCache(key, await fetchAnthropicModels(apiKey));
}

export async function listOpenaiModelsCached(
  apiKey: string,
): Promise<ModelInfo[]> {
  const key = `openai:${cacheKeyHint(apiKey)}`;
  const hit = readCache(key);
  if (hit) return hit;
  return writeCache(key, await fetchOpenaiCodingModels(apiKey));
}

async function runCodexDebugModels(): Promise<string> {
  const attempts = [["debug", "models"], ["debug", "models", "--bundled"]];
  let lastError: Error | null = null;
  for (const args of attempts) {
    try {
      const { stdout, stderr } = await execFileAsync("codex", args, {
        timeout: 30_000,
        encoding: "utf8",
        maxBuffer: 16 * 1024 * 1024,
        env: {
          ...process.env,
          NO_COLOR: "1",
          FORCE_COLOR: "0",
          TERM: "dumb",
        },
      });
      const text = `${stdout || ""}\n${stderr || ""}`;
      if (text.trim()) return text;
    } catch (err) {
      const e = err as {
        code?: string;
        stdout?: string;
        stderr?: string;
        message?: string;
      };
      if (e.stdout && String(e.stdout).trim()) return String(e.stdout);
      if (e.code === "ENOENT") {
        throw new Error("codex CLI not available on this server");
      }
      lastError = new Error(
        e.stderr?.trim() || e.message || "Failed to run `codex debug models`",
      );
    }
  }
  throw lastError || new Error("`codex debug models` returned no output");
}

/** Best-effort local Codex catalog when the binary is installed on the server. */
export async function listCodexCliModels(): Promise<ModelInfo[]> {
  const hit = readCache("codex-cli");
  if (hit) return hit;
  const models = parseCodexDebugModels(await runCodexDebugModels());
  return writeCache("codex-cli", models);
}
