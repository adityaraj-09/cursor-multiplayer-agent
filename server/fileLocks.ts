import type { Server } from "socket.io";
import type {
  ClientToServerEvents,
  FileLease,
  ServerToClientEvents,
} from "../shared/events.js";
import { normalizePath } from "./agentConflicts.js";
import * as db from "./db.js";

export type AcquireResult =
  | { ok: true }
  | { ok: false; holderAgentId: string };

const DEFAULT_TTL_MS = 5 * 60_000;

export class FileLockRegistry {
  private onChange?: (roomId: string) => void;

  constructor(onChange?: (roomId: string) => void) {
    this.onChange = onChange;
    this.purgeExpired();
    for (const row of db.listAllFileLocks()) {
      if (row.expires_at <= Date.now()) {
        db.deleteFileLock(row.room_id, row.path);
      }
    }
  }

  setOnChange(onChange: (roomId: string) => void): void {
    this.onChange = onChange;
  }

  tryAcquire(
    roomId: string,
    agentId: string,
    rawPath: string,
    callId?: string,
    ttlMs = DEFAULT_TTL_MS,
  ): AcquireResult {
    const path = normalizePath(rawPath);
    if (!path) return { ok: true };

    this.purgeExpiredForRoom(roomId);

    const existing = db.getFileLock(roomId, path);
    const now = Date.now();
    if (existing) {
      if (existing.agent_id === agentId) {
        db.upsertFileLock({
          roomId,
          path,
          agentId,
          callId: callId ?? existing.call_id,
          acquiredAt: existing.acquired_at,
          expiresAt: now + ttlMs,
        });
        this.notify(roomId);
        return { ok: true };
      }
      if (existing.expires_at > now) {
        return { ok: false, holderAgentId: existing.agent_id };
      }
    }

    db.upsertFileLock({
      roomId,
      path,
      agentId,
      callId: callId ?? null,
      acquiredAt: now,
      expiresAt: now + ttlMs,
    });
    this.notify(roomId);
    return { ok: true };
  }

  release(roomId: string, agentId: string, rawPath: string): void {
    const path = normalizePath(rawPath);
    if (!path) return;
    const existing = db.getFileLock(roomId, path);
    if (!existing || existing.agent_id !== agentId) return;
    db.deleteFileLock(roomId, path);
    this.notify(roomId);
  }

  releaseAllForAgent(roomId: string, agentId: string): void {
    const removed = db.deleteFileLocksForAgent(roomId, agentId);
    if (removed > 0) this.notify(roomId);
  }

  releaseAllForRoom(roomId: string): void {
    db.deleteFileLocksForRoom(roomId);
    this.notify(roomId);
  }

  forceRelease(roomId: string, rawPath: string): boolean {
    const path = normalizePath(rawPath);
    if (!path) return false;
    const existing = db.getFileLock(roomId, path);
    if (!existing) return false;
    db.deleteFileLock(roomId, path);
    this.notify(roomId);
    return true;
  }

  list(roomId: string): FileLease[] {
    this.purgeExpiredForRoom(roomId);
    return db.listFileLocks(roomId).map((row) => ({
      roomId: row.room_id,
      path: row.path,
      agentId: row.agent_id,
      callId: row.call_id ?? undefined,
      acquiredAt: row.acquired_at,
      expiresAt: row.expires_at,
    }));
  }

  purgeExpired(): void {
    db.deleteExpiredFileLocks(Date.now());
  }

  private purgeExpiredForRoom(roomId: string): void {
    db.deleteExpiredFileLocksForRoom(roomId, Date.now());
  }

  private notify(roomId: string): void {
    this.onChange?.(roomId);
  }
}

export function broadcastFileLocks(
  io: Server<ClientToServerEvents, ServerToClientEvents>,
  roomId: string,
  registry: FileLockRegistry,
): void {
  io.to(roomId).emit("file-locks", registry.list(roomId));
}
