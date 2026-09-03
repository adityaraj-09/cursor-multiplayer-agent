import { afterEach, describe, expect, it, vi } from "vitest";
import {
  authedGithubHttpsUrl,
  createPullRequest,
  ensurePullRequest,
  githubTokenFromEnv,
  parseGithubRepoUrl,
  slugifyBranchPart,
  updatePullRequest,
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

describe("ensurePullRequest", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("updates an existing open PR instead of opening another", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [
          {
            html_url: "https://github.com/acme/widget/pull/9",
            number: 9,
          },
        ],
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          html_url: "https://github.com/acme/widget/pull/9",
          number: 9,
        }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const result = await ensurePullRequest({
      owner: "acme",
      repo: "widget",
      title: "Integration",
      body: "Updated body",
      head: "steer/integration-x",
      base: "main",
      token: "tok",
    });

    expect(result).toEqual({
      url: "https://github.com/acme/widget/pull/9",
      number: 9,
      created: false,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [updateUrl, updateInit] = fetchMock.mock.calls[1] as [
      string,
      RequestInit,
    ];
    expect(updateUrl).toContain("/pulls/9");
    expect(updateInit.method).toBe("PATCH");
  });

  it("creates a PR when none exists", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          html_url: "https://github.com/acme/widget/pull/11",
          number: 11,
        }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const result = await ensurePullRequest({
      owner: "acme",
      repo: "widget",
      title: "Integration",
      body: "Body",
      head: "steer/integration-x",
      base: "main",
      token: "tok",
    });

    expect(result.created).toBe(true);
    expect(result.number).toBe(11);
  });
});

describe("updatePullRequest", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("patches title and body", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        html_url: "https://github.com/acme/widget/pull/3",
        number: 3,
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await updatePullRequest({
      owner: "acme",
      repo: "widget",
      number: 3,
      token: "tok",
      title: "New title",
      body: "New body",
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(String(init.body))).toEqual({
      title: "New title",
      body: "New body",
    });
  });
});
