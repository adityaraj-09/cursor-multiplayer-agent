import { Server, Socket } from "socket.io";
import { nanoid } from "nanoid";
import {
  ensureSession,
  killSession,
  sendKeys,
  hasSession,
  scrollHistory,
  exitCopyMode,
} from "./tmuxSession.js";
import { PtyRunner } from "./ptyRunner.js";
import { DiffWatcher } from "./diffWatcher.js";
import * as db from "./db.js";
import type {
  Participant,
  SteerLogEntry,
  RoomInfo,
  ServerToClientEvents,
  ClientToServerEvents,
} from "../shared/events.js";
import { AVATAR_COLORS } from "../shared/events.js";

const MAX_STEER_LENGTH = 2000;
const MAX_NAME_LENGTH = 30;

interface ParticipantInfo {
  name: string;
  color: string;
}

interface RoomState {
  id: string;
  repoPath: string;
  agentCommand: string;
  pty: PtyRunner;
  diffWatcher: DiffWatcher;
  participants: Map<string, ParticipantInfo>;
  driverSocketId: string | null;
  pendingDriveRequest: { socketId: string; name: string } | null;
  colorIndex: number;
  ptyCleanup: (() => void)[];
}

export class RoomManager {
  private rooms = new Map<string, RoomState>();
  private socketRooms = new Map<string, string>();

  constructor(
    private io: Server<ClientToServerEvents, ServerToClientEvents>,
  ) {
    this.restoreRooms();
  }

  private restoreRooms(): void {
    const rows = db.listRooms();
    for (const row of rows) {
      if (row.status === "active" && hasSession(row.id)) {
        try {
          this.initRoomState(row.id, row.repo_path, row.agent_command);
          console.log(`Restored room "${row.name}" (${row.id})`);
        } catch (err) {
          console.error(`Failed to restore room ${row.id}:`, err);
          db.updateRoomStatus(row.id, "stopped");
        }
      }
    }
  }

  createRoom(
    name: string,
    repoPath: string,
    agentCommand: string,
  ): RoomInfo {
    const id = nanoid(10);
    ensureSession(repoPath, id, agentCommand);
    const row = db.createRoom(id, name, repoPath, agentCommand);
    this.initRoomState(id, repoPath, agentCommand);
    console.log(`Created room "${name}" (${id}) in ${repoPath}`);
    return this.toRoomInfo(row, 0);
  }

  private initRoomState(
    id: string,
    repoPath: string,
    agentCommand: string,
  ): void {
    const pty = new PtyRunner(id);
    pty.attach();

    const diffWatcher = new DiffWatcher(repoPath);
    diffWatcher.start().catch((err) => console.error(`DiffWatcher error for ${id}:`, err));

    const cleanups: (() => void)[] = [];

    const ptyUnsub = pty.onData((data) => {
      this.io.to(id).emit("pty-output", data);
    });
    cleanups.push(ptyUnsub);

    const ptyExitUnsub = pty.onExit((code) => {
      console.log(`PTY for room ${id} exited (code ${code}), reattaching...`);
      setTimeout(() => {
        if (this.rooms.has(id)) pty.attach();
      }, 1000);
    });
    cleanups.push(ptyExitUnsub);

    const diffUnsub = diffWatcher.onDiff((patch) => {
      this.io.to(id).emit("diff-update", patch);
    });
    cleanups.push(diffUnsub);

    this.rooms.set(id, {
      id,
      repoPath,
      agentCommand,
      pty,
      diffWatcher,
      participants: new Map(),
      driverSocketId: null,
      pendingDriveRequest: null,
      colorIndex: 0,
      ptyCleanup: cleanups,
    });
  }

