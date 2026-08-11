import "dotenv/config";
import express from "express";
import cors from "cors";
import { createServer } from "http";
import { Server } from "socket.io";
import { PORT, IS_PRODUCTION, CORS_ORIGINS, isAdminUser } from "./config.js";
import { RoomManager } from "./roomManager.js";
import { WorkerRelay } from "./workerRelay.js";
import { FileLockRegistry } from "./fileLocks.js";
import { listModelsForKey, listReposForKey } from "./sdkAgent.js";
import { listCliModels } from "./cliModels.js";
import { encryptionConfigured } from "./keyCrypto.js";
import { authMiddleware, hashSessionToken, requireAuth, resolveAuthToken } from "./auth.js";
import authRoutes from "./authRoutes.js";
import orgRoutes from "./orgRoutes.js";
import * as db from "./db.js";
import {
  getOrgCursorKey,
  orgAnthropicKeyConfigured,
  orgAnthropicKeyHint,
  orgCursorKeyConfigured,
  orgCursorKeyHint,
} from "./orgKeys.js";
import {
  clearServerApiKey,
  getServerApiKey,
  serverKeyConfigured,
  serverKeyHint,
  serverKeySource,
  setServerApiKey,
} from "./serverKey.js";
import {
  clearUserByokKey,
  getUserByokKey,
  setUserByokKey,
  userByokConfigured,
  userByokHint,
} from "./userByok.js";
import {
  clearUserAnthropicByokKey,
  setUserAnthropicByokKey,
  userAnthropicByokConfigured,
  userAnthropicByokHint,
} from "./userAnthropicByok.js";
import { isClaudeSandboxConfigured } from "./claudeSandbox.js";
import type {
  ServerToClientEvents,
  ClientToServerEvents,
  AuthMode,
} from "../shared/events.js";

function parseAuthMode(raw: unknown): AuthMode {
  if (raw === "byok") return "byok";
  if (raw === "cli") return "cli";
  return "server";
}

/** Express may type route params as `string | string[]`. */
function routeParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] || "";
  return value || "";
}

const corsOrigin:
  | boolean
  | string[]
  | ((
      origin: string | undefined,
      cb: (err: Error | null, allow?: boolean) => void,
    ) => void) =
  !IS_PRODUCTION
    ? true
    : CORS_ORIGINS.length === 0
      ? true // set CORS_ORIGIN in prod for lock-down
      : (origin, cb) => {
          if (!origin || CORS_ORIGINS.includes(origin)) cb(null, true);
          else cb(null, false);
        };

const app = express();
app.use(
  cors({
    origin: corsOrigin,
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Cursor-Api-Key"],
  }),
);
app.use(express.json({ limit: "1mb" }));

// Auth middleware — Clerk JWT or CLI session token → req.user
app.use(authMiddleware());

const httpServer = createServer(app);
const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  cors: {
    origin: corsOrigin,
    methods: ["GET", "POST", "PATCH", "DELETE"],
  },
  path: "/socket.io/",
  // Render / proxies
  transports: ["websocket", "polling"],
  allowEIO3: true,
});

const fileLocks = new FileLockRegistry();
const workerRelay = new WorkerRelay(io as unknown as Server, (token) => {
  // CLI workers use hashed session tokens (not Clerk JWTs)
  const session =
    (db.getSession(hashSessionToken(token)) as
      | { user_id: string; expires_at: number }
      | undefined) ||
    (db.getSession(token) as
      | { user_id: string; expires_at: number }
      | undefined);
  if (!session || session.expires_at < Date.now()) return null;
  return { userId: session.user_id, workerId: `w-${session.user_id}` };
}, fileLocks);

const roomManager = new RoomManager(io, workerRelay, fileLocks);

async function attachRedisAdapter(): Promise<void> {
  const redisUrl = process.env.REDIS_URL?.trim();
  if (!redisUrl) return;
  try {
    const { createAdapter } = await import("@socket.io/redis-adapter");
    const { createClient } = await import("redis");
    const pub = createClient({ url: redisUrl });
    const sub = pub.duplicate();
    pub.on("error", (err) => console.error("[redis pub]", err));
    sub.on("error", (err) => console.error("[redis sub]", err));
    await Promise.all([pub.connect(), sub.connect()]);
    io.adapter(createAdapter(pub, sub));
    console.log("[socket.io] Redis adapter attached");
  } catch (err) {
    console.error(
      "[socket.io] Failed to attach Redis adapter — continuing in-memory:",
      err,
    );
  }
}

