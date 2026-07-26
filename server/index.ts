import "dotenv/config";
import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { existsSync } from "fs";
import { resolve } from "path";

import { PORT, DEFAULT_REPO_PATH, DEFAULT_AGENT_COMMAND } from "./config.js";
import { RoomManager } from "./roomManager.js";
import type {
  ServerToClientEvents,
  ClientToServerEvents,
} from "../shared/events.js";

const app = express();
app.use(express.json());

const httpServer = createServer(app);

const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  cors: { origin: "*" },
  maxHttpBufferSize: 1e6,
});

const roomManager = new RoomManager(io);

// --- REST API ---

app.get("/api/rooms", (_req, res) => {
  const rooms = roomManager.listRooms();
  res.json(rooms);
});

app.get("/api/rooms/:id", (req, res) => {
  const room = roomManager.getRoomInfo(req.params.id);
  if (!room) {
    res.status(404).json({ error: "Room not found" });
    return;
  }
  res.json(room);
});

app.post("/api/rooms", (req, res) => {
  const { name, repoPath, agentCommand } = req.body;

  if (!name || typeof name !== "string" || name.trim().length === 0) {
    res.status(400).json({ error: "name is required" });
    return;
  }

  const finalRepoPath = resolve(repoPath || DEFAULT_REPO_PATH);
  if (!existsSync(finalRepoPath)) {
    res.status(400).json({ error: `Repository path does not exist: ${finalRepoPath}` });
    return;
  }

  const finalCommand = agentCommand || DEFAULT_AGENT_COMMAND;

  try {
    const room = roomManager.createRoom(name.trim(), finalRepoPath, finalCommand);
    res.status(201).json(room);
  } catch (err) {
    console.error("Failed to create room:", err);
    res.status(500).json({ error: "Failed to create room" });
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

// --- Socket.IO ---

io.on("connection", (socket) => {
  const roomId = socket.handshake.query.roomId as string;
  if (!roomId) {
    socket.emit("error", "roomId is required");
    socket.disconnect();
    return;
  }

  const joined = roomManager.joinRoom(roomId, socket);
  if (!joined) {
    socket.emit("error", "Room not found or not active");
    socket.disconnect();
    return;
  }

  socket.on("pty-input", (data) => roomManager.handlePtyInput(socket, data));
  socket.on("steer-message", (text) => roomManager.handleSteerMessage(socket, text));
  socket.on("request-drive", () => roomManager.handleRequestDrive(socket));
  socket.on("grant-drive", (toId) => roomManager.handleGrantDrive(socket, toId));
  socket.on("release-drive", () => roomManager.handleReleaseDrive(socket));
  socket.on("resize", (cols, rows) => roomManager.handleResize(socket, cols, rows));
  socket.on("scroll-history", (direction, lines) =>
    roomManager.handleScrollHistory(socket, direction, lines),
  );
  socket.on("disconnect", () => roomManager.leaveRoom(socket));
});

// --- Start ---

httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`\n  Shared Agent Session API running at:`);
  console.log(`    Local:   http://localhost:${PORT}`);
  console.log(`    API:     http://localhost:${PORT}/api/rooms\n`);
});

process.on("SIGINT", () => {
  console.log("\nShutting down...");
  roomManager.shutdown();
  httpServer.close();
  process.exit(0);
});
