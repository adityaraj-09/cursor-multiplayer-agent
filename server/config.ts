import { resolve } from "path";

export const PORT = parseInt(process.env.PORT || "3000", 10);
export const DEFAULT_REPO_PATH = resolve(process.env.REPO_PATH || "./demo-repo");
export const DEFAULT_AGENT_COMMAND =
  process.env.AGENT_COMMAND || "cursor agent --force --trust";
export const SCROLLBACK_LIMIT = 200 * 1024;
