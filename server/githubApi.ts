import { logError } from "./logger.js";

export interface GithubAccount {
  login: string;
  avatarUrl: string;
  name: string | null;
}

export interface GithubRepo {
  url: string;
  fullName: string;
  private: boolean;
  defaultBranch: string;
}

export async function githubRequest<T>(
  token: string,
  path: string,
): Promise<T> {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "steer-issues",
    },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    const message = body.message || `GitHub API ${res.status}`;
    logError("github-api", message, { path, status: res.status });
    throw new Error(message);
  }
  return (await res.json()) as T;
}

export async function fetchGithubAccount(token: string): Promise<GithubAccount> {
  const user = await githubRequest<{
    login: string;
    avatar_url: string;
    name: string | null;
  }>(token, "/user");
  return {
    login: user.login,
    avatarUrl: user.avatar_url,
    name: user.name,
  };
}

export async function listGithubRepos(token: string): Promise<GithubRepo[]> {
  const out: GithubRepo[] = [];
  for (let page = 1; page <= 4; page++) {
    const rows = await githubRequest<
      Array<{
        html_url: string;
        full_name: string;
        private: boolean;
        default_branch?: string;
      }>
    >(
      token,
      `/user/repos?per_page=100&page=${page}&sort=updated&affiliation=owner,collaborator,organization_member`,
    );
    for (const row of rows) {
      out.push({
        url: row.html_url.replace(/\.git$/i, ""),
        fullName: row.full_name,
        private: Boolean(row.private),
        defaultBranch: row.default_branch || "main",
      });
    }
    if (rows.length < 100) break;
  }
  return out;
}

export function looksLikeGithubToken(raw: string): boolean {
  const token = raw.trim();
  return (
    token.startsWith("ghp_") ||
    token.startsWith("github_pat_") ||
    token.startsWith("gho_") ||
    token.startsWith("ghu_")
  );
}

export async function exchangeGithubOAuthCode(input: {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}): Promise<string> {
  const res = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_id: input.clientId,
      client_secret: input.clientSecret,
      code: input.code,
      redirect_uri: input.redirectUri,
    }),
  });
  const data = (await res.json()) as {
    access_token?: string;
    error?: string;
    error_description?: string;
  };
  if (!data.access_token) {
    throw new Error(data.error_description || data.error || "GitHub OAuth failed");
  }
  return data.access_token;
}