// Periodically purge expired CLI session tokens.
setInterval(() => {
  try {
    db.deleteExpiredSessions();
    fileLocks.purgeExpired();
  } catch (err) {
    console.error("[auth] deleteExpiredSessions failed:", err);
  }
}, 60 * 60 * 1000).unref?.();
try {
  db.deleteExpiredSessions();
} catch {
  // ignore startup cleanup failures
}

function resolveRequestKey(
  authMode: AuthMode,
  bodyKey?: string,
  headerKey?: string,
  userId?: string,
  orgId?: string,
): string {
  if (authMode === "cli") {
    throw new Error("CLI auth does not use an API key");
  }
  if (authMode === "byok") {
    const key = (bodyKey || headerKey || "").trim();
    if (key) return key;
    if (userId) {
      const saved = getUserByokKey(userId);
      if (saved) return saved;
    }
    throw new Error("BYOK requires an API key");
  }
  if (orgId && userId && db.isOrganizationMember(orgId, userId)) {
    const orgKey = getOrgCursorKey(orgId);
    if (orgKey) return orgKey;
  }
  const serverKey = getServerApiKey();
  if (serverKey) return serverKey;
  throw new Error(
    orgId
      ? "Org shared Cursor key is not configured"
      : "Server API key is not configured",
  );
}

// User auth routes
app.use("/api/auth", authRoutes);
app.use("/api/orgs", orgRoutes);

app.get("/api/auth/status", (req, res) => {
  const userId = req.user?.id;
  const orgId =
    typeof req.query.orgId === "string" ? req.query.orgId.trim() : "";
  const inOrg = Boolean(
    orgId && userId && db.isOrganizationMember(orgId, userId),
  );
  const orgKeyConfigured = inOrg ? orgCursorKeyConfigured(orgId) : false;
  const orgAnthropicConfigured = inOrg
    ? orgAnthropicKeyConfigured(orgId)
    : false;
  res.json({
    serverKeyConfigured: serverKeyConfigured(),
    serverKeySource: serverKeySource(),
    serverKeyHint: serverKeyHint(),
    encryptionConfigured: encryptionConfigured(),
    byokAvailable: encryptionConfigured(),
    userByokConfigured: userId ? userByokConfigured(userId) : false,
    userByokHint: userId ? userByokHint(userId) : null,
    userAnthropicByokConfigured: userId
      ? userAnthropicByokConfigured(userId)
      : false,
    userAnthropicByokHint: userId ? userAnthropicByokHint(userId) : null,
    e2bConfigured: isClaudeSandboxConfigured(),
    canManageServerKey: isAdminUser(userId),
    orgCursorKeyConfigured: orgKeyConfigured,
    orgCursorKeyHint:
      orgKeyConfigured && orgId ? orgCursorKeyHint(orgId) : null,
    orgAnthropicKeyConfigured: orgAnthropicConfigured,
    orgAnthropicKeyHint:
      orgAnthropicConfigured && orgId ? orgAnthropicKeyHint(orgId) : null,
  });
});

/** Pick up / replace the shared server API key (encrypted in DB). Admin only. */
app.post("/api/auth/server-key", requireAuth, (req, res) => {
  if (!isAdminUser(req.user!.id)) {
    res.status(403).json({
      error:
        "Only admins can change the shared server key (set ADMIN_USER_IDS)",
    });
    return;
  }
  try {
    const apiKey = String(req.body?.apiKey || "").trim();
    const result = setServerApiKey(apiKey);
    res.json({
      ok: true,
      serverKeyConfigured: true,
      serverKeySource: serverKeySource(),
      serverKeyHint: result.hint,
      canManageServerKey: true,
    });
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : "Failed to save server key",
    });
  }
});

app.delete("/api/auth/server-key", requireAuth, (req, res) => {
  if (!isAdminUser(req.user!.id)) {
    res.status(403).json({
      error:
        "Only admins can change the shared server key (set ADMIN_USER_IDS)",
    });
    return;
  }
  clearServerApiKey();
  res.json({
    ok: true,
    serverKeyConfigured: serverKeyConfigured(),
    serverKeySource: serverKeySource(),
    serverKeyHint: serverKeyHint(),
    canManageServerKey: true,
  });
});

/** Save / replace the signed-in user's BYOK Cursor API key. */
app.post("/api/auth/byok-key", requireAuth, (req, res) => {
  try {
    const apiKey = String(req.body?.apiKey || "").trim();
    const result = setUserByokKey(req.user!.id, apiKey);
    res.json({
      ok: true,
      userByokConfigured: true,
      userByokHint: result.hint,
    });
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : "Failed to save BYOK key",
    });
  }
});

