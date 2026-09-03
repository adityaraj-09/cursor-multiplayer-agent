import { randomBytes } from "crypto";
import * as db from "./db.js";

export const INTEGRATION_LOCK_TTL_MS = 45 * 60 * 1000;

export interface IntegrationLockRow {
  room_id: string;
  held_by: string;
  source_agent_id: string;
  actor_user_id: string | null;
  acquired_at: number;
  expires_at: number;
}

export interface IntegrationQueueRow {
  id: string;
  room_id: string;
  source_agent_id: string;
  actor_user_id: string | null;
  created_at: number;
}

export function newIntegrationJobId(): string {
  return `ij_${randomBytes(8).toString("hex")}`;
}

export function isLockFresh(
  lock: { expires_at: number },
  now = Date.now(),
): boolean {
  return lock.expires_at > now;
}

export function tryAcquireIntegrationLock(input: {
  roomId: string;
  heldBy: string;
  sourceAgentId: string;
  actorUserId?: string | null;
  now?: number;
  ttlMs?: number;
  /** If the integrator is still running, extend a stale lock instead of stealing. */
  holderStillRunning?: boolean;
}):
  | { ok: true; lock: IntegrationLockRow }
  | { ok: false; lock: IntegrationLockRow } {
  const now = input.now ?? Date.now();
  const ttl = input.ttlMs ?? INTEGRATION_LOCK_TTL_MS;
  const existing = db.getIntegrationLock(input.roomId);
  if (existing && isLockFresh(existing, now)) {
    return { ok: false, lock: existing };
  }
  if (existing && input.holderStillRunning) {
    const extended: IntegrationLockRow = {
      ...existing,
      expires_at: now + ttl,
    };
    db.upsertIntegrationLock(extended);
    return { ok: false, lock: extended };
  }
  if (existing) {
    db.deleteIntegrationLock(input.roomId);
  }
  const lock: IntegrationLockRow = {
    room_id: input.roomId,
    held_by: input.heldBy,
    source_agent_id: input.sourceAgentId,
    actor_user_id: input.actorUserId ?? null,
    acquired_at: now,
    expires_at: now + ttl,
  };
  db.upsertIntegrationLock(lock);
  return { ok: true, lock };
}

export function releaseIntegrationLock(
  roomId: string,
  heldBy?: string,
): boolean {
  const existing = db.getIntegrationLock(roomId);
  if (!existing) return false;
  if (heldBy && existing.held_by !== heldBy) return false;
  db.deleteIntegrationLock(roomId);
  return true;
}

export function enqueueIntegrationJob(input: {
  roomId: string;
  sourceAgentId: string;
  actorUserId?: string | null;
  now?: number;
}): IntegrationQueueRow {
  const existing = db.getIntegrationQueueItem(input.roomId, input.sourceAgentId);
  if (existing) return existing;
  const row: IntegrationQueueRow = {
    id: `iq_${randomBytes(8).toString("hex")}`,
    room_id: input.roomId,
    source_agent_id: input.sourceAgentId,
    actor_user_id: input.actorUserId ?? null,
    created_at: input.now ?? Date.now(),
  };
  db.insertIntegrationQueueItem(row);
  return row;
}

export function dequeueNextIntegrationJob(
  roomId: string,
): IntegrationQueueRow | undefined {
  return db.shiftIntegrationQueue(roomId);
}

export function listIntegrationQueue(roomId: string): IntegrationQueueRow[] {
  return db.listIntegrationQueue(roomId);
}

export function getActiveIntegrationLock(
  roomId: string,
  now = Date.now(),
): IntegrationLockRow | undefined {
  db.deleteExpiredIntegrationLock(roomId, now);
  return db.getIntegrationLock(roomId);
}