  joinRoom(roomId: string, socket: Socket): boolean {
    const room = this.rooms.get(roomId);
    if (!room) return false;

    const rawName = (socket.handshake.query.name as string) || "Anonymous";
    const name = rawName.trim().slice(0, MAX_NAME_LENGTH) || "Anonymous";
    const color = AVATAR_COLORS[room.colorIndex % AVATAR_COLORS.length];
    room.colorIndex++;

    room.participants.set(socket.id, { name, color });
    this.socketRooms.set(socket.id, roomId);
    socket.join(roomId);

    if (!room.driverSocketId) {
      room.driverSocketId = socket.id;
    }

    const scrollback = room.pty.getScrollback();
    if (scrollback) socket.emit("scrollback", scrollback);

    const lastPatch = room.diffWatcher.getLastPatch();
    if (lastPatch) socket.emit("diff-update", lastPatch);

    const steerHistory = db.getSteerHistory(roomId, 50);
    if (steerHistory.length > 0) socket.emit("steer-history", steerHistory);

    this.broadcastPresence(room);
    db.updateRoomActivity(roomId);

    console.log(`${name} joined room ${roomId} (${socket.id})`);
    return true;
  }

  leaveRoom(socket: Socket): void {
    const roomId = this.socketRooms.get(socket.id);
    if (!roomId) return;

    const room = this.rooms.get(roomId);
    if (!room) return;

    const p = room.participants.get(socket.id);
    room.participants.delete(socket.id);
    this.socketRooms.delete(socket.id);

    if (socket.id === room.driverSocketId) {
      room.driverSocketId = null;
      if (
        room.pendingDriveRequest &&
        room.participants.has(room.pendingDriveRequest.socketId)
      ) {
        room.driverSocketId = room.pendingDriveRequest.socketId;
        const granted = this.io.sockets.sockets.get(room.driverSocketId);
        if (granted) granted.emit("drive-granted");
        room.pendingDriveRequest = null;
      } else {
        for (const [sid] of room.participants) {
          room.driverSocketId = sid;
          break;
        }
      }
    }

    if (
      room.pendingDriveRequest &&
      room.pendingDriveRequest.socketId === socket.id
    ) {
      room.pendingDriveRequest = null;
    }

    this.broadcastPresence(room);
    console.log(`${p?.name || "Unknown"} left room ${roomId}`);
  }

  handlePtyInput(socket: Socket, data: string): void {
    const room = this.getRoomForSocket(socket.id);
    if (!room) return;

    if (socket.id !== room.driverSocketId) {
      socket.emit("error", "Only the driver can send raw keystrokes");
      return;
    }
    // Leave history-scroll mode so keystrokes reach the agent
    exitCopyMode(room.id);
    room.pty.write(data);
  }

  /** Anyone can scroll conversation history (tmux copy-mode). */
  handleScrollHistory(
    socket: Socket,
    direction: "up" | "down",
    lines?: number,
  ): void {
    const room = this.getRoomForSocket(socket.id);
    if (!room) return;
    if (direction !== "up" && direction !== "down") return;
    try {
      scrollHistory(room.id, direction, lines ?? 3);
    } catch (err) {
      console.error("scroll-history error:", err);
    }
  }

  handleSteerMessage(socket: Socket, text: string): void {
    const room = this.getRoomForSocket(socket.id);
    if (!room) return;
    if (!text || typeof text !== "string") return;

    const sanitized = text.slice(0, MAX_STEER_LENGTH);

    try {
      sendKeys(room.id, sanitized);
    } catch {
      room.pty.write(sanitized + "\r");
    }

    const p = room.participants.get(socket.id);
    const entry: SteerLogEntry = {
      sender: p?.name || "Unknown",
      color: p?.color || "#888",
      text: sanitized,
      ts: Date.now(),
    };

    db.insertSteerMessage(room.id, entry.sender, entry.color, entry.text, entry.ts);
    this.io.to(room.id).emit("steer-log", entry);
    db.updateRoomActivity(room.id);
  }