app.delete("/api/auth/byok-key", requireAuth, (req, res) => {
  clearUserByokKey(req.user!.id);
  res.json({
    ok: true,
    userByokConfigured: false,
    userByokHint: null,
  });
});

/** Save / replace the signed-in user's Anthropic API key (Claude Code cloud BYOK). */
app.post("/api/auth/anthropic-byok-key", requireAuth, (req, res) => {
  try {
    const apiKey = String(req.body?.apiKey || "").trim();
    const result = setUserAnthropicByokKey(req.user!.id, apiKey);
    res.json({
      ok: true,
      userAnthropicByokConfigured: true,
      userAnthropicByokHint: result.hint,
    });
  } catch (err) {
    res.status(400).json({
      error:
        err instanceof Error
          ? err.message
          : "Failed to save Anthropic BYOK key",
    });
  }
});

app.delete("/api/auth/anthropic-byok-key", requireAuth, (req, res) => {
  clearUserAnthropicByokKey(req.user!.id);
  res.json({
    ok: true,
    userAnthropicByokConfigured: false,
    userAnthropicByokHint: null,
  });
});

app.post("/api/models", requireAuth, async (req, res) => {
  try {
    const authMode = parseAuthMode(req.body?.authMode);
    if (authMode === "cli") {
      // Hosted API has no `cursor` binary — ask the user's CLI worker.
      if (req.user && workerRelay.hasOnlineWorker(req.user.id)) {
        const models = await workerRelay.requestListModels(req.user.id);
        res.json({ models });
        return;
      }
      try {
        const models = await listCliModels();
        res.json({ models });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to list models";
        if (!req.user) {
          throw new Error("Sign in required to list local models");
        }
        throw new Error(
          msg.includes("steer start")
            ? msg
            : `${msg} Run \`steer start\` on your machine so models can be listed.`,
        );
      }
      return;
    }
    const apiKey = resolveRequestKey(
      authMode,
      req.body?.apiKey,
      typeof req.headers["x-cursor-api-key"] === "string"
        ? req.headers["x-cursor-api-key"]
        : undefined,
      req.user?.id,
      typeof req.body?.orgId === "string" ? req.body.orgId : undefined,
    );
    const models = await listModelsForKey(apiKey);
    res.json({ models });
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : "Failed to list models",
    });
  }
});

app.post("/api/repositories", requireAuth, async (req, res) => {
  try {
    const authMode = parseAuthMode(req.body?.authMode);
    if (authMode === "cli") {
      res.status(400).json({
        error: "Repository listing requires a Cursor API key (cloud only)",
      });
      return;
    }
    const apiKey = resolveRequestKey(
      authMode,
      req.body?.apiKey,
      typeof req.headers["x-cursor-api-key"] === "string"
        ? req.headers["x-cursor-api-key"]
        : undefined,
      req.user?.id,
      typeof req.body?.orgId === "string" ? req.body.orgId : undefined,
    );
    const repositories = await listReposForKey(apiKey);
    res.json({ repositories });
  } catch (err) {
    res.status(400).json({
      error:
        err instanceof Error ? err.message : "Failed to list repositories",
    });
  }
});

/** GET /api/workers — online workers for current user */
app.get("/api/workers", (req, res) => {
  if (!req.user) {
    res.json({ workers: [] });
    return;
  }
  res.json({ workers: workerRelay.getOnlineWorkersForUser(req.user.id) });
});

/**
 * POST /api/workers/pick-folder — ask the CLI worker to open a native folder picker.
 * Requires auth + an online worker for this user.
 */
app.post("/api/workers/pick-folder", requireAuth, async (req, res) => {
  if (!req.user) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  try {
    const path = await workerRelay.requestFolderPick(req.user.id);
    if (!path) {
      res.status(400).json({ error: "Folder selection cancelled" });
      return;
    }
    res.json({ path });
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : "Failed to pick folder",
    });
  }
});

/** GET /api/cursor-sessions?repoPath= — Cursor CLI chats for a repo (via worker). */
app.get("/api/cursor-sessions", requireAuth, async (req, res) => {
  const repoPath =
    typeof req.query.repoPath === "string" ? req.query.repoPath.trim() : "";
  if (!repoPath) {
    res.status(400).json({ error: "repoPath is required" });
    return;
  }
  try {
    const sessions = await workerRelay.requestListSessions(
      req.user!.id,
      repoPath,
    );
    res.json({ sessions });
  } catch (err) {
    res.status(400).json({
      error:
        err instanceof Error ? err.message : "Failed to list chat sessions",
    });
  }
});

