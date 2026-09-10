import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "crypto";
import { looksLikeGithubToken } from "../server/githubApi.js";

describe("github token shape", () => {
  it("accepts common GitHub token prefixes", () => {
    expect(looksLikeGithubToken("ghp_abc")).toBe(true);
    expect(looksLikeGithubToken("github_pat_abc")).toBe(true);
    expect(looksLikeGithubToken("gho_abc")).toBe(true);
    expect(looksLikeGithubToken("ghu_abc")).toBe(true);
    expect(looksLikeGithubToken("sk-ant-nope")).toBe(false);
  });
});

describe("per-workspace GitHub storage", () => {
  const prevSecret = process.env.KEY_ENCRYPTION_SECRET;
  let github: typeof import("../server/workspaceGithub.js");
  let db: typeof import("../server/db.js");

  beforeAll(async () => {
    process.env.KEY_ENCRYPTION_SECRET =
      "test-secret-for-workspace-github-32b!!";
    github = await import("../server/workspaceGithub.js");
    db = await import("../server/db.js");
  });

  afterAll(() => {
    if (prevSecret === undefined) delete process.env.KEY_ENCRYPTION_SECRET;
    else process.env.KEY_ENCRYPTION_SECRET = prevSecret;
    vi.unstubAllGlobals();
  });

  it("stores a different GitHub account per personal vs org workspace", async () => {
    const userId = `user_gh_${randomUUID()}`;
    db.createUser(userId, `${userId}@example.com`, "GH User", "x");
    const org = db.createOrganization({
      id: `org_${randomUUID().slice(0, 8)}`,
      name: "Acme",
      slug: `acme-gh-${Date.now()}`,
      createdBy: userId,
    });
    db.addOrganizationMember(org.id, userId, "owner");

    const fetchMock = vi.fn(
      async (url: string, init?: { headers?: Record<string, string> }) => {
        const href = String(url);
        const auth = init?.headers?.Authorization || "";
        if (href.endsWith("/user")) {
          const login = auth.includes("personal_token")
            ? "personal-dev"
            : "acme-bot";
          return {
            ok: true,
            json: async () => ({
              login,
              avatar_url: `https://example.com/${login}.png`,
              name: login,
            }),
          };
        }
        return { ok: false, json: async () => ({ message: href }) };
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const personal = await github.connectWorkspaceGithub({
      userId,
      token: "ghp_personal_token_value",
    });
    const team = await github.connectWorkspaceGithub({
      userId,
      orgId: org.id,
      token: "ghp_team_token_value",
    });

    expect(personal.connected).toBe(true);
    expect(personal.login).toBe("personal-dev");
    expect(team.connected).toBe(true);
    expect(team.login).toBe("acme-bot");
    expect(github.getWorkspaceGithubToken({ userId })).toBe(
      "ghp_personal_token_value",
    );
    expect(github.getWorkspaceGithubToken({ userId, orgId: org.id })).toBe(
      "ghp_team_token_value",
    );

    github.clearWorkspaceGithub({ userId });
    expect(github.getWorkspaceGithubToken({ userId })).toBe("");
    expect(github.getWorkspaceGithubToken({ userId, orgId: org.id })).toBe(
      "ghp_team_token_value",
    );
  });

  it("lists only team keys for an org workspace", async () => {
    const { listWorkspaceKeys } = await import("../server/workspaceRoutes.js");
    const userId = `user_keys_${randomUUID()}`;
    const keys = listWorkspaceKeys({
      userId,
      orgId: "org_team",
      canManage: true,
    });
    expect(keys.every((key) => key.owner === "team")).toBe(true);
    expect(keys.some((key) => key.id.startsWith("user-"))).toBe(false);
  });

  it("expires OAuth state after consume", () => {
    const userId = `user_oauth_${randomUUID()}`;
    const state = github.createGithubOAuthState({ userId, orgId: "org_1" });
    const first = github.consumeGithubOAuthState(state);
    expect(first).toEqual({ userId, orgId: "org_1" });
    expect(github.consumeGithubOAuthState(state)).toBeNull();
  });
});