  handleRequestDrive(socket: Socket): void {
    const room = this.getRoomForSocket(socket.id);
    if (!room) return;
    const p = room.participants.get(socket.id);
    if (!p) return;

    if (!room.driverSocketId || room.driverSocketId === socket.id) {
      room.driverSocketId = socket.id;
      this.broadcastPresence(room);
      socket.emit("drive-granted");
      return;
    }

    room.pendingDriveRequest = { socketId: socket.id, name: p.name };
    const driverSocket = this.io.sockets.sockets.get(room.driverSocketId);
    if (driverSocket) {
      driverSocket.emit("drive-requested", p.name);
    }
  }

  handleGrantDrive(socket: Socket, toSocketId: string): void {
    const room = this.getRoomForSocket(socket.id);
    if (!room) return;
    if (socket.id !== room.driverSocketId) return;
    if (!room.participants.has(toSocketId)) return;

    room.driverSocketId = toSocketId;
    room.pendingDriveRequest = null;
    this.broadcastPresence(room);
    const granted = this.io.sockets.sockets.get(toSocketId);
    if (granted) granted.emit("drive-granted");
  }

  handleReleaseDrive(socket: Socket): void {
    const room = this.getRoomForSocket(socket.id);
    if (!room) return;
    if (socket.id !== room.driverSocketId) return;

    if (
      room.pendingDriveRequest &&
      room.participants.has(room.pendingDriveRequest.socketId)
    ) {
      room.driverSocketId = room.pendingDriveRequest.socketId;
      const granted = this.io.sockets.sockets.get(room.driverSocketId);
      if (granted) granted.emit("drive-granted");
      room.pendingDriveRequest = null;
    } else {
      room.driverSocketId = null;
      for (const [sid] of room.participants) {
        if (sid !== socket.id) {
          room.driverSocketId = sid;
          break;
        }
      }
    }

    this.broadcastPresence(room);
    this.io.to(room.id).emit("drive-released");
  }

  handleResize(socket: Socket, cols: number, rows: number): void {
    const room = this.getRoomForSocket(socket.id);
    if (!room) return;
    if (typeof cols === "number" && typeof rows === "number" && cols > 0 && rows > 0) {
      room.pty.resize(cols, rows);
    }
  }

  listRooms(): RoomInfo[] {
    const rows = db.listRooms();
    return rows.map((row) => {
      const room = this.rooms.get(row.id);
      return this.toRoomInfo(row, room?.participants.size || 0);
    });
  }

  getRoomInfo(id: string): RoomInfo | null {
    const row = db.getRoom(id);
    if (!row) return null;
    const room = this.rooms.get(id);
    return this.toRoomInfo(row, room?.participants.size || 0);
  }

  stopRoom(id: string): void {
    const room = this.rooms.get(id);
    if (room) {
      for (const unsub of room.ptyCleanup) unsub();
      room.pty.destroy();
      room.diffWatcher.stop();
      this.rooms.delete(id);
    }
    killSession(id);
    db.updateRoomStatus(id, "stopped");
  }

  shutdown(): void {
    for (const [id] of this.rooms) {
      const room = this.rooms.get(id);
      if (room) {
        for (const unsub of room.ptyCleanup) unsub();
        room.pty.destroy();
        room.diffWatcher.stop();
      }
    }
    this.rooms.clear();
  }

  private getRoomForSocket(socketId: string): RoomState | undefined {
    const roomId = this.socketRooms.get(socketId);
    if (!roomId) return undefined;
    return this.rooms.get(roomId);
  }

  private broadcastPresence(room: RoomState): void {
    const list: Participant[] = [];
    for (const [socketId, p] of room.participants) {
      list.push({
        socketId,
        name: p.name,
        color: p.color,
        isDriver: socketId === room.driverSocketId,
      });
    }
    this.io.to(room.id).emit("presence", list);
  }

  private toRoomInfo(row: db.RoomRow, participantCount: number): RoomInfo {
    return {
      id: row.id,
      name: row.name,
      repoPath: row.repo_path,
      agentCommand: row.agent_command,
      participantCount,
      status: row.status,
      createdAt: row.created_at,
    };
  }
}
