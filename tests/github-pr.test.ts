import { afterEach, describe, expect, it, vi } from "vitest";
import {
  authedGithubHttpsUrl,
  createPullRequest,
  githubTokenFromEnv,
  parseGithubRepoUrl,
  slugifyBranchPart,
} from "../server/githubPr.js";

describe("parseGithubRepoUrl", () => {
  it("parses https github URLs and strips .git", () => {
    expect(parseGithubRepoUrl("https://github.com/acme/widget.git")).toEqual({
      owner: "acme",
      repo: "widget",
      httpsUrl: "https://github.com/acme/widget",
    });
  });

  it("rejects non-github or malformed URLs", () => {
    expect(parseGithubRepoUrl("https://gitlab.com/acme/widget")).toBeNull();
    expect(parseGithubRepoUrl("not-a-url")).toBeNull();
    expect(parseGithubRepoUrl("https://github.com/only-owner")).toBeNull();
  });
});

describe("github helpers", () => {
  afterEach(() => {
    delete process.env.GITHUB_TOKEN;
    delete process.env.GH_TOKEN;
  });

  it("prefers explicit token, then GITHUB_TOKEN, then GH_TOKEN", () => {
    process.env.GH_TOKEN = "gh-fallback";
    expect(githubTokenFromEnv("  explicit  ")).toBe("explicit");
    expect(githubTokenFromEnv()).toBe("gh-fallback");
    process.env.GITHUB_TOKEN = "github-primary";
    expect(githubTokenFromEnv()).toBe("github-primary");
  });

  it("builds an authenticated clone URL", () => {
    expect(
      authedGithubHttpsUrl("https://github.com/acme/widget", "tok/en"),
    ).toBe("https://x-access-token:tok%2Fen@github.com/acme/widget");
  });

  it("slugifies branch name parts", () => {
    expect(slugifyBranchPart("My Agent/Name!!")).toBe("my-agent-name");
    expect(slugifyBranchPart("@@@")).toBe("agent");
  });
});

describe("createPullRequest", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("creates a PR via GitHub REST", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        html_url: "https://github.com/acme/widget/pull/7",
        number: 7,
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await createPullRequest({
      owner: "acme",
      repo: "widget",
      title: "Test",
      body: "Body",
      head: "steer/claude-x",
      base: "main",
      token: "tok",
    });

    expect(result).toEqual({
      url: "https://github.com/acme/widget/pull/7",
      number: 7,
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/repos/acme/widget/pulls");
    expect(init.method).toBe("POST");
  });

  it("recovers an existing open PR on 422", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 422,
        json: async () => ({ message: "Validation Failed" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [
          {
            html_url: "https://github.com/acme/widget/pull/9",
            number: 9,
          },
        ],
      });
    vi.stubGlobal("fetch", fetchMock);

    const result = await createPullRequest({
      owner: "acme",
      repo: "widget",
      title: "Test",
      body: "Body",
      head: "steer/claude-x",
      base: "main",
      token: "tok",
    });

    expect(result).toEqual({
      url: "https://github.com/acme/widget/pull/9",
      number: 9,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
