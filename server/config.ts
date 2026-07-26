import { resolve } from "path";

export const PORT = parseInt(process.env.PORT || "3000", 10);
export const DEFAULT_REPO_PATH = resolve(process.env.REPO_PATH || "./demo-repo");
export const DEFAULT_AGENT_COMMAND =
  process.env.AGENT_COMMAND || "cursor agent --print";
export const SCROLLBACK_LIMIT = 200 * 1024;

export const DEFAULT_MODEL = process.env.DEFAULT_MODEL?.trim() || "composer-2.5";

/** @deprecated Prefer getServerApiKey() — env is re-read / DB pickup supported. */
export function getEnvCursorApiKey(): string {
  return process.env.CURSOR_API_KEY?.trim() || "";
}
