import { Server as SocketIOServer, type Socket } from "socket.io";
import type {
  WorkerToServerEvents,
  ServerToWorkerEvents,
  AgentStreamEventPayload,
  ModelInfo,
} from "../shared/events.js";
import * as db from "./db.js";

interface WorkerConnection {
  socketId: string;
  socket: Socket<WorkerToServerEvents, ServerToWorkerEvents>;
  workerId: string;
  userId: string;
  machineName: string;
  busy: boolean;
}

type WorkerEventCallback = (
  roomId: string,
  event: AgentStreamEventPayload,
) => void;

type WorkerDiffCallback = (
  roomId: string,
  msgId: string,
  toolName: string,
  path: string,
  patch: string,
) => void;

/**
 * Manages CLI worker connections on the /worker Socket.IO namespace.
 * Workers connect with { token } auth, advertise readiness,
 * and run agent prompts relayed from the API.
 */
export class WorkerRelay {
  private workers = new Map<string, WorkerConnection>();
  private roomToWorker = new Map<string, string>();
  private eventListeners = new Map<string, WorkerEventCallback>();
  private diffListeners = new Map<string, WorkerDiffCallback>();
  private folderPickWaiters = new Map<
    string,
    {
      resolve: (path: string | null) => void;
      reject: (err: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private listModelsWaiters = new Map<
    string,
    {
      resolve: (models: ModelInfo[]) => void;
      reject: (err: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private modelsCache = new Map<
    string,
    { at: number; models: ModelInfo[] }
  >();
  private static readonly MODELS_CACHE_MS = 15 * 60_000;

  constructor(
    private io: SocketIOServer,
    private verifyToken: (
      token: string,
    ) => { userId: string; workerId: string } | null,
  ) {
    this.setupNamespace();
  }

  private setupNamespace(): void {
    const ns = this.io.of("/worker");

    ns.use((socket, next) => {
      const token = socket.handshake.auth?.token as string;
      if (!token) {
        next(new Error("Missing auth token"));
        return;
      }
      const info = this.verifyToken(token);
      if (!info) {
        next(new Error("Invalid token"));
        return;
      }
      (socket as unknown as Record<string, unknown>)._userId = info.userId;
      (socket as unknown as Record<string, unknown>)._workerId = info.workerId;
      next();
    });

    ns.on("connection", (socket: Socket<WorkerToServerEvents, ServerToWorkerEvents>) => {
      const userId = (socket as unknown as Record<string, unknown>)._userId as string;
      const workerId = (socket as unknown as Record<string, unknown>)._workerId as string;

      socket.on("worker:ready", (info) => {
        const conn: WorkerConnection = {
          socketId: socket.id,
          socket: socket as Socket<WorkerToServerEvents, ServerToWorkerEvents>,
          workerId: info.workerId || workerId,
          userId,
          machineName: info.machineName || "unknown",
          busy: false,
        };
        this.workers.set(conn.workerId, conn);
        console.log(
          `[WorkerRelay] Worker "${conn.machineName}" (${conn.workerId}) connected for user ${userId}`,
        );
      });

      socket.on("worker:agent-event", (data) => {
        const cb = this.eventListeners.get(data.roomId);
        if (cb) cb(data.roomId, data.event);
      });

      socket.on("worker:file-diff", (data) => {
        const cb = this.diffListeners.get(data.roomId);
        if (cb) cb(data.roomId, data.msgId, data.toolName, data.path, data.patch);
      });

      socket.on("worker:folder-picked", (data) => {
        const waiter = this.folderPickWaiters.get(data.requestId);
        if (!waiter) return;
        clearTimeout(waiter.timer);
        this.folderPickWaiters.delete(data.requestId);
        if (data.error) {
          waiter.reject(new Error(data.error));
        } else {
          waiter.resolve(data.path);
        }
      });

      socket.on("worker:models-listed", (data) => {
        const waiter = this.listModelsWaiters.get(data.requestId);
        if (!waiter) return;
        clearTimeout(waiter.timer);
        this.listModelsWaiters.delete(data.requestId);
        if (data.error) {
          waiter.reject(new Error(data.error));
        } else {
          waiter.resolve(data.models || []);
        }
      });

      socket.on("disconnect", () => {
        for (const [id, w] of this.workers) {
          if (w.socketId === socket.id) {
            console.log(`[WorkerRelay] Worker "${w.machineName}" disconnected`);
            this.workers.delete(id);
            for (const [roomId, wId] of this.roomToWorker) {
              if (wId === id) this.roomToWorker.delete(roomId);
            }
            break;
          }
        }
      });
    });
  }

  /** Find a free (not agent-busy) worker for a user. */
  findWorkerForUser(userId: string): WorkerConnection | null {
    for (const w of this.workers.values()) {
      if (w.userId === userId && !w.busy) return w;
    }
    return null;
  }

  /** First free worker (legacy rooms with no owner_id). */
  findFirstFreeWorker(): WorkerConnection | null {
    for (const w of this.workers.values()) {
      if (!w.busy) return w;
    }
    return null;
  }

  /** Any online worker for a user (including busy). */
  findAnyWorkerForUser(userId: string): WorkerConnection | null {
    for (const w of this.workers.values()) {
      if (w.userId === userId) return w;
    }
    return null;
  }

  getWorkerForRoom(roomId: string): WorkerConnection | null {
    const wId = this.roomToWorker.get(roomId);
    if (!wId) return null;
    return this.workers.get(wId) || null;
  }

  /** Send a prompt to a worker for a room. */
  dispatchToWorker(
    roomId: string,
    workerId: string,
    prompt: string,
    repoPath: string,
    modelId: string,
    sessionId?: string | null,
  ): boolean {
    const worker = this.workers.get(workerId);
    if (!worker) return false;

    this.roomToWorker.set(roomId, workerId);
    worker.busy = true;

    worker.socket.emit("worker:run-prompt", {
      roomId,
      prompt,
      repoPath,
      modelId,
      sessionId,
    });

    return true;
  }

  /** Abort a running agent on a worker. */
  abortWorker(roomId: string): void {
    const worker = this.getWorkerForRoom(roomId);
    if (worker) {
      worker.socket.emit("worker:abort", { roomId });
      worker.busy = false;
    }
  }

  /** Mark worker as free after a run completes. */
  releaseWorker(roomId: string): void {
    const wId = this.roomToWorker.get(roomId);
    if (wId) {
      const w = this.workers.get(wId);
      if (w) w.busy = false;
    }
  }

  /** Register callbacks for agent events from workers. */
  onAgentEvent(roomId: string, cb: WorkerEventCallback): () => void {
    this.eventListeners.set(roomId, cb);
    return () => this.eventListeners.delete(roomId);
  }

  /** Register callbacks for file diffs from workers. */
  onFileDiff(roomId: string, cb: WorkerDiffCallback): () => void {
    this.diffListeners.set(roomId, cb);
    return () => this.diffListeners.delete(roomId);
  }

  /** Get online workers for a user. */
  getOnlineWorkersForUser(userId: string): Array<{
    id: string;
    name: string;
    busy: boolean;
  }> {
    const result: Array<{ id: string; name: string; busy: boolean }> = [];
    for (const w of this.workers.values()) {
      if (w.userId === userId) {
        result.push({ id: w.workerId, name: w.machineName, busy: w.busy });
      }
    }
    return result;
  }

  hasOnlineWorker(userId: string): boolean {
    for (const w of this.workers.values()) {
      if (w.userId === userId) return true;
    }
    return false;
  }

  /**
   * Ask the user's CLI worker to open a native folder picker.
   * Resolves with absolute path, or null if cancelled.
   */
  requestFolderPick(userId: string, timeoutMs = 120_000): Promise<string | null> {
    const worker = this.findAnyWorkerForUser(userId);
    if (!worker) {
      return Promise.reject(
        new Error(
          "No online Steer worker. Run `steer start` on your machine first.",
        ),
      );
    }

    const requestId = `${userId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.folderPickWaiters.delete(requestId);
        reject(new Error("Folder picker timed out — check your worker machine"));
      }, timeoutMs);

      this.folderPickWaiters.set(requestId, { resolve, reject, timer });
      worker.socket.emit("worker:pick-folder", { requestId });
    });
  }

  /**
   * Ask the user's CLI worker to run `cursor agent --list-models` locally.
   * Required in production — the hosted API has no Cursor CLI.
   * Results are cached per user for 15 minutes.
   */
  requestListModels(userId: string, timeoutMs = 60_000): Promise<ModelInfo[]> {
    const cacheKey = `cli:${userId}`;
    const dbCached = db.getModelCache(cacheKey);
    if (dbCached && Date.now() - dbCached.updatedAt < WorkerRelay.MODELS_CACHE_MS) {
      this.modelsCache.set(userId, {
        at: dbCached.updatedAt,
        models: dbCached.models,
      });
      return Promise.resolve(dbCached.models);
    }

    const cached = this.modelsCache.get(userId);
    if (
      cached &&
      Date.now() - cached.at < WorkerRelay.MODELS_CACHE_MS &&
      cached.models.length > 0
    ) {
      return Promise.resolve(cached.models);
    }

    const worker = this.findAnyWorkerForUser(userId);
    if (!worker) {
      if (dbCached?.models.length) return Promise.resolve(dbCached.models);
      if (cached?.models.length) return Promise.resolve(cached.models);
      return Promise.reject(
        new Error(
          "No online Steer worker. Run `steer start` on your machine first.",
        ),
      );
    }

    const requestId = `${userId}-models-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.listModelsWaiters.delete(requestId);
        if (dbCached?.models.length) resolve(dbCached.models);
        else if (cached?.models.length) resolve(cached.models);
        else
          reject(new Error("Listing models timed out — check your worker machine"));
      }, timeoutMs);

      this.listModelsWaiters.set(requestId, {
        resolve: (models) => {
          if (models.length > 0) {
            this.modelsCache.set(userId, { at: Date.now(), models });
            db.setModelCache(cacheKey, models);
          }
          resolve(models);
        },
        reject,
        timer,
      });
      worker.socket.emit("worker:list-models", { requestId });
    });
  }

  shutdown(): void {
    for (const w of this.folderPickWaiters.values()) {
      clearTimeout(w.timer);
      w.reject(new Error("Server shutting down"));
    }
    this.folderPickWaiters.clear();
    for (const w of this.listModelsWaiters.values()) {
      clearTimeout(w.timer);
      w.reject(new Error("Server shutting down"));
    }
    this.listModelsWaiters.clear();
    this.modelsCache.clear();
    this.workers.clear();
    this.roomToWorker.clear();
    this.eventListeners.clear();
    this.diffListeners.clear();
  }
}
