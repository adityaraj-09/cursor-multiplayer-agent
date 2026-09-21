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

/** Optional Slack incoming webhook for collaboration notifications. */
export const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL?.trim() || "";

/**
 * Optional generic JSON webhook (Zapier / email bridge / custom).
 * Receives { kind, title, text, roomId?, orgId?, … }.
 */
export const NOTIFY_WEBHOOK_URL = process.env.NOTIFY_WEBHOOK_URL?.trim() || "";

/**
 * Public web origin used in Slack deep links (e.g. https://app.example.com).
 * Falls back to the first CORS_ORIGIN, then local Next.js.
 */
export const APP_ORIGIN =
  process.env.APP_ORIGIN?.trim() ||
  CORS_ORIGINS[0] ||
  "http://localhost:3001";

/**
 * Public origin of the Express API (Sarvam webhooks). Prefer the Render URL.
 * Falls back to APP_ORIGIN (Vercel rewrites /api/* to the API).
 */
export const API_PUBLIC_ORIGIN =
  process.env.API_PUBLIC_ORIGIN?.trim() || APP_ORIGIN;

export function sarvamApiKey(): string {
  return process.env.SARVAM_API_KEY?.trim() || "";
}

export function sarvamOrgId(): string {
  return process.env.SARVAM_ORG_ID?.trim() || "";
}

export function sarvamWorkspaceId(): string {
  return process.env.SARVAM_WORKSPACE_ID?.trim() || "";
}

export function sarvamAppId(): string {
  return process.env.SARVAM_APP_ID?.trim() || "";
}

export function sarvamAppVersion(): number {
  const n = Number(process.env.SARVAM_APP_VERSION?.trim() || "1");
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 1;
}

export function sarvamConnectionId(): string {
  return process.env.SARVAM_CONNECTION_ID?.trim() || "";
}

export function sarvamAgentPhone(): string {
  return process.env.SARVAM_AGENT_PHONE?.trim() || "";
}

/** Shared secret Sarvam sends when posting a spoken approve/deny. */
export function sarvamWebhookSecret(): string {
  return (
    process.env.SARVAM_WEBHOOK_SECRET?.trim() ||
    process.env.VOICE_APPROVAL_SECRET?.trim() ||
    ""
  );
}

export function voiceApprovalCooldownMs(): number {
  const raw = process.env.VOICE_APPROVAL_COOLDOWN_MS?.trim();
  if (!raw) return 15_000;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 15_000;
}

export function sarvamCallingConfigured(): boolean {
  return Boolean(
    sarvamApiKey() &&
      sarvamOrgId() &&
      sarvamWorkspaceId() &&
      sarvamAppId() &&
      sarvamConnectionId() &&
      sarvamAgentPhone(),
  );
}