app.get("/api/rooms", requireAuth, (req, res) => {
  const orgIdRaw = req.query.orgId;
  const orgId =
    typeof orgIdRaw === "string" ? orgIdRaw.trim() : undefined;
  if (orgId === "personal" || orgId === "") {
    res.json(roomManager.listPersonalRoomsForUser(req.user!.id));
    return;
  }
  if (orgId) {
    if (!db.isOrganizationMember(orgId, req.user!.id)) {
      res.status(404).json({ error: "Organization not found" });
      return;
    }
    res.json(roomManager.listRoomsForOrg(orgId));
    return;
  }
  res.json(roomManager.listRoomsForUser(req.user!.id));
});

app.get("/api/rooms/:id", requireAuth, (req, res) => {
  const id = routeParam(req.params.id);
  if (!roomManager.userCanAccessRoom(id, req.user!.id)) {
    res.status(404).json({ error: "Room not found" });
    return;
  }
  const room = roomManager.getRoomInfo(id, req.user!.id);
  if (!room) {
    res.status(404).json({ error: "Room not found" });
    return;
  }
  res.json(room);
});

/**
 * GET /api/rooms/:id/slack-webhook — whether Slack is connected for this room.
 */
app.get("/api/rooms/:id/slack-webhook", requireAuth, (req, res) => {
  try {
    res.json(
      roomManager.getSlackWebhookStatus(
        routeParam(req.params.id),
        req.user!.id,
      ),
    );
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to load Slack status";
    const status = message.includes("not found") ? 404 : 400;
    res.status(status).json({ error: message });
  }
});

/**
 * PUT /api/rooms/:id/slack-webhook — host stores an encrypted Slack webhook.
 * Body: { webhookUrl: string }
 */
