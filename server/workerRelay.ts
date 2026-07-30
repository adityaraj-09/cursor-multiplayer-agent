import { Server as SocketIOServer, type Socket } from "socket.io";
import type {
  WorkerToServerEvents,
  ServerToWorkerEvents,
  AgentStreamEventPayload,
  ModelInfo,
  CursorChatSession,
} from "../shared/events.js";
import * as db from "./db.js";
import type { FileLockRegistry } from "./fileLocks.js";

export function makeRunKey(roomId: string, agentId: string): string {
  return `${roomId}:${agentId}`;
}

export function parseRunKey(
  runKey: string,
): { roomId: string; agentId: string } | null {
  const idx = runKey.indexOf(":");
  if (idx <= 0) return null;
  return {
    roomId: runKey.slice(0, idx),
    agentId: runKey.slice(idx + 1),
  };
}

interface WorkerConnection {
  socketId: string;
  socket: Socket<WorkerToServerEvents, ServerToWorkerEvents>;
  workerId: string;
  userId: string;
  machineName: string;
  /** Protocol version advertised by the worker (1 = legacy single-run). */
  protocol: number;
  activeRuns: Set<string>;
  maxConcurrent: number;
}

export interface RunRef {
  roomId: string;
  agentId: string;
}

type WorkerEventCallback = (
  roomId: string,
  agentId: string,
  event: AgentStreamEventPayload,
) => void;

type WorkerDiffCallback = (
  roomId: string,
  agentId: string,
  callId: string,
  toolName: string,
  path: string,
  patch: string,
) => void;

/**
 * Manages CLI worker connections on the /worker Socket.IO namespace.
 * Supports N concurrent agent runs per worker (protocol 2+).
 */
