import { Router, type Router as RouterType } from "express";
import { requireAuth } from "./auth.js";
import { APP_ORIGIN } from "./config.js";
import * as db from "./db.js";
import { canManageOrg } from "../shared/orgs.js";
import {
  userAnthropicByokConfigured,
  userAnthropicByokHint,
} from "./userAnthropicByok.js";
import { userByokConfigured, userByokHint } from "./userByok.js";
import {
  orgAnthropicKeyConfigured,
  orgAnthropicKeyHint,
  orgCursorKeyConfigured,
  orgCursorKeyHint,
} from "./orgKeys.js";
import {
  clearWorkspaceGithub,
  connectWorkspaceGithub,
  consumeGithubOAuthState,
  createGithubOAuthState,
  getWorkspaceGithubInfo,
  listWorkspaceGithubRepos,
  workspaceGithubOAuthAvailable,
} from "./workspaceGithub.js";
import { exchangeGithubOAuthCode } from "./githubApi.js";

const router: RouterType = Router();

function parseOrgId(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  if (!trimmed || trimmed === "personal") return undefined;
  return trimmed;
}

function githubRedirectUri(): string {
  return (
    process.env.GITHUB_REDIRECT_URI?.trim() ||
    `${APP_ORIGIN}/api/workspace/github/oauth/callback`
  );
}

function resolveWorkspace(
  userId: string,
  rawOrgId: unknown,
): {
  userId: string;
  orgId?: string;
  canManage: boolean;
} {
  const orgId = parseOrgId(rawOrgId);
  if (!orgId) {
    return { userId, canManage: true };
  }
  const member = db.getOrganizationMember(orgId, userId);
  if (!member) {
    throw Object.assign(new Error("Organization not found"), { status: 404 });
  }
  return {
    userId,
    orgId,
    canManage: canManageOrg(member.role),
  };
}

export interface WorkspaceKeyInfo {
  id: string;
  provider: "cursor" | "anthropic";
  label: string;
  owner: "you" | "team";
  configured: boolean;
  hint: string | null;
  canManage: boolean;
}

function listWorkspaceKeys(input: {
  userId: string;
  orgId?: string;
  canManage: boolean;
}): WorkspaceKeyInfo[] {
  const personal: WorkspaceKeyInfo[] = [
    {
      id: "user-cursor",
      provider: "cursor",
      label: "Cursor",
      owner: "you",
      configured: userByokConfigured(input.userId),
      hint: userByokHint(input.userId),
      canManage: true,
    },
    {
      id: "user-anthropic",
      provider: "anthropic",
      label: "Anthropic",
      owner: "you",
      configured: userAnthropicByokConfigured(input.userId),
      hint: userAnthropicByokHint(input.userId),
      canManage: true,
    },
  ];
  if (!input.orgId) return personal;
  return [
    {
      id: "org-cursor",
      provider: "cursor",
      label: "Team Cursor",
      owner: "team",
      configured: orgCursorKeyConfigured(input.orgId),
      hint: orgCursorKeyHint(input.orgId),
      canManage: input.canManage,
    },
    {
      id: "org-anthropic",
      provider: "anthropic",
      label: "Team Anthropic",
      owner: "team",
      configured: orgAnthropicKeyConfigured(input.orgId),
      hint: orgAnthropicKeyHint(input.orgId),
      canManage: input.canManage,
    },
    ...personal,
  ];
}

function sendError(res: import("express").Response, err: unknown): void {
  const status =
    err && typeof err === "object" && "status" in err
      ? Number((err as { status: number }).status) || 400
      : 400;
  res.status(status).json({
    error: err instanceof Error ? err.message : "Request failed",
  });
}

router.get("/", requireAuth, (req, res) => {
  try {
    const workspace = resolveWorkspace(req.user!.id, req.query.orgId);
    res.json({
      github: getWorkspaceGithubInfo(workspace),
      keys: listWorkspaceKeys(workspace),
    });
  } catch (err) {
    sendError(res, err);
  }
});

router.get("/keys", requireAuth, (req, res) => {
  try {
    const workspace = resolveWorkspace(req.user!.id, req.query.orgId);
    res.json({ keys: listWorkspaceKeys(workspace) });
  } catch (err) {
    sendError(res, err);
  }
});