app.put("/api/rooms/:id/slack-webhook", requireAuth, (req, res) => {
  try {
    const room = roomManager.setRoomSlackWebhook(
      routeParam(req.params.id),
      String(req.body?.webhookUrl || ""),
      req.user!.id,
    );
    res.json({
      ok: true,
      configured: true,
      hint: room.slackWebhookHint || null,
      room,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to save Slack webhook";
    const status =
      message.includes("Only the host") || message.includes("Not allowed")
        ? 403
        : message.includes("not found")
          ? 404
          : 400;
    res.status(status).json({ error: message });
  }
});

/**
 * DELETE /api/rooms/:id/slack-webhook — host removes the room Slack webhook.
 */
app.delete("/api/rooms/:id/slack-webhook", requireAuth, (req, res) => {
  try {
    const room = roomManager.clearRoomSlackWebhook(
      routeParam(req.params.id),
      req.user!.id,
    );
    res.json({ ok: true, configured: false, room });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to remove Slack webhook";
    const status =
      message.includes("Only the host") || message.includes("Not allowed")
        ? 403
        : message.includes("not found")
          ? 404
          : 400;
    res.status(status).json({ error: message });
  }
});

/**
 * POST /api/rooms/:id/slack-webhook/test — host sends a test Slack message.
 */
app.post("/api/rooms/:id/slack-webhook/test", requireAuth, async (req, res) => {
  try {
    const result = await roomManager.testRoomSlackWebhook(
      routeParam(req.params.id),
      req.user!.id,
    );
    res.json(result);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to send test message";
    const status =
      message.includes("Only the host") || message.includes("Not allowed")
        ? 403
        : message.includes("not found")
          ? 404
          : 400;
    res.status(status).json({ error: message });
  }
});

/**
 * POST /api/rooms/:id/pings/:pingId/ack — acknowledge a review ping (deep link).
 */
app.post("/api/rooms/:id/pings/:pingId/ack", requireAuth, (req, res) => {
  const roomId = routeParam(req.params.id);
  const pingId = routeParam(req.params.pingId);
  if (!roomManager.userCanAccessRoom(roomId, req.user!.id)) {
    res.status(404).json({ error: "Room not found" });
    return;
  }
  try {
    const name =
      String(req.body?.name || req.user!.name || "").trim().slice(0, 80) ||
      "Someone";
    const ping = roomManager.ackPing(roomId, pingId, req.user!.id, name);
    res.json({ ok: true, ping });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to acknowledge ping";
    const status = message.includes("not found")
      ? 404
      : message.includes("not a target")
        ? 403
        : 400;
    res.status(status).json({ error: message });
  }
});

/**
 * PATCH /api/rooms/:id/settings — host updates collaboration settings.
 * Body: { controlMode?: "open" | "driver" | "host", approvalMode?: "off" | "dangerous" | "all" }
 */
app.patch("/api/rooms/:id/settings", requireAuth, (req, res) => {
  const id = routeParam(req.params.id);
  try {
    let room;
    if (req.body?.controlMode !== undefined) {
      room = roomManager.setControlMode(
        id,
        String(req.body.controlMode || ""),
        req.user!.id,
      );
    }
    if (req.body?.approvalMode !== undefined) {
      room = roomManager.setApprovalMode(
        id,
        String(req.body.approvalMode || ""),
        req.user!.id,
      );
    }
    res.json(room ?? roomManager.getRoomInfo(id, req.user!.id));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to update settings";
    const status =
      message.includes("Only the host") || message.includes("Not allowed")
        ? 403
        : message.includes("not found")
          ? 404
          : 400;
    res.status(status).json({ error: message });
  }
});

/**
 * POST /api/rooms/:id/join — signed-in user becomes a member via shared link.
 * Personal rooms default to viewer (aligns with invite defaults).
 * Body optional: { role?: "viewer" | "editor" } — ignored for non-managers;
 * preferred role only applies when the actor is already allowed to manage
 * (not used for anonymous shared-link joins).
 */
app.post("/api/rooms/:id/join", requireAuth, (req, res) => {
  try {
    const room = roomManager.joinAsMember(
      routeParam(req.params.id),
      req.user!.id,
    );
    res.json(room);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Room not found";
    const status = message.includes("organization")
      ? 403
      : message.includes("not found")
        ? 404
        : 400;
    res.status(status).json({ error: message });
  }
});

/**
 * GET /api/rooms/:id/members — durable roster (online + offline).
 */
app.get("/api/rooms/:id/members", requireAuth, (req, res) => {
  const id = routeParam(req.params.id);
  if (!roomManager.userCanAccessRoom(id, req.user!.id)) {
    res.status(404).json({ error: "Room not found" });
    return;
  }
  res.json({ members: roomManager.listMembers(id) });
});

/**
 * PATCH /api/rooms/:id/members/:userId — host/org admin changes role.
 * Body: { role: "editor" | "viewer" }
 */
app.patch("/api/rooms/:id/members/:userId", requireAuth, (req, res) => {
  try {
    const members = roomManager.setMemberRole(
      routeParam(req.params.id),
      routeParam(req.params.userId),
      String(req.body?.role || ""),
      req.user!.id,
    );
    res.json({ members });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to update role";
    const status =
      message.includes("Only the host") || message.includes("Not allowed")
        ? 403
        : message.includes("not found") || message.includes("Member not found")
          ? 404
          : 400;
    res.status(status).json({ error: message });
  }
});

/**
 * GET /api/rooms/:id/export — markdown transcript + session summary.
 */
app.get("/api/rooms/:id/export", requireAuth, (req, res) => {
  try {
    const exported = roomManager.exportTranscript(
      routeParam(req.params.id),
      req.user!.id,
    );
    res.json(exported);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Export failed";
    const status =
      message.includes("Not allowed")
        ? 403
        : message.includes("not found")
          ? 404
          : 400;
    res.status(status).json({ error: message });
  }
});

app.post("/api/rooms", requireAuth, async (req, res) => {
  try {
    const runtime = req.body?.runtime === "cloud" ? "cloud" : "local";
    const authMode =
      runtime === "local" && !req.body?.authMode
        ? "cli"
        : parseAuthMode(req.body?.authMode);
    const orgIdRaw =
      typeof req.body?.orgId === "string" ? req.body.orgId.trim() : "";
    const orgId =
      orgIdRaw && orgIdRaw !== "personal" ? orgIdRaw : undefined;
    if (orgId && !db.isOrganizationMember(orgId, req.user!.id)) {
      res.status(403).json({ error: "Not a member of that organization" });
      return;
    }
    const controlModeRaw =
      typeof req.body?.controlMode === "string"
        ? req.body.controlMode.trim()
        : "";
    const approvalModeRaw =
      typeof req.body?.approvalMode === "string"
        ? req.body.approvalMode.trim()
        : "";
    const room = await roomManager.createRoom({
      name: req.body?.name,
      runtime,
      authMode,
      modelId: req.body?.modelId,
      repoPath: req.body?.repoPath,
      repoUrl: req.body?.repoUrl,
      startingRef: req.body?.startingRef,
      autoCreatePR: Boolean(req.body?.autoCreatePR),
      apiKey: req.body?.apiKey,
      ownerId: req.user!.id,
      orgId,
      backend:
        req.body?.backend === "claude-code" ? "claude-code" : "cursor",
      anthropicApiKey: req.body?.anthropicApiKey
        ? String(req.body.anthropicApiKey)
        : undefined,
      controlMode:
        controlModeRaw === "open" ||
        controlModeRaw === "driver" ||
        controlModeRaw === "host"
          ? controlModeRaw
          : undefined,
      planMode: Boolean(req.body?.planMode),
      approvalMode: approvalModeRaw || undefined,
    });
    res.status(201).json(room);
  } catch (err) {
    console.error("Failed to create room:", err);
    res.status(400).json({
      error: err instanceof Error ? err.message : "Failed to create room",
    });
  }
});

app.get("/api/rooms/:id/models", requireAuth, async (req, res) => {
  const id = routeParam(req.params.id);
  if (!roomManager.userCanAccessRoom(id, req.user!.id)) {
    res.status(404).json({ error: "Room not found" });
    return;
  }
  try {
    const agentId = req.query.agentId
      ? String(req.query.agentId)
      : undefined;
    const models = await roomManager.listModelsForRoom(id, agentId);
    res.setHeader("Cache-Control", "private, max-age=60");
    res.json({ models });
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : "Failed to list models",
    });
  }
});

