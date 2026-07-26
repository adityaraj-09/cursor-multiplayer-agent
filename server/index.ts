import "dotenv/config";
import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { PORT } from "./config.js";
import { RoomManager } from "./roomManager.js";
import { listModelsForKey, listReposForKey } from "./sdkAgent.js";
import { listCliModels } from "./cliModels.js";
import { encryptionConfigured } from "./keyCrypto.js";
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

const app = express();
app.use(express.json({ limit: "1mb" }));

const httpServer = createServer(app);
const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  cors: { origin: "*", methods: ["GET", "POST"] },
  path: "/socket.io/",
});

const roomManager = new RoomManager(io);

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
app.post("/api/auth/server-key", (req, res) => {
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

app.delete("/api/auth/server-key", (_req, res) => {
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
      const models = await listCliModels();
      res.json({ models });
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

app.get("/api/rooms", (_req, res) => {
  res.json(roomManager.listRooms());
});

app.get("/api/rooms/:id", (req, res) => {
  const room = roomManager.getRoomInfo(req.params.id);
  if (!room) {
    res.status(404).json({ error: "Room not found" });
    return;
  }
  res.json(room);
});

app.post("/api/rooms", async (req, res) => {
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
    });
    res.status(201).json(room);
  } catch (err) {
    console.error("Failed to create room:", err);
    res.status(400).json({
      error: err instanceof Error ? err.message : "Failed to create room",
    });
  }
});

app.get("/api/rooms/:id/models", async (req, res) => {
  try {
    const models = await roomManager.listModelsForRoom(req.params.id);
    res.json({ models });
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : "Failed to list models",
    });
  }
});

app.patch("/api/rooms/:id/model", (req, res) => {
  try {
    const room = roomManager.setModel(
      req.params.id,
      String(req.body?.modelId || ""),
    );
    res.json(room);
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : "Failed to update model",
    });
  }
});

app.post("/api/rooms/:id/stop", (req, res) => {
  const room = roomManager.getRoomInfo(req.params.id);
  if (!room) {
    res.status(404).json({ error: "Room not found" });
    return;
  }
  roomManager.stopRoom(req.params.id);
  res.json({ ok: true });
});

io.on("connection", (socket) => {
  const roomId = socket.handshake.query.roomId as string;
  if (!roomId) {
    socket.emit("error", "Missing roomId");
    socket.disconnect();
    return;
  }

  const joined = roomManager.joinRoom(roomId, socket);
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
  roomManager.shutdown();
  httpServer.close();
  process.exit(0);
});
