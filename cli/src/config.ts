import { mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";

export interface Config {
  serverUrl: string;
  token: string;
  email: string;
}

/** Production API (override with STEER_SERVER_URL for local/dev). */
export const DEFAULT_SERVER_URL = (
  process.env.STEER_SERVER_URL ||
  "https://cursor-multiplayer-agent.onrender.com"
).replace(/\/+$/, "");

const CONFIG_DIR_NAME = "steer";
const LEGACY_CONFIG_DIR_NAME = "shared-agent";
const CONFIG_FILE = "config.json";

export function getConfigDir(): string {
  const dir = join(homedir(), ".config", CONFIG_DIR_NAME);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export function loadConfig(): Config | null {
  const filePath = join(getConfigDir(), CONFIG_FILE);
  const legacyPath = join(homedir(), ".config", LEGACY_CONFIG_DIR_NAME, CONFIG_FILE);
  const path = existsSync(filePath)
    ? filePath
    : existsSync(legacyPath)
      ? legacyPath
      : null;
  if (!path) return null;
  try {
    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw) as Partial<Config>;
    if (!parsed.serverUrl || !parsed.token || !parsed.email) return null;
    // Migrate legacy config into ~/.config/steer/
    if (path === legacyPath) {
      saveConfig(parsed as Config);
    }
    return parsed as Config;
  } catch {
    return null;
  }
}

export function saveConfig(config: Config): void {
  const filePath = join(getConfigDir(), CONFIG_FILE);
  writeFileSync(filePath, JSON.stringify(config, null, 2), "utf-8");
}

export function clearConfig(): void {
  const filePath = join(getConfigDir(), CONFIG_FILE);
  if (existsSync(filePath)) {
    rmSync(filePath);
  }
}