app.patch("/api/rooms/:id/model", requireAuth, (req, res) => {
  const id = routeParam(req.params.id);
  if (!roomManager.userCanAccessRoom(id, req.user!.id)) {
    res.status(404).json({ error: "Room not found" });
    return;
  }
  try {
    const room = roomManager.setModel(
      id,
      String(req.body?.modelId || ""),
      req.user!.id,
      req.body?.agentId ? String(req.body.agentId) : undefined,
    );
    res.json(room);
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : "Failed to update model",
    });
  }
});

app.patch("/api/rooms/:id/cursor-session", requireAuth, (req, res) => {
  const id = routeParam(req.params.id);
  if (!roomManager.userCanAccessRoom(id, req.user!.id)) {
    res.status(404).json({ error: "Room not found" });
    return;
  }
  try {
    const raw = req.body?.cursorSessionId;
    const sessionId =
      raw === null || raw === undefined || raw === ""
        ? null
        : String(raw);
    const room = roomManager.setCursorSession(
      id,
      sessionId,
      req.user!.id,
      req.body?.agentId ? String(req.body.agentId) : undefined,
    );
    res.json(room);
  } catch (err) {
    res.status(400).json({
      error:
        err instanceof Error ? err.message : "Failed to update Cursor chat",
    });
  }
});

app.get("/api/rooms/:id/agents", requireAuth, (req, res) => {
  const id = routeParam(req.params.id);
  if (!roomManager.userCanAccessRoom(id, req.user!.id)) {
    res.status(404).json({ error: "Room not found" });
    return;
  }
  try {
    res.json(roomManager.listAgentInfos(id));
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : "Failed to list agents",
    });
  }
});

app.post("/api/rooms/:id/agents", requireAuth, (req, res) => {
  const id = routeParam(req.params.id);
  if (!roomManager.userCanAccessRoom(id, req.user!.id)) {
    res.status(404).json({ error: "Room not found" });
    return;
  }
  try {
    const agent = roomManager.addAgent(
      id,
      {
        backend: req.body?.backend,
        label: String(req.body?.label || "Agent"),
        scopePath: req.body?.scopePath
          ? String(req.body.scopePath)
          : undefined,
        modelId: req.body?.modelId ? String(req.body.modelId) : undefined,
        anthropicApiKey: req.body?.anthropicApiKey
          ? String(req.body.anthropicApiKey)
          : undefined,
        apiKey: req.body?.apiKey ? String(req.body.apiKey) : undefined,
        planMode: Boolean(req.body?.planMode),
      },
      req.user!.id,
    );
    res.status(201).json(agent);
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : "Failed to add agent",
    });
  }
});

app.post("/api/rooms/:id/agents/validate-scope", requireAuth, (req, res) => {
  const id = routeParam(req.params.id);
  if (!roomManager.userCanAccessRoom(id, req.user!.id)) {
    res.status(404).json({ error: "Room not found" });
    return;
  }
  const scopePath =
    req.body?.scopePath === null || req.body?.scopePath === undefined
      ? null
      : String(req.body.scopePath);
  const excludeAgentId = req.body?.excludeAgentId
    ? String(req.body.excludeAgentId)
    : undefined;
  const result = roomManager.validateAgentScope(id, scopePath, excludeAgentId);
  if (result.ok) {
    res.json({ ok: true });
    return;
  }
  res.status(409).json({ ok: false, error: result.error });
});

