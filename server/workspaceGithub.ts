import * as db from "./db.js";
import {
  decryptApiKey,
  encryptApiKey,
  encryptionConfigured,
  maskApiKey,
} from "./keyCrypto.js";
import { issueSettingsScopeKey } from "../shared/issues.js";
import { nanoid } from "nanoid";
import {
  fetchGithubAccount,
  listGithubRepos,
  looksLikeGithubToken,
  type GithubRepo,
} from "./githubApi.js";

export interface WorkspaceGithubInfo {
  connected: boolean;
  login: string | null;
  avatarUrl: string | null;
  hint: string | null;
  oauthAvailable: boolean;
  canManage: boolean;
}

function tokenSetting(scopeKey: string): string {
  return `workspace_github_token:${scopeKey}`;
}

function metaSetting(scopeKey: string): string {
  return `workspace_github_meta:${scopeKey}`;
}

export function workspaceGithubOAuthAvailable(): boolean {
  return Boolean(
    process.env.GITHUB_CLIENT_ID?.trim() &&
      process.env.GITHUB_CLIENT_SECRET?.trim(),
  );
}

export function getWorkspaceGithubToken(input: {
  orgId?: string | null;
  userId: string;
}): string {
  const scopeKey = issueSettingsScopeKey(input);
  const stored = db.getSetting(tokenSetting(scopeKey));
  if (!stored) return "";
  try {
    return decryptApiKey(stored);
  } catch (err) {
    console.error("Failed to decrypt workspace GitHub token:", err);
    return "";
  }
}

function readMeta(scopeKey: string): {
  login: string | null;
  avatarUrl: string | null;
  hint: string | null;
} {
  const raw = db.getSetting(metaSetting(scopeKey));
  if (!raw) return { login: null, avatarUrl: null, hint: null };
  try {
    const parsed = JSON.parse(raw) as {
      login?: string;
      avatarUrl?: string;
      hint?: string;
    };
    return {
      login: parsed.login || null,
      avatarUrl: parsed.avatarUrl || null,
      hint: parsed.hint || null,
    };
  } catch {
    return { login: null, avatarUrl: null, hint: null };
  }
}

export function getWorkspaceGithubInfo(input: {
  orgId?: string | null;
  userId: string;
  canManage: boolean;
}): WorkspaceGithubInfo {
  const scopeKey = issueSettingsScopeKey(input);
  const token = getWorkspaceGithubToken(input);
  const meta = readMeta(scopeKey);
  return {
    connected: Boolean(token),
    login: meta.login,
    avatarUrl: meta.avatarUrl,
    hint: meta.hint,
    oauthAvailable: workspaceGithubOAuthAvailable(),
    canManage: input.canManage,
  };
}

export async function connectWorkspaceGithub(input: {
  orgId?: string | null;
  userId: string;
  token: string;
}): Promise<WorkspaceGithubInfo> {
  const trimmed = input.token.trim();
  if (!trimmed) throw new Error("GitHub token is required");
  if (!encryptionConfigured()) {
    throw new Error("KEY_ENCRYPTION_SECRET is required to store a GitHub token");
  }
  if (!looksLikeGithubToken(trimmed) && trimmed.length < 20) {
    throw new Error("That does not look like a GitHub token");
  }
  const account = await fetchGithubAccount(trimmed);
  const scopeKey = issueSettingsScopeKey(input);
  db.setSetting(tokenSetting(scopeKey), encryptApiKey(trimmed));
  db.setSetting(
    metaSetting(scopeKey),
    JSON.stringify({
      login: account.login,
      avatarUrl: account.avatarUrl,
      hint: maskApiKey(trimmed),
    }),
  );
  return getWorkspaceGithubInfo({ ...input, canManage: true });
}

export function clearWorkspaceGithub(input: {
  orgId?: string | null;
  userId: string;
}): void {
  const scopeKey = issueSettingsScopeKey(input);
  db.deleteSetting(tokenSetting(scopeKey));
  db.deleteSetting(metaSetting(scopeKey));
}

export async function listWorkspaceGithubRepos(input: {
  orgId?: string | null;
  userId: string;
}): Promise<GithubRepo[]> {
  const token = getWorkspaceGithubToken(input);
  if (!token) {
    throw Object.assign(new Error("Connect GitHub for this workspace first"), {
      status: 400,
    });
  }
  return listGithubRepos(token);
}

const OAUTH_TTL_MS = 10 * 60 * 1000;

export function createGithubOAuthState(input: {
  userId: string;
  orgId?: string | null;
}): string {
  const state = nanoid(24);
  db.setSetting(
    `github_oauth:${state}`,
    JSON.stringify({
      userId: input.userId,
      orgId: input.orgId || null,
      exp: Date.now() + OAUTH_TTL_MS,
    }),
  );
  return state;
}

export function consumeGithubOAuthState(state: string): {
  userId: string;
  orgId?: string;
} | null {
  const key = `github_oauth:${state}`;
  const raw = db.getSetting(key);
  db.deleteSetting(key);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as {
      userId?: string;
      orgId?: string | null;
      exp?: number;
    };
    if (!parsed.userId || !parsed.exp || parsed.exp < Date.now()) return null;
    return {
      userId: parsed.userId,
      orgId: parsed.orgId || undefined,
    };
  } catch {
    return null;
  }
}

export { looksLikeGithubToken };
export type { GithubRepo };
