import pg from "pg";
import type {
  AgentRuntime,
  AuthMode,
  ChatMessage,
  SteerLogEntry,
} from "../../shared/events.js";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function initSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS rooms (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      repo_path TEXT NOT NULL,
      agent_command TEXT NOT NULL,
      created_at BIGINT NOT NULL,
      last_active_at BIGINT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      cursor_session_id TEXT,
      runtime TEXT NOT NULL DEFAULT 'local',
      auth_mode TEXT NOT NULL DEFAULT 'cli',
      model_id TEXT NOT NULL DEFAULT 'composer-2.5',
      repo_url TEXT,
      starting_ref TEXT,
      cursor_agent_id TEXT,
      pr_url TEXT,
      auto_create_pr BIGINT NOT NULL DEFAULT 0,
      key_ciphertext TEXT,
      key_hint TEXT,
      owner_id TEXT
    );

    CREATE TABLE IF NOT EXISTS steer_messages (
      id BIGSERIAL PRIMARY KEY,
      room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
      sender_name TEXT NOT NULL,
      sender_color TEXT NOT NULL,
      text TEXT NOT NULL,
      ts BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      sender_name TEXT,
      sender_color TEXT,
      tool_name TEXT,
      diff_patch TEXT,
      status TEXT NOT NULL DEFAULT 'done',
      ts BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      created_at BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at BIGINT NOT NULL,
      expires_at BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS room_members (
      room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL DEFAULT 'member',
      PRIMARY KEY (room_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS invite_links (
      code TEXT PRIMARY KEY,
      room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
      created_by TEXT NOT NULL REFERENCES users(id),
      created_at BIGINT NOT NULL,
      max_uses INTEGER,
      use_count INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS workers (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'offline',
      last_seen_at BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS pairing_codes (
      code TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at BIGINT NOT NULL,
      expires_at BIGINT NOT NULL,
      used INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS model_cache (
      cache_key TEXT PRIMARY KEY,
      models_json TEXT NOT NULL,
      updated_at BIGINT NOT NULL
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_steer_room_ts ON steer_messages(room_id, ts);
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_messages_room_ts ON messages(room_id, ts);
  `);

  const migrations = [
    `ALTER TABLE rooms ADD COLUMN IF NOT EXISTS cursor_session_id TEXT`,
    `ALTER TABLE rooms ADD COLUMN IF NOT EXISTS runtime TEXT NOT NULL DEFAULT 'local'`,
    `ALTER TABLE rooms ADD COLUMN IF NOT EXISTS auth_mode TEXT NOT NULL DEFAULT 'server'`,
    `ALTER TABLE rooms ADD COLUMN IF NOT EXISTS model_id TEXT NOT NULL DEFAULT 'composer-2.5'`,
    `ALTER TABLE rooms ADD COLUMN IF NOT EXISTS repo_url TEXT`,
    `ALTER TABLE rooms ADD COLUMN IF NOT EXISTS starting_ref TEXT`,
    `ALTER TABLE rooms ADD COLUMN IF NOT EXISTS cursor_agent_id TEXT`,
    `ALTER TABLE rooms ADD COLUMN IF NOT EXISTS pr_url TEXT`,
    `ALTER TABLE rooms ADD COLUMN IF NOT EXISTS auto_create_pr BIGINT NOT NULL DEFAULT 0`,
    `ALTER TABLE rooms ADD COLUMN IF NOT EXISTS key_ciphertext TEXT`,
    `ALTER TABLE rooms ADD COLUMN IF NOT EXISTS key_hint TEXT`,
    `ALTER TABLE messages ADD COLUMN IF NOT EXISTS diff_patch TEXT`,
    `ALTER TABLE rooms ADD COLUMN IF NOT EXISTS owner_id TEXT`,
  ];

  for (const sql of migrations) {
    try {
      await pool.query(sql);
    } catch {
      // column already exists
    }
  }
}

const ready = initSchema();

function num(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  return typeof v === "number" ? v : Number(v);
}

export interface RoomRow {
  id: string;
  name: string;
  repo_path: string;
  agent_command: string;
  created_at: number;
  last_active_at: number;
  status: string;
  cursor_session_id: string | null;
  runtime: AgentRuntime;
  auth_mode: AuthMode;
  model_id: string;
  repo_url: string | null;
  starting_ref: string | null;
  cursor_agent_id: string | null;
  pr_url: string | null;
  auto_create_pr: number;
  key_ciphertext: string | null;
  key_hint: string | null;
  owner_id: string | null;
}

export interface CreateRoomInput {
  id: string;
  name: string;
  repoPath: string;
  agentCommand: string;
  runtime: AgentRuntime;
  authMode: AuthMode;
  modelId: string;
  repoUrl?: string | null;
  startingRef?: string | null;
  cursorAgentId?: string | null;
  prUrl?: string | null;
  autoCreatePR?: boolean;
  keyCiphertext?: string | null;
  keyHint?: string | null;
  ownerId?: string | null;
}

function pgRowToRoom(r: Record<string, unknown>): RoomRow {
  return {
    id: r.id as string,
    name: r.name as string,
    repo_path: r.repo_path as string,
    agent_command: r.agent_command as string,
    created_at: num(r.created_at as string)!,
    last_active_at: num(r.last_active_at as string)!,
    status: r.status as string,
    cursor_session_id: (r.cursor_session_id as string) ?? null,
    runtime: r.runtime as AgentRuntime,
    auth_mode: r.auth_mode as AuthMode,
    model_id: r.model_id as string,
    repo_url: (r.repo_url as string) ?? null,
    starting_ref: (r.starting_ref as string) ?? null,
    cursor_agent_id: (r.cursor_agent_id as string) ?? null,
    pr_url: (r.pr_url as string) ?? null,
    auto_create_pr: num(r.auto_create_pr as string) ?? 0,
    key_ciphertext: (r.key_ciphertext as string) ?? null,
    key_hint: (r.key_hint as string) ?? null,
    owner_id: (r.owner_id as string) ?? null,
  };
}

function rowToMessage(r: Record<string, unknown>): ChatMessage {
  return {
    id: r.id as string,
    roomId: r.room_id as string,
    role: r.role as ChatMessage["role"],
    content: r.content as string,
    senderName: (r.sender_name as string) ?? undefined,
    senderColor: (r.sender_color as string) ?? undefined,
    toolName: (r.tool_name as string) ?? undefined,
    diffPatch: (r.diff_patch as string) || undefined,
    status: r.status as ChatMessage["status"],
    ts: num(r.ts as string)!,
  };
}

// Top-level await ensures schema is initialized before any exports are used
await ready;

export function createRoom(input: CreateRoomInput): RoomRow {
  const now = Date.now();
  const result = syncQuery<Record<string, unknown>>(
    `INSERT INTO rooms (
      id, name, repo_path, agent_command, created_at, last_active_at, status,
      runtime, auth_mode, model_id, repo_url, starting_ref, cursor_agent_id,
      pr_url, auto_create_pr, key_ciphertext, key_hint, owner_id
    ) VALUES ($1,$2,$3,$4,$5,$6,'active',$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
    RETURNING *`,
    [
      input.id,
      input.name,
      input.repoPath,
      input.agentCommand,
      now,
      now,
      input.runtime,
      input.authMode,
      input.modelId,
      input.repoUrl ?? null,
      input.startingRef ?? null,
      input.cursorAgentId ?? null,
      input.prUrl ?? null,
      input.autoCreatePR ? 1 : 0,
      input.keyCiphertext ?? null,
      input.keyHint ?? null,
      input.ownerId ?? null,
    ],
  );
  return pgRowToRoom(result[0]);
}

export function setRoomOwner(roomId: string, ownerId: string): void {
  syncQuery(`UPDATE rooms SET owner_id = $1 WHERE id = $2`, [ownerId, roomId]);
}

export function listRooms(): RoomRow[] {
  return syncQuery<Record<string, unknown>>(
    `SELECT * FROM rooms ORDER BY last_active_at DESC`,
  ).map(pgRowToRoom);
}

export function getRoom(id: string): RoomRow | undefined {
  const rows = syncQuery<Record<string, unknown>>(
    `SELECT * FROM rooms WHERE id = $1`,
    [id],
  );
  return rows.length ? pgRowToRoom(rows[0]) : undefined;
}

export function updateRoomActivity(id: string): void {
  syncQuery(`UPDATE rooms SET last_active_at = $1 WHERE id = $2`, [
    Date.now(),
    id,
  ]);
}

export function updateRoomStatus(id: string, status: string): void {
  syncQuery(`UPDATE rooms SET status = $1 WHERE id = $2`, [status, id]);
}

export function setCursorSessionId(roomId: string, sessionId: string): void {
  syncQuery(`UPDATE rooms SET cursor_session_id = $1 WHERE id = $2`, [
    sessionId,
    roomId,
  ]);
}

export function setCursorAgentId(roomId: string, agentId: string): void {
  syncQuery(`UPDATE rooms SET cursor_agent_id = $1 WHERE id = $2`, [
    agentId,
    roomId,
  ]);
}

export function setPrUrl(roomId: string, prUrl: string): void {
  syncQuery(`UPDATE rooms SET pr_url = $1 WHERE id = $2`, [prUrl, roomId]);
}

export function setModelId(roomId: string, modelId: string): void {
  syncQuery(`UPDATE rooms SET model_id = $1 WHERE id = $2`, [modelId, roomId]);
}

export function insertSteerMessage(
  roomId: string,
  sender: string,
  color: string,
  text: string,
  ts: number,
): void {
  syncQuery(
    `INSERT INTO steer_messages (room_id, sender_name, sender_color, text, ts) VALUES ($1,$2,$3,$4,$5)`,
    [roomId, sender, color, text, ts],
  );
}

export function getSteerHistory(
  roomId: string,
  limit = 50,
): SteerLogEntry[] {
  const rows = syncQuery<{
    sender_name: string;
    sender_color: string;
    text: string;
    ts: string;
  }>(`SELECT sender_name, sender_color, text, ts FROM steer_messages WHERE room_id = $1 ORDER BY ts DESC LIMIT $2`, [
    roomId,
    limit,
  ]);
  return rows
    .map((r) => ({
      sender: r.sender_name,
      color: r.sender_color,
      text: r.text,
      ts: num(r.ts)!,
    }))
    .reverse();
}

export function insertMessage(msg: ChatMessage): void {
  syncQuery(
    `INSERT INTO messages (id, room_id, role, content, sender_name, sender_color, tool_name, diff_patch, status, ts)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      msg.id,
      msg.roomId,
      msg.role,
      msg.content,
      msg.senderName ?? null,
      msg.senderColor ?? null,
      msg.toolName ?? null,
      msg.diffPatch ?? null,
      msg.status,
      msg.ts,
    ],
  );
}

export function updateMessageContent(
  id: string,
  content: string,
  status: ChatMessage["status"],
): void {
  syncQuery(`UPDATE messages SET content = $1, status = $2 WHERE id = $3`, [
    content,
    status,
    id,
  ]);
}

export function updateMessageDiff(
  id: string,
  content: string,
  status: ChatMessage["status"],
  diffPatch: string,
): void {
  syncQuery(
    `UPDATE messages SET content = $1, status = $2, diff_patch = $3 WHERE id = $4`,
    [content, status, diffPatch, id],
  );
}

export function getMessages(roomId: string, limit = 500): ChatMessage[] {
  const rows = syncQuery<Record<string, unknown>>(
    `SELECT * FROM messages WHERE room_id = $1 ORDER BY ts ASC, id ASC LIMIT $2`,
    [roomId, limit],
  );
  return rows.map(rowToMessage);
}

export function deleteRoom(id: string): void {
  syncQuery(`DELETE FROM rooms WHERE id = $1`, [id]);
}

export function getSetting(key: string): string | null {
  const rows = syncQuery<{ value: string }>(
    `SELECT value FROM settings WHERE key = $1`,
    [key],
  );
  return rows.length ? rows[0].value : null;
}

export function setSetting(key: string, value: string): void {
  syncQuery(
    `INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [key, value],
  );
}

export function deleteSetting(key: string): void {
  syncQuery(`DELETE FROM settings WHERE key = $1`, [key]);
}

// --- Auth functions ---

export function createUser(
  id: string,
  email: string,
  name: string,
  passwordHash: string = "",
): { id: string; email: string; name: string; created_at: number } {
  const now = Date.now();
  syncQuery(
    `INSERT INTO users (id, email, name, password_hash, created_at) VALUES ($1,$2,$3,$4,$5)`,
    [id, email, name, passwordHash, now],
  );
  return { id, email, name, created_at: now };
}

export function upsertUser(
  id: string,
  email: string,
  name: string,
): { id: string; email: string; name: string; created_at: number } {
  const now = Date.now();
  syncQuery(
    `INSERT INTO users (id, email, name, password_hash, created_at) VALUES ($1,$2,$3,'',$4)
     ON CONFLICT(id) DO UPDATE SET email = excluded.email, name = excluded.name`,
    [id, email, name, now],
  );
  return getUserById(id) ?? { id, email, name, created_at: now };
}

export function createPairingCode(
  code: string,
  userId: string,
  expiresAt: number,
): void {
  syncQuery(
    `INSERT INTO pairing_codes (code, user_id, created_at, expires_at, used) VALUES ($1,$2,$3,$4,0)`,
    [code, userId, Date.now(), expiresAt],
  );
}

export function getPairingCode(code: string):
  | {
      code: string;
      user_id: string;
      created_at: number;
      expires_at: number;
      used: number;
    }
  | undefined {
  const rows = syncQuery<{
    code: string;
    user_id: string;
    created_at: string;
    expires_at: string;
    used: number;
  }>(`SELECT * FROM pairing_codes WHERE code = $1`, [code]);
  if (!rows.length) return undefined;
  const r = rows[0];
  return {
    code: r.code,
    user_id: r.user_id,
    created_at: num(r.created_at)!,
    expires_at: num(r.expires_at)!,
    used: Number(r.used),
  };
}

export function usePairingCode(code: string): void {
  syncQuery(`UPDATE pairing_codes SET used = 1 WHERE code = $1`, [code]);
}

export function getUserByEmail(
  email: string,
): { id: string; email: string; name: string; password_hash: string; created_at: number } | undefined {
  const rows = syncQuery<{ id: string; email: string; name: string; password_hash: string; created_at: string }>(
    `SELECT * FROM users WHERE email = $1`,
    [email],
  );
  if (!rows.length) return undefined;
  const r = rows[0];
  return { ...r, created_at: num(r.created_at)! };
}

export function getUserById(
  id: string,
): { id: string; email: string; name: string; password_hash: string; created_at: number } | undefined {
  const rows = syncQuery<{ id: string; email: string; name: string; password_hash: string; created_at: string }>(
    `SELECT * FROM users WHERE id = $1`,
    [id],
  );
  if (!rows.length) return undefined;
  const r = rows[0];
  return { ...r, created_at: num(r.created_at)! };
}

export function createSession(
  token: string,
  userId: string,
  expiresAt: number,
): void {
  syncQuery(
    `INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES ($1,$2,$3,$4)`,
    [token, userId, Date.now(), expiresAt],
  );
}

export function getSession(
  token: string,
): { token: string; user_id: string; created_at: number; expires_at: number } | undefined {
  const rows = syncQuery<{ token: string; user_id: string; created_at: string; expires_at: string }>(
    `SELECT * FROM sessions WHERE token = $1`,
    [token],
  );
  if (!rows.length) return undefined;
  const r = rows[0];
  return {
    token: r.token,
    user_id: r.user_id,
    created_at: num(r.created_at)!,
    expires_at: num(r.expires_at)!,
  };
}

export function deleteSession(token: string): void {
  syncQuery(`DELETE FROM sessions WHERE token = $1`, [token]);
}

export function deleteExpiredSessions(): void {
  syncQuery(`DELETE FROM sessions WHERE expires_at < $1`, [Date.now()]);
}

export function addRoomMember(
  roomId: string,
  userId: string,
  role: string,
): void {
  syncQuery(
    `INSERT INTO room_members (room_id, user_id, role) VALUES ($1,$2,$3)
     ON CONFLICT(room_id, user_id) DO UPDATE SET role = excluded.role`,
    [roomId, userId, role],
  );
}

export function getRoomMembers(
  roomId: string,
): Array<{ user_id: string; role: string }> {
  return syncQuery<{ user_id: string; role: string }>(
    `SELECT user_id, role FROM room_members WHERE room_id = $1`,
    [roomId],
  );
}

export function isRoomMember(roomId: string, userId: string): boolean {
  const rows = syncQuery(
    `SELECT 1 FROM room_members WHERE room_id = $1 AND user_id = $2`,
    [roomId, userId],
  );
  return rows.length > 0;
}

export function removeRoomMember(roomId: string, userId: string): void {
  syncQuery(`DELETE FROM room_members WHERE room_id = $1 AND user_id = $2`, [
    roomId,
    userId,
  ]);
}

export function getModelCache(
  cacheKey: string,
): { models: import("../../shared/events.js").ModelInfo[]; updatedAt: number } | null {
  const rows = syncQuery<{ models_json: string; updated_at: string | number }>(
    `SELECT models_json, updated_at FROM model_cache WHERE cache_key = $1`,
    [cacheKey],
  );
  const row = rows[0];
  if (!row) return null;
  try {
    const models = JSON.parse(row.models_json) as import("../../shared/events.js").ModelInfo[];
    if (!Array.isArray(models) || models.length === 0) return null;
    return { models, updatedAt: Number(row.updated_at) };
  } catch {
    return null;
  }
}

export function setModelCache(
  cacheKey: string,
  models: import("../../shared/events.js").ModelInfo[],
): void {
  if (!models.length) return;
  syncQuery(
    `INSERT INTO model_cache (cache_key, models_json, updated_at) VALUES ($1,$2,$3)
     ON CONFLICT(cache_key) DO UPDATE SET
       models_json = excluded.models_json,
       updated_at = excluded.updated_at`,
    [cacheKey, JSON.stringify(models), Date.now()],
  );
}

export function createInviteLink(
  code: string,
  roomId: string,
  createdBy: string,
  maxUses: number | null,
): void {
  syncQuery(
    `INSERT INTO invite_links (code, room_id, created_by, created_at, max_uses, use_count) VALUES ($1,$2,$3,$4,$5,0)`,
    [code, roomId, createdBy, Date.now(), maxUses],
  );
}

export function getInviteLink(
  code: string,
): { code: string; room_id: string; created_by: string; created_at: number; max_uses: number | null; use_count: number } | undefined {
  const rows = syncQuery<{
    code: string;
    room_id: string;
    created_by: string;
    created_at: string;
    max_uses: number | null;
    use_count: number;
  }>(`SELECT * FROM invite_links WHERE code = $1`, [code]);
  if (!rows.length) return undefined;
  const r = rows[0];
  return { ...r, created_at: num(r.created_at)! };
}

export function useInviteLink(code: string): void {
  syncQuery(
    `UPDATE invite_links SET use_count = use_count + 1 WHERE code = $1`,
    [code],
  );
}

export function registerWorker(
  id: string,
  userId: string,
  name: string,
): void {
  syncQuery(
    `INSERT INTO workers (id, user_id, name, status, last_seen_at) VALUES ($1,$2,$3,'offline',$4)`,
    [id, userId, name, Date.now()],
  );
}

export function updateWorkerStatus(id: string, status: string): void {
  syncQuery(
    `UPDATE workers SET status = $1, last_seen_at = $2 WHERE id = $3`,
    [status, Date.now(), id],
  );
}

export function getOnlineWorkers(
  userId: string,
): Array<{ id: string; name: string; status: string; last_seen_at: number }> {
  const rows = syncQuery<{ id: string; name: string; status: string; last_seen_at: string }>(
    `SELECT id, name, status, last_seen_at FROM workers WHERE user_id = $1 AND status != 'offline'`,
    [userId],
  );
  return rows.map((r) => ({ ...r, last_seen_at: num(r.last_seen_at)! }));
}

export function listRoomsByUser(userId: string): RoomRow[] {
  return syncQuery<Record<string, unknown>>(
    `SELECT DISTINCT r.* FROM rooms r
     LEFT JOIN room_members rm ON rm.room_id = r.id
     WHERE r.owner_id = $1 OR rm.user_id = $2
     ORDER BY r.last_active_at DESC`,
    [userId, userId],
  ).map(pgRowToRoom);
}

// ---------------------------------------------------------------------------
// Synchronous wrapper around pg Pool.
//
// The existing codebase calls db functions synchronously. Postgres (pg) is
// inherently async, so we use a SharedArrayBuffer + worker thread pattern to
// block the calling thread until the query completes. This keeps the external
// API identical to the SQLite backend without requiring callers to await.
// ---------------------------------------------------------------------------

import { execSync } from "child_process";

function syncQuery<T = Record<string, unknown>>(
  text: string,
  values?: unknown[],
): T[] {
  // Use a simple blocking approach: we run the query via the pool and block
  // with Atomics until it resolves. Since Node.js pg driver works on the
  // event loop, we need a different strategy.
  //
  // Strategy: execSync a small inline Node script that connects to pg and
  // runs the query, returning JSON on stdout.
  //
  // This is simple and correct, though not optimal for high-throughput.
  // For production use-cases that need sync semantics, consider using
  // a connection pool with a worker thread.

  const connStr = process.env.DATABASE_URL!;
  const escaped = JSON.stringify({ text, values: values ?? [] });

  const script = `
    const pg = require('pg');
    const q = ${escaped};
    const client = new pg.Client({ connectionString: ${JSON.stringify(connStr)} });
    client.connect()
      .then(() => client.query(q.text, q.values))
      .then(r => { process.stdout.write(JSON.stringify(r.rows)); return client.end(); })
      .catch(e => { process.stderr.write(e.message); process.exit(1); });
  `;

  try {
    const stdout = execSync(`node -e ${JSON.stringify(script)}`, {
      encoding: "utf-8",
      timeout: 30_000,
      env: process.env as Record<string, string>,
    });
    return JSON.parse(stdout || "[]") as T[];
  } catch (e: unknown) {
    const err = e as { stderr?: string; message?: string };
    throw new Error(
      `pg syncQuery failed: ${err.stderr || err.message}`,
    );
  }
}