app.post("/api/rooms/:id/file-locks/force-release", requireAuth, (req, res) => {
  const id = routeParam(req.params.id);
  if (!roomManager.userCanAccessRoom(id, req.user!.id)) {
    res.status(404).json({ error: "Room not found" });
    return;
  }
  const path = req.body?.path ? String(req.body.path) : "";
  if (!path.trim()) {
    res.status(400).json({ error: "path is required" });
    return;
  }
  try {
    const released = roomManager.forceReleaseFileLock(
      id,
      path,
      req.user!.id,
    );
    res.json({ ok: true, released });
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : "Failed to release lock",
    });
  }
});

app.patch("/api/rooms/:id/agents/:agentId", requireAuth, (req, res) => {
  const id = routeParam(req.params.id);
  const agentId = routeParam(req.params.agentId);
  if (!roomManager.userCanAccessRoom(id, req.user!.id)) {
    res.status(404).json({ error: "Room not found" });
    return;
  }
  try {
    if (req.body?.modelId !== undefined) {
      roomManager.setModel(id, String(req.body.modelId), req.user!.id, agentId);
    }
    if (req.body?.cursorSessionId !== undefined) {
      const raw = req.body.cursorSessionId;
      const sessionId =
        raw === null || raw === "" ? null : String(raw);
      roomManager.setCursorSession(id, sessionId, req.user!.id, agentId);
    }
    if (req.body?.label !== undefined || req.body?.scopePath !== undefined) {
      roomManager.updateAgentMeta(
        id,
        agentId,
        {
          label: req.body?.label ? String(req.body.label) : undefined,
          scopePath:
            req.body?.scopePath !== undefined
              ? req.body.scopePath
                ? String(req.body.scopePath)
                : null
              : undefined,
        },
        req.user!.id,
      );
    }
    if (req.body?.planMode !== undefined) {
      roomManager.setAgentPlanMode(
        id,
        agentId,
        Boolean(req.body.planMode),
        req.user!.id,
      );
    }
    res.json(roomManager.listAgentInfos(id).find((a) => a.id === agentId));
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : "Failed to update agent",
    });
  }
});

app.post("/api/rooms/:id/agents/:agentId/stop", requireAuth, async (req, res) => {
  const id = routeParam(req.params.id);
  const agentId = routeParam(req.params.agentId);
  if (!roomManager.userCanAccessRoom(id, req.user!.id)) {
    res.status(404).json({ error: "Room not found" });
    return;
  }
  try {
    await roomManager.stopAgent(id, agentId, req.user!.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : "Failed to stop agent",
    });
  }
});

app.post("/api/rooms/:id/agents/:agentId/abort", requireAuth, async (req, res) => {
  const id = routeParam(req.params.id);
  const agentId = routeParam(req.params.agentId);
  if (!roomManager.userCanAccessRoom(id, req.user!.id)) {
    res.status(404).json({ error: "Room not found" });
    return;
  }
  try {
    await roomManager.abortRun(id, agentId, req.user!.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : "Failed to abort agent",
    });
  }
});

app.post("/api/rooms/:id/stop", requireAuth, (req, res) => {
  const id = routeParam(req.params.id);
  if (!roomManager.userCanAccessRoom(id, req.user!.id)) {
    res.status(404).json({ error: "Room not found" });
    return;
  }
  try {
    roomManager.stopRoom(id, req.user!.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : "Failed to stop room",
    });
  }
});

/**
 * POST /api/rooms/:id/abort — cancel the in-flight agent run (room stays open).
 * Aborts the default agent for backward compatibility.
 */
app.post("/api/rooms/:id/abort", requireAuth, async (req, res) => {
  const id = routeParam(req.params.id);
  if (!roomManager.userCanAccessRoom(id, req.user!.id)) {
    res.status(404).json({ error: "Room not found" });
    return;
  }
  try {
    await roomManager.abortRun(
      id,
      req.body?.agentId ? String(req.body.agentId) : undefined,
      req.user!.id,
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : "Failed to abort run",
    });
  }
});

/**
 * POST /api/rooms/:id/leave — member leaves (host cannot).
 */
app.post("/api/rooms/:id/leave", requireAuth, (req, res) => {
  const id = routeParam(req.params.id);
  if (roomManager.isRoomOwner(id, req.user!.id)) {
    res.status(400).json({ error: "Host cannot leave — stop the session instead" });
    return;
  }
  if (!roomManager.userCanAccessRoom(id, req.user!.id)) {
    res.status(404).json({ error: "Room not found" });
    return;
  }
  db.removeRoomMember(id, req.user!.id);
  roomManager.kickUserSockets(id, req.user!.id, "You left the session");
  roomManager.broadcastMembers(id);
  res.json({ ok: true });
});

