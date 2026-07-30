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

export const AUTH_SECRET = process.env.AUTH_SECRET || "dev-secret-change-in-production";
export const IS_PRODUCTION = process.env.NODE_ENV === "production";

/** Comma-separated Clerk user IDs allowed to manage the shared server API key. */
export const ADMIN_USER_IDS: string[] = (process.env.ADMIN_USER_IDS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

export function isAdminUser(userId: string | undefined | null): boolean {
  if (!userId || ADMIN_USER_IDS.length === 0) return false;
  return ADMIN_USER_IDS.includes(userId);
}

/** Default invite link lifetime (7 days). */
export const INVITE_TTL_MS = (() => {
  const raw = process.env.INVITE_TTL_MS?.trim();
  if (!raw) return 7 * 24 * 60 * 60 * 1000;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 7 * 24 * 60 * 60 * 1000;
})();

/** Comma-separated browser origins allowed in production (e.g. Vercel URL). */
export const CORS_ORIGINS: string[] = (process.env.CORS_ORIGIN || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
