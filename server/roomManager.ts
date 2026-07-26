import { Server, Socket } from "socket.io";
import { nanoid } from "nanoid";
import { resolve } from "path";
import { existsSync } from "fs";
import { AgentRunner } from "./agentRunner.js";
import {
  SdkAgentSession,
  listModelsForKey,
  type SdkStreamEvent,
} from "./sdkAgent.js";
import { DiffWatcher } from "./diffWatcher.js";
import { extractToolPath, getFileDiff, isEditTool } from "./gitDiff.js";
import { listCliModels } from "./cliModels.js";
import { WorkerRelay } from "./workerRelay.js";
import * as db from "./db.js";
import {
  DEFAULT_AGENT_COMMAND,
  DEFAULT_MODEL,
  DEFAULT_REPO_PATH,
  IS_PRODUCTION,
} from "./config.js";
import {
  decryptApiKey,
  encryptApiKey,
  encryptionConfigured,
  maskApiKey,
} from "./keyCrypto.js";
import { getServerApiKey } from "./serverKey.js";
import type {
  AgentRuntime,
  AuthMode,
  AgentStreamEventPayload,
  ChatMessage,
  CloudMeta,
  ModelInfo,
  Participant,
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

export interface CreateRoomRequest {
  name: string;
  runtime: AgentRuntime;
  authMode: AuthMode;
  modelId?: string;
  repoPath?: string;
  repoUrl?: string;
  startingRef?: string;
  autoCreatePR?: boolean;
  apiKey?: string;
}

type AgentBackend = AgentRunner | SdkAgentSession;

interface RoomState {
  id: string;
  row: db.RoomRow;
  agent: AgentBackend;
  diffWatcher: DiffWatcher | null;
  participants: Map<string, ParticipantInfo>;
  driverSocketId: string | null;
  pendingDriveRequest: { socketId: string; name: string } | null;
  colorIndex: number;
  cleanups: (() => void)[];
  toolMsgIds: Map<string, string>;
  toolPaths: Map<string, string>;
  cloudMeta: CloudMeta;
}

function normalizeAuthMode(
  runtime: AgentRuntime,
  raw: AuthMode | string | undefined,
): AuthMode {
  if (runtime === "local" && (raw === "cli" || !raw)) return "cli";
  if (raw === "byok") return "byok";
  if (raw === "cli") {
    if (runtime === "cloud") {
      throw new Error("CLI login auth is only available for local runtime");
    }
    return "cli";
  }
  return "server";
}

function resolveApiKey(row: db.RoomRow): string {
  if (row.auth_mode === "cli") {
    throw new Error("CLI auth does not use an API key");
  }
  if (row.auth_mode === "byok") {
    if (!row.key_ciphertext) {
      throw new Error("BYOK room is missing encrypted API key");
    }
    return decryptApiKey(row.key_ciphertext);
  }
  const serverKey = getServerApiKey();
  if (!serverKey) {
    throw new Error(
      "Server API key is not configured — set CURSOR_API_KEY or pick one up in Create session",
    );
  }
  return serverKey;
}

export class RoomManager {
  private rooms = new Map<string, RoomState>();
  private socketRooms = new Map<string, string>();

  constructor(
    private io: Server<ClientToServerEvents, ServerToClientEvents>,
    private workerRelay?: WorkerRelay,
  ) {
    this.restoreRooms();
  }

  private restoreRooms(): void {
    for (const row of db.listRooms()) {
      if (row.status !== "active") continue;
      try {
        this.initRoomState(row);
        console.log(`Restored room "${row.name}" (${row.id})`);
      } catch (err) {
        console.error(`Failed to restore room ${row.id}:`, err);
        db.updateRoomStatus(row.id, "stopped");
      }
    }
  }

  async createRoom(req: CreateRoomRequest): Promise<RoomInfo> {
    const name = req.name.trim();
    if (!name) throw new Error("name is required");

    const runtime: AgentRuntime = req.runtime === "cloud" ? "cloud" : "local";
    const authMode = normalizeAuthMode(runtime, req.authMode);
    const modelId =
      (req.modelId || (authMode === "cli" ? "auto" : DEFAULT_MODEL)).trim() ||
      (authMode === "cli" ? "auto" : DEFAULT_MODEL);

    let keyCiphertext: string | null = null;
    let keyHint: string | null = null;
    let apiKey = "";

    if (authMode === "byok") {
      const raw = req.apiKey?.trim();
      if (!raw) throw new Error("apiKey is required for BYOK");
      if (!encryptionConfigured()) {
        throw new Error("KEY_ENCRYPTION_SECRET is not configured on the server");
      }
      keyCiphertext = encryptApiKey(raw);
      keyHint = maskApiKey(raw);
      apiKey = raw;
    } else if (authMode === "server") {
      apiKey = getServerApiKey();
      if (!apiKey) {
        throw new Error(
          "Server key is not configured — set CURSOR_API_KEY or pick one up in Create session",
        );
      }
    }

    let repoPath = DEFAULT_REPO_PATH;
    let repoUrl: string | null = null;
    let startingRef: string | null = null;
    const autoCreatePR = Boolean(req.autoCreatePR);

    if (runtime === "local") {
      const raw = req.repoPath?.trim() || DEFAULT_REPO_PATH;
      // Absolute paths come from the CLI worker folder picker (exist on the
      // worker machine, not necessarily on this server).
      repoPath = raw.startsWith("/") || /^[A-Za-z]:[\\/]/.test(raw)
        ? raw
        : resolve(raw);
      if (authMode !== "cli" && !existsSync(repoPath)) {
        throw new Error(`Repo path does not exist: ${repoPath}`);
      }
      if (authMode === "cli" && !repoPath) {
        throw new Error("Select a repository folder");
      }
    } else {
      repoUrl = req.repoUrl?.trim() || "";
      if (!repoUrl) throw new Error("repoUrl is required for cloud runtime");
      if (!/^https:\/\/github\.com\//i.test(repoUrl)) {
        throw new Error("Cloud repoUrl must be an https://github.com/... URL");
      }
      startingRef = req.startingRef?.trim() || "main";
      repoPath = ""; // not used for cloud
    }

    const id = nanoid(10);
    let cursorAgentId: string | null = null;
    let agent: AgentBackend;

    if (authMode === "cli") {
      agent = new AgentRunner(repoPath, null, modelId);
    } else {
      const sdk = new SdkAgentSession({
        runtime,
        apiKey,
        model: { id: modelId },
        name,
        localCwd: runtime === "local" ? repoPath : undefined,
        repoUrl: runtime === "cloud" ? repoUrl! : undefined,
        startingRef: startingRef || undefined,
        autoCreatePR,
      });
      cursorAgentId = await sdk.ensureStarted();
      agent = sdk;
    }

    const row = db.createRoom({
      id,
      name,
      repoPath: repoPath || repoUrl || "",
      agentCommand: DEFAULT_AGENT_COMMAND,
      runtime,
      authMode,
      modelId,
      repoUrl,
      startingRef,
      cursorAgentId,
      autoCreatePR,
      keyCiphertext,
      keyHint,
    });

    this.initRoomState(row, agent);
    console.log(
      `Created ${runtime}/${authMode} room "${name}" (${id}) model=${modelId}`,
    );
    return this.toRoomInfo(row, 0);
  }

  private initRoomState(row: db.RoomRow, existing?: AgentBackend): void {
    let agent: AgentBackend;
    if (existing) {
      agent = existing;
    } else if (row.auth_mode === "cli") {
      agent = new AgentRunner(
        row.repo_path,
        row.cursor_session_id,
        row.model_id || "auto",
      );
    } else {
      const apiKey = resolveApiKey(row);
      agent = new SdkAgentSession({
        runtime: row.runtime === "cloud" ? "cloud" : "local",
        apiKey,
        model: { id: row.model_id || DEFAULT_MODEL },
        name: row.name,
        agentId: row.cursor_agent_id,
        localCwd: row.runtime === "local" ? row.repo_path : undefined,
        repoUrl: row.repo_url || undefined,
        startingRef: row.starting_ref || undefined,
        autoCreatePR: Boolean(row.auto_create_pr),
      });
    }

    let diffWatcher: DiffWatcher | null = null;
    const cleanups: (() => void)[] = [];

    if (row.runtime === "local" && row.repo_path) {
      diffWatcher = new DiffWatcher(row.repo_path);
      diffWatcher
        .start()
        .catch((err) =>
          console.error(`DiffWatcher error for ${row.id}:`, err),
        );
      cleanups.push(() => {
        void diffWatcher?.stop();
      });
      const unsub = diffWatcher.onDiff((patch) => {
        this.io.to(row.id).emit("diff-update", patch);
      });
      cleanups.push(unsub);
    }

    this.rooms.set(row.id, {
      id: row.id,
      row,
      agent,
      diffWatcher,
      participants: new Map(),
      driverSocketId: null,
      pendingDriveRequest: null,
      colorIndex: 0,
      cleanups,
      toolMsgIds: new Map(),
      toolPaths: new Map(),
      cloudMeta: {
        repoUrl: row.repo_url || undefined,
        startingRef: row.starting_ref || undefined,
        prUrl: row.pr_url || undefined,
        autoCreatePR: Boolean(row.auto_create_pr),
      },
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

    if (!room.driverSocketId) room.driverSocketId = socket.id;

    socket.emit("chat-history", db.getMessages(roomId, 500));

    if (room.diffWatcher) {
      const lastPatch = room.diffWatcher.getLastPatch();
      if (lastPatch) socket.emit("diff-update", lastPatch);
    }

    if (room.row.runtime === "cloud") {
      socket.emit("cloud-meta", room.cloudMeta);
    }

    socket.emit("agent-status", room.agent.isBusy() ? "running" : "idle");
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

  handleSteerMessage(socket: Socket, text: string): void {
    const room = this.getRoomForSocket(socket.id);
    if (!room) return;
    if (!text || typeof text !== "string") return;

    const sanitized = text.slice(0, MAX_STEER_LENGTH).trim();
    if (!sanitized) return;

    const p = room.participants.get(socket.id);
    const userMsg: ChatMessage = {
      id: nanoid(12),
      roomId: room.id,
      role: "user",
      content: sanitized,
      senderName: p?.name || "Unknown",
      senderColor: p?.color || "#888",
      status: "done",
      ts: Date.now(),
    };

    db.insertMessage(userMsg);
    this.io.to(room.id).emit("chat-message", userMsg);
    db.updateRoomActivity(room.id);
    void this.runAgent(room, sanitized);
  }

  /**
   * Dispatch a local room's prompt to a connected CLI worker.
   * Returns true if dispatched, false if no worker available (falls back to in-process).
   */
  private tryDispatchToWorker(room: RoomState, prompt: string): boolean {
    if (!this.workerRelay) return false;
    if (room.row.auth_mode !== "cli") return false;
    if (room.row.runtime !== "local") return false;

    const ownerId = room.row.owner_id ?? undefined;
    if (!ownerId) return false;

    const worker = this.workerRelay.findWorkerForUser(ownerId);
    if (!worker) return false;

    this.io.to(room.id).emit("agent-status", "running");

    let assistantId: string | null = null;
    let assistantContent = "";
    let seenFullText = "";
    let bubbleBaseLen = 0;
    let afterTools = false;
    room.toolMsgIds.clear();
    room.toolPaths.clear();

    const closeAssistant = (status: ChatMessage["status"] = "done") => {
      if (!assistantId) return;
      db.updateMessageContent(assistantId, assistantContent, status);
      this.io.to(room.id).emit("chat-delta", assistantId, assistantContent, status);
      assistantId = null;
      assistantContent = "";
    };

    const emitAssistantFromWorker = (text: string, status: ChatMessage["status"]) => {
      if (afterTools) {
        closeAssistant("done");
        afterTools = false;
        bubbleBaseLen = seenFullText.length;
      }
      if (!assistantId) {
        let display = "";
        if (seenFullText && text.startsWith(seenFullText)) {
          display = text.slice(seenFullText.length).replace(/^\n+/, "");
        } else if (!text || text === seenFullText) {
          display = "";
        } else {
          display = text;
        }
        if (!display) {
          if (text.length > seenFullText.length) seenFullText = text;
          return;
        }
        bubbleBaseLen = seenFullText.length;
        const msg: ChatMessage = {
          id: nanoid(12),
          roomId: room.id,
          role: "assistant",
          content: display,
          status,
          ts: Date.now(),
        };
        assistantId = msg.id;
        assistantContent = display;
        seenFullText = text.startsWith(seenFullText)
          ? text
          : seenFullText ? `${seenFullText}\n${text}` : text;
        db.insertMessage(msg);
        this.io.to(room.id).emit("chat-message", msg);
        return;
      }
      let display: string;
      if (text.length >= bubbleBaseLen) {
        display = text.slice(bubbleBaseLen).replace(/^\n+/, "");
        seenFullText = text.length >= seenFullText.length ? text : seenFullText;
      } else {
        display = text;
        seenFullText = text;
      }
      assistantContent = display || assistantContent;
      db.updateMessageContent(assistantId, assistantContent, status);
      this.io.to(room.id).emit("chat-delta", assistantId, assistantContent, status);
    };

    const unsubEvent = this.workerRelay.onAgentEvent(room.id, (_roomId, event) => {
      switch (event.kind) {
        case "session":
          if (event.sessionId) {
            db.setCursorSessionId(room.id, event.sessionId);
            room.row.cursor_session_id = event.sessionId;
          }
          break;
        case "assistant_delta":
        case "assistant_final":
          emitAssistantFromWorker(
            event.text || "",
            event.kind === "assistant_final" ? "done" : "streaming",
          );
          break;
        case "tool_start": {
          closeAssistant("done");
          afterTools = true;
          bubbleBaseLen = seenFullText.length;
          const msg: ChatMessage = {
            id: nanoid(12),
            roomId: room.id,
            role: "tool",
            content: event.detail || "Running…",
            toolName: event.name || "tool",
            status: "streaming",
            ts: Date.now(),
          };
          if (event.callId) room.toolMsgIds.set(event.callId, msg.id);
          if (event.path && event.callId) room.toolPaths.set(event.callId, event.path);
          db.insertMessage(msg);
          this.io.to(room.id).emit("chat-message", msg);
          break;
        }
        case "tool_done": {
          const id = event.callId ? room.toolMsgIds.get(event.callId) : undefined;
          if (id) {
            const content = event.detail || "Done";
            db.updateMessageContent(id, content, "done");
            this.io.to(room.id).emit("chat-message", {
              id,
              roomId: room.id,
              role: "tool",
              content,
              toolName: event.name || "tool",
              status: "done",
              ts: Date.now(),
            });
          }
          afterTools = true;
          break;
        }
        case "error":
          emitAssistantFromWorker(event.message || "Unknown error", "error");
          this.io.to(room.id).emit("agent-status", "error", event.message);
          break;
        case "done":
          emitAssistantFromWorker(event.result || "", "done");
          closeAssistant("done");
          this.io.to(room.id).emit("agent-status", "idle");
          this.workerRelay?.releaseWorker(room.id);
          unsubEvent();
          unsubDiff();
          break;
      }
    });

    const unsubDiff = this.workerRelay.onFileDiff(room.id, (_roomId, msgId, toolName, path, patch) => {
      db.updateMessageDiff(msgId, path, "done", patch);
      this.io.to(room.id).emit("chat-message", {
        id: msgId,
        roomId: room.id,
        role: "tool",
        content: path,
        toolName,
        diffPatch: patch,
        status: "done",
        ts: Date.now(),
      });
    });

    const dispatched = this.workerRelay.dispatchToWorker(
      room.id,
      worker.workerId,
      prompt,
      room.row.repo_path,
      room.row.model_id || "auto",
      room.row.cursor_session_id,
    );

    if (!dispatched) {
      unsubEvent();
      unsubDiff();
      return false;
    }

    return true;
  }

  private async runAgent(room: RoomState, prompt: string): Promise<void> {
    // Try dispatching to a connected CLI worker first (production local rooms)
    if (this.tryDispatchToWorker(room, prompt)) return;

    this.io.to(room.id).emit("agent-status", "running");

    let assistantId: string | null = null;
    let assistantContent = "";
    let seenFullText = "";
    let bubbleBaseLen = 0;
    let afterTools = false;
    room.toolMsgIds.clear();
    room.toolPaths.clear();

    const attachFileDiff = async (
      msgId: string,
      toolName: string,
      detail: string,
      pathHint?: string,
    ) => {
      if (room.row.runtime !== "local" || !room.row.repo_path) return;
      if (!isEditTool(toolName)) return;
      const path = pathHint || extractToolPath(detail);
      if (!path) return;

      // Small delay so the filesystem / git index settle after the write
      await new Promise((r) => setTimeout(r, 120));
      const patch = await getFileDiff(room.row.repo_path, path);
      if (!patch) return;

      const content = detail || path;
      db.updateMessageDiff(msgId, content, "done", patch);
      this.io.to(room.id).emit("chat-message", {
        id: msgId,
        roomId: room.id,
        role: "tool",
        content,
        toolName,
        diffPatch: patch,
        status: "done",
        ts: Date.now(),
      });
    };

    const closeAssistant = (status: ChatMessage["status"] = "done") => {
      if (!assistantId) return;
      db.updateMessageContent(assistantId, assistantContent, status);
      this.io.to(room.id).emit(
        "chat-delta",
        assistantId,
        assistantContent,
        status,
      );
      assistantId = null;
      assistantContent = "";
    };

    const emitAssistant = (
      incoming: string,
      status: ChatMessage["status"],
    ) => {
      const text = incoming ?? "";

      if (afterTools) {
        closeAssistant("done");
        afterTools = false;
        bubbleBaseLen = seenFullText.length;
      }

      if (!assistantId) {
        let display = "";
        if (seenFullText && text.startsWith(seenFullText)) {
          display = text.slice(seenFullText.length).replace(/^\n+/, "");
        } else if (!text || text === seenFullText) {
          display = "";
        } else {
          display = text;
        }

        if (!display) {
          if (text.length > seenFullText.length) seenFullText = text;
          return;
        }

        bubbleBaseLen = seenFullText.length;
        const msg: ChatMessage = {
          id: nanoid(12),
          roomId: room.id,
          role: "assistant",
          content: display,
          status,
          ts: Date.now(),
        };
        assistantId = msg.id;
        assistantContent = display;
        seenFullText = text.startsWith(seenFullText)
          ? text
          : seenFullText
            ? `${seenFullText}\n${text}`
            : text;
        db.insertMessage(msg);
        this.io.to(room.id).emit("chat-message", msg);
        return;
      }

      // Same bubble — prefer segment slice when the agent sends a cumulative buffer
      let display: string;
      if (text.length >= bubbleBaseLen && (
        text.startsWith(seenFullText.slice(0, bubbleBaseLen)) ||
        seenFullText.startsWith(text.slice(0, bubbleBaseLen))
      )) {
        display = text.slice(bubbleBaseLen).replace(/^\n+/, "");
        seenFullText = text.length >= seenFullText.length ? text : seenFullText;
      } else {
        display = text;
        seenFullText = text;
      }

      assistantContent = display || assistantContent;
      db.updateMessageContent(assistantId, assistantContent, status);
      this.io.to(room.id).emit(
        "chat-delta",
        assistantId,
        assistantContent,
        status,
      );
    };

    try {
      const agentId = room.agent.getAgentId();
      if (agentId && agentId !== room.row.cursor_agent_id) {
        db.setCursorAgentId(room.id, agentId);
        room.row.cursor_agent_id = agentId;
      }

      await room.agent.run(prompt, (event) => {
        switch (event.kind) {
          case "session":
            db.setCursorSessionId(room.id, event.sessionId);
            room.row.cursor_session_id = event.sessionId;
            break;
          case "assistant_delta":
          case "assistant_final":
            emitAssistant(
              event.text,
              event.kind === "assistant_final" ? "done" : "streaming",
            );
            break;
          case "tool_start": {
            closeAssistant("done");
            afterTools = true;
            bubbleBaseLen = seenFullText.length;

            const path =
              event.path || extractToolPath(event.detail) || undefined;
            const msg: ChatMessage = {
              id: nanoid(12),
              roomId: room.id,
              role: "tool",
              content: event.detail || "Running…",
              toolName: event.name,
              status: "streaming",
              ts: Date.now(),
            };
            room.toolMsgIds.set(event.callId, msg.id);
            if (path) room.toolPaths.set(event.callId, path);
            db.insertMessage(msg);
            this.io.to(room.id).emit("chat-message", msg);
            break;
          }
          case "tool_done": {
            const id = room.toolMsgIds.get(event.callId);
            const path =
              event.path ||
              room.toolPaths.get(event.callId) ||
              extractToolPath(event.detail) ||
              undefined;
            if (path) room.toolPaths.set(event.callId, path);
            if (id) {
              const content = event.detail || "Done";
              db.updateMessageContent(id, content, "done");
              this.io.to(room.id).emit("chat-message", {
                id,
                roomId: room.id,
                role: "tool",
                content,
                toolName: event.name,
                status: "done",
                ts: Date.now(),
              });
              void attachFileDiff(id, event.name, content, path);
            }
            afterTools = true;
            break;
          }
          case "error":
            emitAssistant(event.message, "error");
            this.io.to(room.id).emit("agent-status", "error", event.message);
            break;
          case "done": {
            emitAssistant(event.result, "done");
            closeAssistant("done");
            const git =
              "git" in event
                ? (event as SdkStreamEvent & { kind: "done" }).git
                : undefined;
            if (git?.branches?.length) {
              const branch = git.branches[0];
              room.cloudMeta = {
                ...room.cloudMeta,
                repoUrl: branch.repoUrl || room.cloudMeta.repoUrl,
                branch: branch.branch,
                prUrl: branch.prUrl || room.cloudMeta.prUrl,
              };
              if (branch.prUrl) {
                db.setPrUrl(room.id, branch.prUrl);
                room.row.pr_url = branch.prUrl;
              }
              this.io.to(room.id).emit("cloud-meta", room.cloudMeta);
            }
            break;
          }
        }
      });

      const latestId = room.agent.getAgentId();
      if (latestId && latestId !== room.row.cursor_agent_id) {
        db.setCursorAgentId(room.id, latestId);
        room.row.cursor_agent_id = latestId;
      }

      const sessionId = room.agent.getSessionId();
      if (sessionId && sessionId !== room.row.cursor_session_id) {
        db.setCursorSessionId(room.id, sessionId);
        room.row.cursor_session_id = sessionId;
      }

      this.io.to(room.id).emit("agent-status", "idle");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      emitAssistant(message, "error");
      this.io.to(room.id).emit("agent-status", "error", message);
      this.io.to(room.id).emit("agent-status", "idle");
    }

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
    if (driverSocket) driverSocket.emit("drive-requested", p.name);
  }

  handleGrantDrive(socket: Socket, toSocketId: string): void {
    const room = this.getRoomForSocket(socket.id);
    if (!room) return;
    if (socket.id !== room.driverSocketId) return;
    if (!room.participants.has(toSocketId)) return;

    room.driverSocketId = toSocketId;
    room.pendingDriveRequest = null;
    this.broadcastPresence(room);
    this.io.sockets.sockets.get(toSocketId)?.emit("drive-granted");
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
      this.io.sockets.sockets
        .get(room.driverSocketId)
        ?.emit("drive-granted");
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

  listRooms(): RoomInfo[] {
    return db.listRooms().map((row) => {
      const room = this.rooms.get(row.id);
      return this.toRoomInfo(row, room?.participants.size || 0);
    });
  }

  getRoomInfo(id: string): RoomInfo | null {
    const row = db.getRoom(id);
    if (!row) return null;
    return this.toRoomInfo(row, this.rooms.get(id)?.participants.size || 0);
  }

  async listModelsForRoom(id: string): Promise<ModelInfo[]> {
    const row = db.getRoom(id);
    if (!row) throw new Error("Room not found");
    if (row.auth_mode === "cli") return listCliModels();
    const apiKey = resolveApiKey(row);
    return listModelsForKey(apiKey);
  }

  setModel(id: string, modelIdRaw: string): RoomInfo {
    const modelId = modelIdRaw.trim();
    if (!modelId) throw new Error("modelId is required");

    const room = this.rooms.get(id);
    const row = db.getRoom(id);
    if (!row || row.status !== "active") throw new Error("Room not found");

    if (room?.agent.isBusy()) {
      throw new Error("Wait for the agent to finish before changing model");
    }

    db.setModelId(id, modelId);
    row.model_id = modelId;
    if (room) {
      room.row.model_id = modelId;
      room.agent.setModel(modelId);
      this.io.to(id).emit("model-updated", modelId);
    }

    return this.toRoomInfo(row, room?.participants.size || 0);
  }

  stopRoom(id: string): void {
    const room = this.rooms.get(id);
    if (room) {
      for (const unsub of room.cleanups) unsub();
      void room.agent.dispose();
      this.rooms.delete(id);
    }
    db.updateRoomStatus(id, "stopped");
  }

  shutdown(): void {
    for (const [, room] of this.rooms) {
      for (const unsub of room.cleanups) unsub();
      void room.agent.dispose();
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
      runtime: (row.runtime as AgentRuntime) || "local",
      authMode: (row.auth_mode as AuthMode) || "cli",
      modelId: row.model_id || DEFAULT_MODEL,
      repoUrl: row.repo_url || undefined,
      startingRef: row.starting_ref || undefined,
      prUrl: row.pr_url || undefined,
      autoCreatePR: Boolean(row.auto_create_pr),
      keyHint: row.key_hint || undefined,
    };
  }
}