router.get("/github", requireAuth, (req, res) => {
  try {
    const workspace = resolveWorkspace(req.user!.id, req.query.orgId);
    res.json(getWorkspaceGithubInfo(workspace));
  } catch (err) {
    sendError(res, err);
  }
});

router.get("/github/repos", requireAuth, async (req, res) => {
  try {
    const workspace = resolveWorkspace(req.user!.id, req.query.orgId);
    const github = getWorkspaceGithubInfo(workspace);
    if (!github.connected) {
      res.status(400).json({
        error: "Connect GitHub for this workspace first",
        github,
      });
      return;
    }
    const repositories = await listWorkspaceGithubRepos(workspace);
    res.json({ repositories, github });
  } catch (err) {
    sendError(res, err);
  }
});

router.post("/github", requireAuth, async (req, res) => {
  try {
    const workspace = resolveWorkspace(
      req.user!.id,
      req.body?.orgId ?? req.query.orgId,
    );
    if (!workspace.canManage) {
      res.status(403).json({
        error: "Only team admins can connect GitHub for this workspace",
      });
      return;
    }
    const token = String(req.body?.token || "").trim();
    const github = await connectWorkspaceGithub({
      ...workspace,
      token,
    });
    res.json(github);
  } catch (err) {
    sendError(res, err);
  }
});

router.delete("/github", requireAuth, (req, res) => {
  try {
    const workspace = resolveWorkspace(
      req.user!.id,
      req.body?.orgId ?? req.query.orgId,
    );
    if (!workspace.canManage) {
      res.status(403).json({
        error: "Only team admins can disconnect GitHub for this workspace",
      });
      return;
    }
    clearWorkspaceGithub(workspace);
    res.json(getWorkspaceGithubInfo(workspace));
  } catch (err) {
    sendError(res, err);
  }
});

router.post("/github/oauth/start", requireAuth, (req, res) => {
  try {
    const workspace = resolveWorkspace(
      req.user!.id,
      req.body?.orgId ?? req.query.orgId,
    );
    if (!workspace.canManage) {
      res.status(403).json({
        error: "Only team admins can connect GitHub for this workspace",
      });
      return;
    }
    if (!workspaceGithubOAuthAvailable()) {
      res.status(400).json({
        error:
          "GitHub OAuth is not configured. Set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET, or paste a personal access token.",
      });
      return;
    }
    const state = createGithubOAuthState(workspace);
    const url = new URL("https://github.com/login/oauth/authorize");
    url.searchParams.set("client_id", process.env.GITHUB_CLIENT_ID!.trim());
    url.searchParams.set("redirect_uri", githubRedirectUri());
    url.searchParams.set("scope", "read:user repo");
    url.searchParams.set("state", state);
    res.json({ url: url.toString() });
  } catch (err) {
    sendError(res, err);
  }
});

router.get("/github/oauth/callback", async (req, res) => {
  const fail = (message: string) => {
    const dest = new URL("/settings", APP_ORIGIN);
    dest.searchParams.set("github", "error");
    dest.searchParams.set("message", message);
    res.redirect(dest.toString());
  };
  try {
    const code = String(req.query.code || "").trim();
    const state = String(req.query.state || "").trim();
    if (!code || !state) {
      fail("GitHub did not return an authorization code");
      return;
    }
    const pending = consumeGithubOAuthState(state);
    if (!pending) {
      fail("GitHub connect expired. Try again.");
      return;
    }
    const token = await exchangeGithubOAuthCode({
      code,
      clientId: process.env.GITHUB_CLIENT_ID?.trim() || "",
      clientSecret: process.env.GITHUB_CLIENT_SECRET?.trim() || "",
      redirectUri: githubRedirectUri(),
    });
    await connectWorkspaceGithub({
      userId: pending.userId,
      orgId: pending.orgId,
      token,
    });
    const dest = new URL("/settings", APP_ORIGIN);
    dest.searchParams.set("github", "connected");
    if (pending.orgId) dest.searchParams.set("org", pending.orgId);
    res.redirect(dest.toString());
  } catch (err) {
    fail(err instanceof Error ? err.message : "GitHub OAuth failed");
  }
});

export default router;
export { listWorkspaceKeys, resolveWorkspace };
