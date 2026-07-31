/**
 * Minimal GitHub REST helpers for Claude Code cloud sandboxes.
 * Uses GITHUB_TOKEN (PAT or GitHub App installation token).
 */

export interface ParsedGithubRepo {
  owner: string;
  repo: string;
  /** https://github.com/owner/repo (no .git) */
  httpsUrl: string;
}

export interface CreatePullRequestInput {
  owner: string;
  repo: string;
  title: string;
  body: string;
  head: string;
  base: string;
  token: string;
}

export interface CreatePullRequestResult {
  url: string;
  number: number;
}

const GITHUB_API = "https://api.github.com";

export function parseGithubRepoUrl(raw: string): ParsedGithubRepo | null {
  const trimmed = raw.trim().replace(/\.git$/i, "");
  const m = trimmed.match(
    /^https?:\/\/github\.com\/([^/]+)\/([^/]+?)\/?$/i,
  );
  if (!m) return null;
  const owner = m[1];
  const repo = m[2];
  if (!owner || !repo) return null;
  return {
    owner,
    repo,
    httpsUrl: `https://github.com/${owner}/${repo}`,
  };
}

export function githubTokenFromEnv(
  explicit?: string | null,
): string | undefined {
  const t =
    explicit?.trim() ||
    process.env.GITHUB_TOKEN?.trim() ||
    process.env.GH_TOKEN?.trim() ||
    "";
  return t || undefined;
}

/** Authenticated https remote for push/clone. */
export function authedGithubHttpsUrl(
  httpsUrl: string,
  token: string,
): string {
  return httpsUrl.replace(
    /^https:\/\//i,
    `https://x-access-token:${encodeURIComponent(token)}@`,
  );
}

export async function createPullRequest(
  input: CreatePullRequestInput,
): Promise<CreatePullRequestResult> {
  const res = await fetch(
    `${GITHUB_API}/repos/${input.owner}/${input.repo}/pulls`,
    {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${input.token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
        "User-Agent": "steer-claude-sandbox",
      },
      body: JSON.stringify({
        title: input.title,
        body: input.body,
        head: input.head,
        base: input.base,
      }),
    },
  );

  const data = (await res.json().catch(() => ({}))) as {
    html_url?: string;
    number?: number;
    message?: string;
    errors?: Array<{ message?: string }>;
  };

  if (!res.ok) {
    // Idempotent: if a PR already exists for this head, recover its URL.
    if (res.status === 422) {
      const existing = await findOpenPullRequest(
        input.owner,
        input.repo,
        input.head,
        input.token,
      );
      if (existing) return existing;
    }
    const detail =
      data.message ||
      data.errors?.map((e) => e.message).filter(Boolean).join("; ") ||
      `GitHub PR create failed (${res.status})`;
    throw new Error(detail);
  }

  if (!data.html_url || typeof data.number !== "number") {
    throw new Error("GitHub PR create returned an unexpected payload");
  }
  return { url: data.html_url, number: data.number };
}

async function findOpenPullRequest(
  owner: string,
  repo: string,
  headBranch: string,
  token: string,
): Promise<CreatePullRequestResult | null> {
  const head = `${owner}:${headBranch}`;
  const url = `${GITHUB_API}/repos/${owner}/${repo}/pulls?state=open&head=${encodeURIComponent(head)}&per_page=1`;
  const res = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "steer-claude-sandbox",
    },
  });
  if (!res.ok) return null;
  const list = (await res.json().catch(() => [])) as Array<{
    html_url?: string;
    number?: number;
  }>;
  const first = list[0];
  if (!first?.html_url || typeof first.number !== "number") return null;
  return { url: first.html_url, number: first.number };
}

/** Sanitize a slug for git branch names. */
export function slugifyBranchPart(raw: string, max = 32): string {
  const s = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max);
  return s || "agent";
}