/**
 * POST /api/rooms/:id/members/remove — host or org admin removes a member.
 * Body: { userId }
 */
app.post("/api/rooms/:id/members/remove", requireAuth, (req, res) => {
  const id = routeParam(req.params.id);
  if (!roomManager.userCanManageRoom(id, req.user!.id)) {
    res.status(403).json({
      error: "Only the host or a team admin can remove members",
    });
    return;
  }
  const targetUserId = String(req.body?.userId || "").trim();
  if (!targetUserId) {
    res.status(400).json({ error: "userId is required" });
    return;
  }
  if (targetUserId === req.user!.id) {
    res.status(400).json({ error: "Cannot remove yourself" });
    return;
  }
  if (roomManager.isRoomOwner(id, targetUserId)) {
    res.status(400).json({ error: "Cannot remove the host" });
    return;
  }
  db.removeRoomMember(id, targetUserId);
  roomManager.kickUserSockets(id, targetUserId, "Removed from the session");
  roomManager.broadcastMembers(id);
  res.json({ ok: true });
});

io.use((socket, next) => {
  const token =
    (socket.handshake.auth?.token as string | undefined) ||
    (typeof socket.handshake.headers.authorization === "string" &&
    socket.handshake.headers.authorization.startsWith("Bearer ")
      ? socket.handshake.headers.authorization.slice(7)
      : undefined);

  void resolveAuthToken(token).then((user) => {
    if (!user) {
      next(new Error("Authentication required"));
      return;
    }
    (socket.data as { userId?: string }).userId = user.id;
    next();
  });
});

io.on("connection", (socket) => {
  const roomId = socket.handshake.query.roomId as string;
  if (!roomId) {
    socket.emit("error", "Missing roomId");
    socket.disconnect();
    return;
  }

  const userId = (socket.data as { userId?: string }).userId;
  if (!userId || !roomManager.userCanAccessRoom(roomId, userId)) {
    socket.emit("error", "Not a member of this room");
    socket.disconnect();
    return;
  }

  const joined = roomManager.joinRoom(roomId, socket, userId);
  if (!joined) {
    socket.emit("error", "Room not found or not active");
    socket.disconnect();
    return;
  }

  socket.on("steer-message", (textOrAgentId, text) =>
    roomManager.handleSteerMessage(socket, textOrAgentId, text),
  );
  socket.on("typing", (agentId) => roomManager.handleTyping(socket, agentId));
  socket.on("typing-stop", (agentId) =>
    roomManager.handleTypingStop(socket, agentId),
  );
  socket.on("request-drive", (agentId) =>
    roomManager.handleRequestDrive(socket, agentId),
  );
  socket.on("grant-drive", (toSocketIdOrAgentId, toSocketId) =>
    roomManager.handleGrantDrive(socket, toSocketIdOrAgentId, toSocketId),
  );
  socket.on("release-drive", (agentId) =>
    roomManager.handleReleaseDrive(socket, agentId),
  );
  socket.on("tool-approval-decision", (requestId, approved) =>
    roomManager.handleToolApprovalDecision(socket, requestId, approved),
  );
  socket.on("flag-review", (payload) =>
    roomManager.handleFlagReview(socket, payload || {}),
  );
  socket.on("ack-review", (pingId) =>
    roomManager.handleAckReview(socket, String(pingId || "")),
  );
  socket.on("dismiss-review", (pingId) =>
    roomManager.handleDismissReview(socket, String(pingId || "")),
  );
  socket.on("leave-room", () => roomManager.handleLeaveRoom(socket));
  socket.on("remove-member", (targetUserId) =>
    roomManager.handleRemoveMember(socket, targetUserId),
  );
  socket.on("disconnect", () => roomManager.leaveRoom(socket));
});

void attachRedisAdapter().finally(() => {
  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`\n  Shared Agent Session API running at:`);
    console.log(`    Local:   http://localhost:${PORT}`);
    console.log(`    API:     http://localhost:${PORT}/api/rooms`);
    console.log(
      `    Auth:    serverKey=${serverKeyConfigured()} (${serverKeySource()}) encryption=${encryptionConfigured()}\n`,
    );
  });
});

process.on("SIGINT", () => {
  console.log("\nShutting down...");
  workerRelay.shutdown();
  roomManager.shutdown();
  httpServer.close();
  process.exit(0);
});