export class WorkerRelay {
  private workers = new Map<string, WorkerConnection>();
  private runToWorker = new Map<string, string>();
  private eventListeners = new Map<string, WorkerEventCallback>();
  private diffListeners = new Map<string, WorkerDiffCallback>();
  private runLostListeners = new Set<(runs: RunRef[]) => void>();
  private runDisconnectSoftListeners = new Set<(runs: RunRef[]) => void>();
  private runGraceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private static readonly DISCONNECT_GRACE_MS = 5 * 60_000;
  private static readonly DEFAULT_MAX_CONCURRENT = 4;
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
  private listSessionsWaiters = new Map<
    string,
    {
      resolve: (sessions: CursorChatSession[]) => void;
      reject: (err: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private modelsCache = new Map<
    string,
    { at: number; models: ModelInfo[] }
  >();
  private static readonly MODELS_CACHE_MS = 15 * 60_000;

  /** Resolve default agent id for a room (legacy workers). */
  private resolveDefaultAgentId: (roomId: string) => string | null = () =>
    null;

  constructor(
    private io: SocketIOServer,
    private verifyToken: (
      token: string,
    ) => { userId: string; workerId: string } | null,
    private fileLocks?: FileLockRegistry,
  ) {
    this.setupNamespace();
  }

  setDefaultAgentResolver(fn: (roomId: string) => string | null): void {
    this.resolveDefaultAgentId = fn;
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

    ns.on(
      "connection",
      (socket: Socket<WorkerToServerEvents, ServerToWorkerEvents>) => {
        const userId = (socket as unknown as Record<string, unknown>)
          ._userId as string;
        const workerId = (socket as unknown as Record<string, unknown>)
          ._workerId as string;

        socket.on("worker:ready", (info) => {
          const protocol = info.protocol ?? 1;
          const conn: WorkerConnection = {
            socketId: socket.id,
            socket: socket as Socket<
              WorkerToServerEvents,
              ServerToWorkerEvents
            >,
            workerId: info.workerId || workerId,
            userId,
            machineName: info.machineName || "unknown",
            protocol,
            activeRuns: new Set(),
            maxConcurrent:
              protocol >= 2
                ? WorkerRelay.DEFAULT_MAX_CONCURRENT
                : 1,
          };
          this.workers.set(conn.workerId, conn);
          (socket as unknown as Record<string, unknown>)._workerId =
            conn.workerId;
          console.log(
            `[WorkerRelay] Worker "${conn.machineName}" (${conn.workerId}) connected protocol=${protocol} for user ${userId}`,
          );

          // Re-bind runs that were mid-run when this worker dropped.
          const reclaim: RunRef[] = [];
          if (info.activeRuns?.length) {
            for (const r of info.activeRuns) {
              reclaim.push(r);
            }
          } else if (info.activeRoomId) {
            const agentId =
              this.resolveDefaultAgentId(info.activeRoomId) || "default";
            reclaim.push({ roomId: info.activeRoomId, agentId });
          }

          for (const r of reclaim) {
            const room = db.getRoom(r.roomId);
            if (room && room.owner_id === userId) {
              const runKey = makeRunKey(r.roomId, r.agentId);
              this.runToWorker.set(runKey, conn.workerId);
              conn.activeRuns.add(runKey);
              this.clearRunGrace(runKey);
              console.log(
                `[WorkerRelay] Resumed run ${runKey} on reconnected worker`,
              );
            }
          }
        });

        socket.on("worker:agent-event", (data) => {
          const agentId =
            data.agentId ||
            this.resolveDefaultAgentId(data.roomId) ||
            "default";
          const runKey = makeRunKey(data.roomId, agentId);
          this.noteRunActivity(runKey);

          const wId = (socket as unknown as Record<string, unknown>)
            ._workerId as string | undefined;
          if (wId && this.workers.has(wId)) {
            const room = db.getRoom(data.roomId);
            if (room && room.owner_id === userId) {
              this.runToWorker.set(runKey, wId);
              const w = this.workers.get(wId);
              if (w) {
                if (data.event?.kind === "done" || data.event?.kind === "error") {
                  w.activeRuns.delete(runKey);
                } else {
                  w.activeRuns.add(runKey);
                }
              }
            } else if (!room || room.owner_id !== userId) {
              console.warn(
                `[WorkerRelay] Dropping agent-event for room ${data.roomId} — ownership mismatch`,
              );
              return;
            }
          }
          const cb = this.eventListeners.get(runKey);
          if (cb) cb(data.roomId, agentId, data.event);
        });

        socket.on("worker:file-diff", (data) => {
          const callId =
            data.callId || (data as { msgId?: string }).msgId || "";
          if (!callId) return;
          const agentId =
            data.agentId ||
            this.resolveDefaultAgentId(data.roomId) ||
            "default";
          const runKey = makeRunKey(data.roomId, agentId);
          const cb = this.diffListeners.get(runKey);
          if (cb)
            cb(data.roomId, agentId, callId, data.toolName, data.path, data.patch);
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

        socket.on("worker:sessions-listed", (data) => {
          const waiter = this.listSessionsWaiters.get(data.requestId);
          if (!waiter) return;
          clearTimeout(waiter.timer);
          this.listSessionsWaiters.delete(data.requestId);
          if (data.error) {
            waiter.reject(new Error(data.error));
          } else {
            waiter.resolve(data.sessions || []);
          }
        });

        socket.on("worker:acquire-lock", (data) => {
          const room = db.getRoom(data.roomId);
          if (!room || room.owner_id !== userId || !this.fileLocks) {
            socket.emit("worker:lock-result", {
              requestId: data.requestId,
              granted: false,
            });
            return;
          }
          const result = this.fileLocks.tryAcquire(
            data.roomId,
            data.agentId,
            data.path,
            data.callId,
          );
          socket.emit("worker:lock-result", {
            requestId: data.requestId,
            granted: result.ok,
            holderAgentId: result.ok ? undefined : result.holderAgentId,
          });
        });

        socket.on("worker:release-lock", (data) => {
          const room = db.getRoom(data.roomId);
          if (!room || room.owner_id !== userId || !this.fileLocks) return;
          this.fileLocks.release(data.roomId, data.agentId, data.path);
        });

        socket.on("disconnect", () => {
          let removedWorkerId: string | null = null;
          let removedUserId: string | null = null;
          for (const [id, w] of this.workers) {
            if (w.socketId === socket.id) {
              console.log(
                `[WorkerRelay] Worker "${w.machineName}" disconnected`,
              );
              removedWorkerId = id;
              removedUserId = w.userId;
              this.workers.delete(id);
              break;
            }
          }

          const affectedRuns: RunRef[] = [];
          if (removedWorkerId) {
            for (const [runKey, wId] of [...this.runToWorker.entries()]) {
              if (wId === removedWorkerId) {
                const parsed = parseRunKey(runKey);
                if (parsed) affectedRuns.push(parsed);
                this.runToWorker.delete(runKey);
                this.scheduleRunGrace(runKey);
              }
            }
          }

          if (removedUserId) {
            for (const [reqId, waiter] of [
              ...this.folderPickWaiters.entries(),
            ]) {
              if (reqId.startsWith(removedUserId)) {
                clearTimeout(waiter.timer);
                this.folderPickWaiters.delete(reqId);
                waiter.reject(new Error("Worker disconnected"));
              }
            }
            for (const [reqId, waiter] of [
              ...this.listModelsWaiters.entries(),
            ]) {
              if (reqId.startsWith(removedUserId)) {
                clearTimeout(waiter.timer);
                this.listModelsWaiters.delete(reqId);
                waiter.reject(new Error("Worker disconnected"));
              }
            }
            for (const [reqId, waiter] of [
              ...this.listSessionsWaiters.entries(),
            ]) {
              if (reqId.startsWith(removedUserId)) {
                clearTimeout(waiter.timer);
                this.listSessionsWaiters.delete(reqId);
                waiter.reject(new Error("Worker disconnected"));
              }
            }
          }

          if (affectedRuns.length > 0) {
            for (const cb of this.runDisconnectSoftListeners) {
              try {
                cb(affectedRuns);
              } catch (err) {
                console.error(
                  "[WorkerRelay] soft disconnect listener error:",
                  err,
                );
              }
            }
          }
        });
      },
    );
  }

  onRunsDisconnected(cb: (runs: RunRef[]) => void): () => void {
    this.runDisconnectSoftListeners.add(cb);
    return () => this.runDisconnectSoftListeners.delete(cb);
  }

  onRunsLost(cb: (runs: RunRef[]) => void): () => void {
    this.runLostListeners.add(cb);
    return () => this.runLostListeners.delete(cb);
  }

  /** @deprecated Prefer onRunsDisconnected */
  onRoomsDisconnected(cb: (roomIds: string[]) => void): () => void {
    return this.onRunsDisconnected((runs) => {
      cb([...new Set(runs.map((r) => r.roomId))]);
    });
  }

  /** @deprecated Prefer onRunsLost */
  onRoomsLost(cb: (roomIds: string[]) => void): () => void {
    return this.onRunsLost((runs) => {
      cb([...new Set(runs.map((r) => r.roomId))]);
    });
  }

  clearRunListeners(roomId: string, agentId: string): void {
    const runKey = makeRunKey(roomId, agentId);
    this.eventListeners.delete(runKey);
    this.diffListeners.delete(runKey);
  }

  clearRoomListeners(roomId: string): void {
    for (const key of [...this.eventListeners.keys()]) {
      if (key.startsWith(`${roomId}:`)) this.eventListeners.delete(key);
    }
    for (const key of [...this.diffListeners.keys()]) {
      if (key.startsWith(`${roomId}:`)) this.diffListeners.delete(key);
    }
  }

  private scheduleRunGrace(runKey: string): void {
    this.clearRunGrace(runKey);
    const timer = setTimeout(() => {
      this.runGraceTimers.delete(runKey);
      const parsed = parseRunKey(runKey);
      if (!parsed) return;
      for (const cb of this.runLostListeners) {
        try {
          cb([parsed]);
        } catch (err) {
          console.error("[WorkerRelay] runLost (grace) listener error:", err);
        }
      }
    }, WorkerRelay.DISCONNECT_GRACE_MS);
    this.runGraceTimers.set(runKey, timer);
  }

  private clearRunGrace(runKey: string): void {
    const t = this.runGraceTimers.get(runKey);
    if (t) {
      clearTimeout(t);
      this.runGraceTimers.delete(runKey);
    }
  }

  noteRunActivity(runKey: string): void {
    this.clearRunGrace(runKey);
  }

  noteRoomActivity(roomId: string): void {
    for (const key of this.runGraceTimers.keys()) {
      if (key.startsWith(`${roomId}:`)) this.clearRunGrace(key);
    }
  }

  /** Find a worker with spare capacity for a user. */
  findWorkerForUser(userId: string): WorkerConnection | null {
    for (const w of this.workers.values()) {
      if (w.userId === userId && w.activeRuns.size < w.maxConcurrent) {
        return w;
      }
    }
    return null;
  }

  findAnyWorkerForUser(userId: string): WorkerConnection | null {
    for (const w of this.workers.values()) {
      if (w.userId === userId) return w;
    }
    return null;
  }

  getWorkerForRun(roomId: string, agentId: string): WorkerConnection | null {
    const wId = this.runToWorker.get(makeRunKey(roomId, agentId));
    if (!wId) return null;
    return this.workers.get(wId) || null;
  }

  getWorkerForRoom(roomId: string): WorkerConnection | null {
    for (const [runKey, wId] of this.runToWorker) {
      if (runKey.startsWith(`${roomId}:`)) {
        return this.workers.get(wId) || null;
      }
    }
    return null;
  }

  workerSupportsMultiAgent(workerId: string): boolean {
    const w = this.workers.get(workerId);
    return Boolean(w && w.protocol >= 2);
  }

  /**
   * Send a prompt to a worker for a specific agent run.
   * Returns false if worker missing; throws if legacy worker cannot run
   * a non-default agent.
   */
  dispatchToWorker(
    roomId: string,
    workerId: string,
    prompt: string,
    repoPath: string,
    modelId: string,
    sessionId?: string | null,
    agentId?: string,
    cwd?: string,
  ): boolean {
    const worker = this.workers.get(workerId);
    if (!worker) return false;

    const resolvedAgentId =
      agentId || this.resolveDefaultAgentId(roomId) || "default";
    const defaultAgentId = this.resolveDefaultAgentId(roomId);

    if (
      worker.protocol < 2 &&
      defaultAgentId &&
      resolvedAgentId !== defaultAgentId
    ) {
      throw new Error(
        "Update the Steer CLI (`npm i -g @oblivihon/steer@latest`) to run parallel agents",
      );
    }

    const runKey = makeRunKey(roomId, resolvedAgentId);
    this.runToWorker.set(runKey, workerId);
    worker.activeRuns.add(runKey);

    worker.socket.emit("worker:run-prompt", {
      roomId,
      agentId: resolvedAgentId,
      prompt,
      repoPath,
      cwd: cwd || repoPath,
      modelId,
      sessionId,
    });

    return true;
  }

  abortRun(roomId: string, agentId: string): void {
    const runKey = makeRunKey(roomId, agentId);
    const worker = this.getWorkerForRun(roomId, agentId);
    if (worker) {
      worker.socket.emit("worker:abort", { roomId, agentId });
      worker.activeRuns.delete(runKey);
    }
  }

  abortWorker(roomId: string): void {
    for (const [runKey, wId] of [...this.runToWorker.entries()]) {
      if (!runKey.startsWith(`${roomId}:`)) continue;
      const parsed = parseRunKey(runKey);
      if (!parsed) continue;
      const worker = this.workers.get(wId);
      if (worker) {
        worker.socket.emit("worker:abort", {
          roomId: parsed.roomId,
          agentId: parsed.agentId,
        });
        worker.activeRuns.delete(runKey);
      }
    }
  }

  releaseRun(roomId: string, agentId: string): void {
    const runKey = makeRunKey(roomId, agentId);
    const wId = this.runToWorker.get(runKey);
    if (wId) {
      const w = this.workers.get(wId);
      if (w) w.activeRuns.delete(runKey);
    }
  }

  releaseWorker(roomId: string): void {
    for (const [runKey, wId] of [...this.runToWorker.entries()]) {
      if (!runKey.startsWith(`${roomId}:`)) continue;
      const w = this.workers.get(wId);
      if (w) w.activeRuns.delete(runKey);
    }
  }

  detachRun(roomId: string, agentId: string): void {
    this.abortRun(roomId, agentId);
    this.releaseRun(roomId, agentId);
    this.clearRunListeners(roomId, agentId);
    this.clearRunGrace(makeRunKey(roomId, agentId));
    this.runToWorker.delete(makeRunKey(roomId, agentId));
  }

  detachRoom(roomId: string): void {
    this.abortWorker(roomId);
    this.releaseWorker(roomId);
    for (const key of [...this.runToWorker.keys()]) {
      if (key.startsWith(`${roomId}:`)) {
        this.runToWorker.delete(key);
        this.clearRunGrace(key);
      }
    }
    this.clearRoomListeners(roomId);
  }

  onAgentEvent(
    roomId: string,
    agentId: string,
    cb: WorkerEventCallback,
  ): () => void {
    const runKey = makeRunKey(roomId, agentId);
    this.eventListeners.set(runKey, cb);
    return () => this.eventListeners.delete(runKey);
  }

  onFileDiff(
    roomId: string,
    agentId: string,
    cb: WorkerDiffCallback,
  ): () => void {
    const runKey = makeRunKey(roomId, agentId);
    this.diffListeners.set(runKey, cb);
    return () => this.diffListeners.delete(runKey);
  }

  getOnlineWorkersForUser(userId: string): Array<{
    id: string;
    name: string;
    busy: boolean;
  }> {
    const result: Array<{ id: string; name: string; busy: boolean }> = [];
    for (const w of this.workers.values()) {
      if (w.userId === userId) {
        result.push({
          id: w.workerId,
          name: w.machineName,
          busy: w.activeRuns.size > 0,
        });
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

  requestFolderPick(
    userId: string,
    timeoutMs = 120_000,
  ): Promise<string | null> {
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
        reject(
          new Error("Folder picker timed out — check your worker machine"),
        );
      }, timeoutMs);

      this.folderPickWaiters.set(requestId, { resolve, reject, timer });
      worker.socket.emit("worker:pick-folder", { requestId });
    });
  }

  requestListModels(
    userId: string,
    timeoutMs = 60_000,
  ): Promise<ModelInfo[]> {
    const cacheKey = `cli:${userId}`;
    const dbCached = db.getModelCache(cacheKey);
    if (
      dbCached &&
      Date.now() - dbCached.updatedAt < WorkerRelay.MODELS_CACHE_MS
    ) {
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
          reject(
            new Error(
              "Listing models timed out — check your worker machine",
            ),
          );
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

  requestListSessions(
    userId: string,
    repoPath: string,
    timeoutMs = 15_000,
  ): Promise<CursorChatSession[]> {
    const worker = this.findAnyWorkerForUser(userId);
    if (!worker) {
      return Promise.reject(
        new Error(
          "No online Steer worker. Run `steer start` on your machine first.",
        ),
      );
    }

    const requestId = `${userId}-sessions-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.listSessionsWaiters.delete(requestId);
        reject(new Error("Listing chat sessions timed out"));
      }, timeoutMs);

      this.listSessionsWaiters.set(requestId, { resolve, reject, timer });
      worker.socket.emit("worker:list-sessions", { requestId, repoPath });
    });
  }

  shutdown(): void {
    for (const t of this.runGraceTimers.values()) clearTimeout(t);
    this.runGraceTimers.clear();
    this.runLostListeners.clear();
    this.runDisconnectSoftListeners.clear();
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
    for (const w of this.listSessionsWaiters.values()) {
      clearTimeout(w.timer);
      w.reject(new Error("Server shutting down"));
    }
    this.listSessionsWaiters.clear();
    this.modelsCache.clear();
    this.workers.clear();
    this.runToWorker.clear();
    this.eventListeners.clear();
    this.diffListeners.clear();
  }
}
