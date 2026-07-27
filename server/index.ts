import "dotenv/config";
import express from "express";
import cors from "cors";
import { createServer } from "http";
import { Server } from "socket.io";
import { PORT, IS_PRODUCTION, CORS_ORIGINS } from "./config.js";
import { RoomManager } from "./roomManager.js";
import { WorkerRelay } from "./workerRelay.js";
import { listModelsForKey, listReposForKey } from "./sdkAgent.js";
import { listCliModels } from "./cliModels.js";
import { encryptionConfigured } from "./keyCrypto.js";
import { authMiddleware, hashSessionToken, requireAuth, resolveAuthToken } from "./auth.js";
import authRoutes from "./authRoutes.js";
import * as db from "./db.js";
import {
  clearServerApiKey,
  getServerApiKey,
  serverKeyConfigured,
  serverKeyHint,
  serverKeySource,
  setServerApiKey,
} from "./serverKey.js";
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
});

const roomManager = new RoomManager(io, workerRelay);

function resolveRequestKey(
  authMode: AuthMode,
  bodyKey?: string,
  headerKey?: string,
): string {
  if (authMode === "cli") {
    throw new Error("CLI auth does not use an API key");
  }
  if (authMode === "byok") {
    const key = (bodyKey || headerKey || "").trim();
    if (!key) throw new Error("BYOK requires an API key");
    return key;
  }
  const serverKey = getServerApiKey();
  if (!serverKey) {
    throw new Error("Server API key is not configured");
  }
  return serverKey;
}

// User auth routes
app.use("/api/auth", authRoutes);

app.get("/api/auth/status", (_req, res) => {
  res.json({
    serverKeyConfigured: serverKeyConfigured(),
    serverKeySource: serverKeySource(),
    serverKeyHint: serverKeyHint(),
    encryptionConfigured: encryptionConfigured(),
    byokAvailable: encryptionConfigured(),
  });
});

/** Pick up / replace the shared server API key (encrypted in DB). */
app.post("/api/auth/server-key", requireAuth, (req, res) => {
  try {
    const apiKey = String(req.body?.apiKey || "").trim();
    const result = setServerApiKey(apiKey);
    res.json({
      ok: true,
      serverKeyConfigured: true,
      serverKeySource: serverKeySource(),
      serverKeyHint: result.hint,
    });
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : "Failed to save server key",
    });
  }
});

app.delete("/api/auth/server-key", requireAuth, (_req, res) => {
  clearServerApiKey();
  res.json({
    ok: true,
    serverKeyConfigured: serverKeyConfigured(),
    serverKeySource: serverKeySource(),
    serverKeyHint: serverKeyHint(),
  });
});

app.post("/api/models", async (req, res) => {
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
    );
    const models = await listModelsForKey(apiKey);
    res.json({ models });
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : "Failed to list models",
    });
  }
});

app.post("/api/repositories", async (req, res) => {
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

app.get("/api/rooms", requireAuth, (req, res) => {
  res.json(roomManager.listRoomsForUser(req.user!.id));
});

app.get("/api/rooms/:id", requireAuth, (req, res) => {
  const id = routeParam(req.params.id);
  if (!roomManager.userCanAccessRoom(id, req.user!.id)) {
    res.status(404).json({ error: "Room not found" });
    return;
  }
  const room = roomManager.getRoomInfo(id);
  if (!room) {
    res.status(404).json({ error: "Room not found" });
    return;
  }
  res.json(room);
});

/**
 * POST /api/rooms/:id/join — signed-in user becomes a member via shared link.
 */
app.post("/api/rooms/:id/join", requireAuth, (req, res) => {
  try {
    const room = roomManager.joinAsMember(routeParam(req.params.id), req.user!.id);
    res.json(room);
  } catch (err) {
    res.status(404).json({
      error: err instanceof Error ? err.message : "Room not found",
    });
  }
});

app.post("/api/rooms", requireAuth, async (req, res) => {
  try {
    const runtime = req.body?.runtime === "cloud" ? "cloud" : "local";
    const authMode =
      runtime === "local" && !req.body?.authMode
        ? "cli"
        : parseAuthMode(req.body?.authMode);
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
    const models = await roomManager.listModelsForRoom(id);
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
    );
    res.json(room);
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : "Failed to update model",
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
  res.json({ ok: true });
});

/**
 * POST /api/rooms/:id/members/remove — host removes a member.
 * Body: { userId }
 */
app.post("/api/rooms/:id/members/remove", requireAuth, (req, res) => {
  const id = routeParam(req.params.id);
  if (!roomManager.isRoomOwner(id, req.user!.id)) {
    res.status(403).json({ error: "Only the host can remove members" });
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
  db.removeRoomMember(id, targetUserId);
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

  socket.on("steer-message", (text) =>
    roomManager.handleSteerMessage(socket, text),
  );
  socket.on("request-drive", () => roomManager.handleRequestDrive(socket));
  socket.on("grant-drive", (toId) =>
    roomManager.handleGrantDrive(socket, toId),
  );
  socket.on("release-drive", () => roomManager.handleReleaseDrive(socket));
  socket.on("leave-room", () => roomManager.handleLeaveRoom(socket));
  socket.on("remove-member", (targetUserId) =>
    roomManager.handleRemoveMember(socket, targetUserId),
  );
  socket.on("disconnect", () => roomManager.leaveRoom(socket));
});

httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`\n  Shared Agent Session API running at:`);
  console.log(`    Local:   http://localhost:${PORT}`);
  console.log(`    API:     http://localhost:${PORT}/api/rooms`);
  console.log(
    `    Auth:    serverKey=${serverKeyConfigured()} (${serverKeySource()}) encryption=${encryptionConfigured()}\n`,
  );
});

process.on("SIGINT", () => {
  console.log("\nShutting down...");
  workerRelay.shutdown();
  roomManager.shutdown();
  httpServer.close();
  process.exit(0);
});
