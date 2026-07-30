import Database from "better-sqlite3";
import { mkdirSync } from "fs";
import { dirname, resolve } from "path";
import { randomBytes } from "crypto";
import type {
  AgentBackendKind,
  AgentRuntime,
  AgentStatus,
  AuthMode,
  ChatMessage,
  SteerLogEntry,
} from "../../shared/events.js";

function newId(prefix = ""): string {
  return `${prefix}${randomBytes(8).toString("hex")}`;
}

function resolveDbPath(): string {
  const configured =
    process.env.SQLITE_PATH?.trim() || process.env.DB_PATH?.trim();
  const preferred = configured
    ? resolve(configured)
    : resolve(import.meta.dirname, "../../data.db");

  try {
    mkdirSync(dirname(preferred), { recursive: true });
    return preferred;
  } catch (err) {
    // e.g. /var/data without a Render disk → fall back to project-local path
    const fallback = resolve(import.meta.dirname, "../../data/steer.db");
    console.warn(
      `[db] Cannot create ${dirname(preferred)} (${err instanceof Error ? err.message : err}); using ${fallback}`,
    );
    mkdirSync(dirname(fallback), { recursive: true });
    return fallback;
  }
}

const DB_PATH = resolveDbPath();
console.log(`[db] SQLite at ${DB_PATH}`);
const db = new Database(DB_PATH);

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS rooms (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    repo_path TEXT NOT NULL,
    agent_command TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    last_active_at INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    cursor_session_id TEXT,
    runtime TEXT NOT NULL DEFAULT 'local',
    auth_mode TEXT NOT NULL DEFAULT 'cli',
    model_id TEXT NOT NULL DEFAULT 'composer-2.5',
    repo_url TEXT,
    starting_ref TEXT,
    cursor_agent_id TEXT,
    pr_url TEXT,
    auto_create_pr INTEGER NOT NULL DEFAULT 0,
    key_ciphertext TEXT,
    key_hint TEXT,
    owner_id TEXT
  );

  CREATE TABLE IF NOT EXISTS steer_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    sender_name TEXT NOT NULL,
    sender_color TEXT NOT NULL,
    text TEXT NOT NULL,
    ts INTEGER NOT NULL
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
    ts INTEGER NOT NULL
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
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
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
    created_at INTEGER NOT NULL,
    max_uses INTEGER,
    use_count INTEGER NOT NULL DEFAULT 0,
    expires_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS workers (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'offline',
    last_seen_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS pairing_codes (
    code TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    used INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS model_cache (
    cache_key TEXT PRIMARY KEY,
    models_json TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY,
    room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    backend TEXT NOT NULL DEFAULT 'cursor',
    label TEXT NOT NULL,
    scope_path TEXT,
    session_id TEXT,
    sdk_agent_id TEXT,
    model_id TEXT NOT NULL DEFAULT 'auto',
    status TEXT NOT NULL DEFAULT 'idle',
    branch TEXT,
    pr_url TEXT,
    created_by TEXT,
    created_at INTEGER NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS agent_drivers (
    agent_id TEXT PRIMARY KEY REFERENCES agents(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL,
    granted_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS file_locks (
    room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    path TEXT NOT NULL,
    agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    call_id TEXT,
    acquired_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    PRIMARY KEY (room_id, path)
  );

  CREATE INDEX IF NOT EXISTS idx_steer_room_ts ON steer_messages(room_id, ts);
  CREATE INDEX IF NOT EXISTS idx_messages_room_ts ON messages(room_id, ts);
  CREATE INDEX IF NOT EXISTS idx_agents_room ON agents(room_id, sort_order);
`);

const migrations = [
  `ALTER TABLE rooms ADD COLUMN cursor_session_id TEXT`,
  `ALTER TABLE rooms ADD COLUMN runtime TEXT NOT NULL DEFAULT 'local'`,
  `ALTER TABLE rooms ADD COLUMN auth_mode TEXT NOT NULL DEFAULT 'server'`,
  `ALTER TABLE rooms ADD COLUMN model_id TEXT NOT NULL DEFAULT 'composer-2.5'`,
  `ALTER TABLE rooms ADD COLUMN repo_url TEXT`,
  `ALTER TABLE rooms ADD COLUMN starting_ref TEXT`,
  `ALTER TABLE rooms ADD COLUMN cursor_agent_id TEXT`,
  `ALTER TABLE rooms ADD COLUMN pr_url TEXT`,
  `ALTER TABLE rooms ADD COLUMN auto_create_pr INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE rooms ADD COLUMN key_ciphertext TEXT`,
  `ALTER TABLE rooms ADD COLUMN key_hint TEXT`,
  `ALTER TABLE messages ADD COLUMN diff_patch TEXT`,
  `ALTER TABLE rooms ADD COLUMN owner_id TEXT`,
  `ALTER TABLE invite_links ADD COLUMN expires_at INTEGER`,
  `ALTER TABLE messages ADD COLUMN agent_id TEXT`,
];

for (const sql of migrations) {
  try {
    db.exec(sql);
  } catch {
    // column already exists
  }
}

try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS model_cache (
      cache_key TEXT PRIMARY KEY,
      models_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
} catch {
  // ignore
}

try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS file_locks (
      room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
      path TEXT NOT NULL,
      agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      call_id TEXT,
      acquired_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      PRIMARY KEY (room_id, path)
    );
  `);
} catch {
  // ignore
}

const stmts = {
  insertRoom: db.prepare(`
    INSERT INTO rooms (
      id, name, repo_path, agent_command, created_at, last_active_at, status,
      runtime, auth_mode, model_id, repo_url, starting_ref, cursor_agent_id,
      cursor_session_id, pr_url, auto_create_pr, key_ciphertext, key_hint, owner_id
    ) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),
  updateRoomOwner: db.prepare(`UPDATE rooms SET owner_id = ? WHERE id = ?`),
  listRooms: db.prepare(`SELECT * FROM rooms ORDER BY last_active_at DESC`),
  getRoom: db.prepare(`SELECT * FROM rooms WHERE id = ?`),
  updateActivity: db.prepare(
    `UPDATE rooms SET last_active_at = ? WHERE id = ?`,
  ),
  updateStatus: db.prepare(`UPDATE rooms SET status = ? WHERE id = ?`),
  updateCursorSession: db.prepare(
    `UPDATE rooms SET cursor_session_id = ? WHERE id = ?`,
  ),
  updateCursorAgentId: db.prepare(
    `UPDATE rooms SET cursor_agent_id = ? WHERE id = ?`,
  ),
  updatePrUrl: db.prepare(`UPDATE rooms SET pr_url = ? WHERE id = ?`),
  updateModelId: db.prepare(`UPDATE rooms SET model_id = ? WHERE id = ?`),
  insertSteer: db.prepare(`
    INSERT INTO steer_messages (room_id, sender_name, sender_color, text, ts)
    VALUES (?, ?, ?, ?, ?)
  `),
  getSteerHistory: db.prepare(`
    SELECT sender_name, sender_color, text, ts
    FROM steer_messages WHERE room_id = ?
    ORDER BY ts DESC LIMIT ?
  `),
  insertMessage: db.prepare(`
    INSERT INTO messages (id, room_id, role, content, sender_name, sender_color, tool_name, diff_patch, status, ts, agent_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),
  updateMessageContent: db.prepare(
    `UPDATE messages SET content = ?, status = ? WHERE id = ?`,
  ),
  updateMessageDiff: db.prepare(
    `UPDATE messages SET content = ?, status = ?, diff_patch = ? WHERE id = ?`,
  ),
  // Newest-first so LIMIT keeps recent history; reversed in getMessages().
  getMessages: db.prepare(`
    SELECT * FROM messages WHERE room_id = ?
    ORDER BY ts DESC, rowid DESC LIMIT ?
  `),
  deleteRoom: db.prepare(`DELETE FROM rooms WHERE id = ?`),
  getSetting: db.prepare(`SELECT value FROM settings WHERE key = ?`),
  setSetting: db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `),
  deleteSetting: db.prepare(`DELETE FROM settings WHERE key = ?`),

  insertAgent: db.prepare(`
    INSERT INTO agents (
      id, room_id, backend, label, scope_path, session_id, sdk_agent_id,
      model_id, status, branch, pr_url, created_by, created_at, sort_order
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),
  getAgent: db.prepare(`SELECT * FROM agents WHERE id = ?`),
  listAgents: db.prepare(`
    SELECT * FROM agents WHERE room_id = ? ORDER BY sort_order ASC, created_at ASC
  `),
  updateAgentStatus: db.prepare(`UPDATE agents SET status = ? WHERE id = ?`),
  updateAgentSessionId: db.prepare(`UPDATE agents SET session_id = ? WHERE id = ?`),
  updateAgentSdkId: db.prepare(`UPDATE agents SET sdk_agent_id = ? WHERE id = ?`),
  updateAgentModel: db.prepare(`UPDATE agents SET model_id = ? WHERE id = ?`),
  updateAgentLabel: db.prepare(`UPDATE agents SET label = ? WHERE id = ?`),
  updateAgentScope: db.prepare(`UPDATE agents SET scope_path = ? WHERE id = ?`),
  updateAgentPr: db.prepare(`UPDATE agents SET pr_url = ?, branch = ? WHERE id = ?`),
  deleteAgent: db.prepare(`DELETE FROM agents WHERE id = ?`),
  setAgentDriver: db.prepare(`
    INSERT INTO agent_drivers (agent_id, user_id, granted_at) VALUES (?, ?, ?)
    ON CONFLICT(agent_id) DO UPDATE SET user_id = excluded.user_id, granted_at = excluded.granted_at
  `),
  clearAgentDriver: db.prepare(`DELETE FROM agent_drivers WHERE agent_id = ?`),
  getAgentDrivers: db.prepare(`
    SELECT ad.agent_id, ad.user_id, ad.granted_at
    FROM agent_drivers ad
    JOIN agents a ON a.id = ad.agent_id
    WHERE a.room_id = ?
  `),
  backfillMessagesAgent: db.prepare(
    `UPDATE messages SET agent_id = ? WHERE room_id = ? AND agent_id IS NULL`,
  ),
  countAgents: db.prepare(`SELECT COUNT(*) AS c FROM agents WHERE room_id = ?`),

  upsertFileLock: db.prepare(`
    INSERT INTO file_locks (room_id, path, agent_id, call_id, acquired_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(room_id, path) DO UPDATE SET
      agent_id = excluded.agent_id,
      call_id = excluded.call_id,
      acquired_at = excluded.acquired_at,
      expires_at = excluded.expires_at
  `),
  getFileLock: db.prepare(
    `SELECT * FROM file_locks WHERE room_id = ? AND path = ?`,
  ),
  listFileLocks: db.prepare(
    `SELECT * FROM file_locks WHERE room_id = ? ORDER BY path ASC`,
  ),
  listAllFileLocks: db.prepare(`SELECT * FROM file_locks`),
  deleteFileLock: db.prepare(
    `DELETE FROM file_locks WHERE room_id = ? AND path = ?`,
  ),
  deleteFileLocksForAgent: db.prepare(
    `DELETE FROM file_locks WHERE room_id = ? AND agent_id = ?`,
  ),
  deleteFileLocksForRoom: db.prepare(
    `DELETE FROM file_locks WHERE room_id = ?`,
  ),
  deleteExpiredFileLocks: db.prepare(
    `DELETE FROM file_locks WHERE expires_at <= ?`,
  ),
  deleteExpiredFileLocksForRoom: db.prepare(
    `DELETE FROM file_locks WHERE room_id = ? AND expires_at <= ?`,
  ),

  // Auth
  insertUser: db.prepare(`
    INSERT INTO users (id, email, name, password_hash, created_at)
    VALUES (?, ?, ?, ?, ?)
  `),
  upsertUser: db.prepare(`
    INSERT INTO users (id, email, name, password_hash, created_at)
    VALUES (?, ?, ?, '', ?)
    ON CONFLICT(id) DO UPDATE SET
      email = excluded.email,
      name = excluded.name
  `),
  getUserByEmail: db.prepare(`SELECT * FROM users WHERE email = ?`),
  getUserById: db.prepare(`SELECT * FROM users WHERE id = ?`),
  insertSession: db.prepare(`
    INSERT INTO sessions (token, user_id, created_at, expires_at)
    VALUES (?, ?, ?, ?)
  `),
  getSession: db.prepare(`SELECT * FROM sessions WHERE token = ?`),
  deleteSession: db.prepare(`DELETE FROM sessions WHERE token = ?`),
  deleteExpiredSessions: db.prepare(
    `DELETE FROM sessions WHERE expires_at < ?`,
  ),
  insertPairingCode: db.prepare(`
    INSERT INTO pairing_codes (code, user_id, created_at, expires_at, used)
    VALUES (?, ?, ?, ?, 0)
  `),
  getPairingCode: db.prepare(`SELECT * FROM pairing_codes WHERE code = ?`),
  usePairingCode: db.prepare(
    `UPDATE pairing_codes SET used = 1 WHERE code = ?`,
  ),
  addRoomMember: db.prepare(`
    INSERT INTO room_members (room_id, user_id, role) VALUES (?, ?, ?)
    ON CONFLICT(room_id, user_id) DO UPDATE SET role = excluded.role
  `),
  removeRoomMember: db.prepare(
    `DELETE FROM room_members WHERE room_id = ? AND user_id = ?`,
  ),
  getRoomMembers: db.prepare(
    `SELECT user_id, role FROM room_members WHERE room_id = ?`,
  ),
  isRoomMember: db.prepare(
    `SELECT 1 FROM room_members WHERE room_id = ? AND user_id = ?`,
  ),
  getModelCache: db.prepare(
    `SELECT models_json, updated_at FROM model_cache WHERE cache_key = ?`,
  ),
  setModelCache: db.prepare(`
    INSERT INTO model_cache (cache_key, models_json, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(cache_key) DO UPDATE SET
      models_json = excluded.models_json,
      updated_at = excluded.updated_at
  `),
  insertInviteLink: db.prepare(`
    INSERT INTO invite_links (code, room_id, created_by, created_at, max_uses, use_count, expires_at)
    VALUES (?, ?, ?, ?, ?, 0, ?)
  `),
  getInviteLink: db.prepare(`SELECT * FROM invite_links WHERE code = ?`),
  listInviteLinks: db.prepare(`
    SELECT * FROM invite_links WHERE room_id = ?
    ORDER BY created_at DESC
  `),
  deleteInviteLink: db.prepare(`DELETE FROM invite_links WHERE code = ?`),
  useInviteLink: db.prepare(
    `UPDATE invite_links SET use_count = use_count + 1
     WHERE code = ?
       AND (max_uses IS NULL OR use_count < max_uses)
       AND (expires_at IS NULL OR expires_at > ?)`,
  ),
  insertWorker: db.prepare(`
    INSERT INTO workers (id, user_id, name, status, last_seen_at)
    VALUES (?, ?, ?, 'offline', ?)
  `),
  updateWorkerStatus: db.prepare(
    `UPDATE workers SET status = ?, last_seen_at = ? WHERE id = ?`,
  ),
  getOnlineWorkers: db.prepare(
    `SELECT id, name, status, last_seen_at FROM workers WHERE user_id = ? AND status != 'offline'`,
  ),
  listRoomsByUser: db.prepare(`
    SELECT DISTINCT r.* FROM rooms r
    LEFT JOIN room_members rm ON rm.room_id = r.id
    WHERE r.owner_id = ? OR rm.user_id = ?
    ORDER BY r.last_active_at DESC
  `),
};

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
  cursorSessionId?: string | null;
  prUrl?: string | null;
  autoCreatePR?: boolean;
  keyCiphertext?: string | null;
  keyHint?: string | null;
  ownerId?: string | null;
}

function rowToMessage(r: {
  id: string;
  room_id: string;
  role: string;
  content: string;
  sender_name: string | null;
  sender_color: string | null;
  tool_name: string | null;
  diff_patch?: string | null;
  status: string;
  ts: number;
  agent_id?: string | null;
}): ChatMessage {
  return {
    id: r.id,
    roomId: r.room_id,
    role: r.role as ChatMessage["role"],
    content: r.content,
    senderName: r.sender_name ?? undefined,
    senderColor: r.sender_color ?? undefined,
    toolName: r.tool_name ?? undefined,
    diffPatch: r.diff_patch || undefined,
    status: r.status as ChatMessage["status"],
    ts: r.ts,
    agentId: r.agent_id || undefined,
  };
}

export interface AgentRow {
  id: string;
  room_id: string;
  backend: AgentBackendKind;
  label: string;
  scope_path: string | null;
  session_id: string | null;
  sdk_agent_id: string | null;
  model_id: string;
  status: AgentStatus;
  branch: string | null;
  pr_url: string | null;
  created_by: string | null;
  created_at: number;
  sort_order: number;
}

export interface CreateAgentInput {
  id?: string;
  roomId: string;
  backend?: AgentBackendKind;
  label: string;
  scopePath?: string | null;
  sessionId?: string | null;
  sdkAgentId?: string | null;
  modelId?: string;
  status?: AgentStatus;
  branch?: string | null;
  prUrl?: string | null;
  createdBy?: string | null;
  sortOrder?: number;
}

export function createRoom(input: CreateRoomInput): RoomRow {
  const now = Date.now();
  stmts.insertRoom.run(
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
    input.cursorSessionId ?? null,
    input.prUrl ?? null,
    input.autoCreatePR ? 1 : 0,
    input.keyCiphertext ?? null,
    input.keyHint ?? null,
    input.ownerId ?? null,
  );
  return stmts.getRoom.get(input.id) as RoomRow;
}

export function setRoomOwner(roomId: string, ownerId: string): void {
  stmts.updateRoomOwner.run(ownerId, roomId);
}

export function listRooms(): RoomRow[] {
  return stmts.listRooms.all() as RoomRow[];
}

export function getRoom(id: string): RoomRow | undefined {
  return stmts.getRoom.get(id) as RoomRow | undefined;
}

export function updateRoomActivity(id: string): void {
  stmts.updateActivity.run(Date.now(), id);
}

export function updateRoomStatus(id: string, status: string): void {
  stmts.updateStatus.run(status, id);
}

export function setCursorSessionId(roomId: string, sessionId: string): void {
  stmts.updateCursorSession.run(sessionId, roomId);
}

export function setCursorAgentId(roomId: string, agentId: string): void {
  stmts.updateCursorAgentId.run(agentId, roomId);
}

export function setPrUrl(roomId: string, prUrl: string): void {
  stmts.updatePrUrl.run(prUrl, roomId);
}

export function setModelId(roomId: string, modelId: string): void {
  stmts.updateModelId.run(modelId, roomId);
}

export function insertSteerMessage(
  roomId: string,
  sender: string,
  color: string,
  text: string,
  ts: number,
): void {
  stmts.insertSteer.run(roomId, sender, color, text, ts);
}

export function getSteerHistory(roomId: string, limit = 50): SteerLogEntry[] {
  const rows = stmts.getSteerHistory.all(roomId, limit) as Array<{
    sender_name: string;
    sender_color: string;
    text: string;
    ts: number;
  }>;
  return rows
    .map((r) => ({
      sender: r.sender_name,
      color: r.sender_color,
      text: r.text,
      ts: r.ts,
    }))
    .reverse();
}

export function insertMessage(msg: ChatMessage): void {
  stmts.insertMessage.run(
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
    msg.agentId ?? null,
  );
}

export function updateMessageContent(
  id: string,
  content: string,
  status: ChatMessage["status"],
): void {
  stmts.updateMessageContent.run(content, status, id);
}

export function updateMessageDiff(
  id: string,
  content: string,
  status: ChatMessage["status"],
  diffPatch: string,
): void {
  stmts.updateMessageDiff.run(content, status, diffPatch, id);
}

export function getMessages(roomId: string, limit = 500): ChatMessage[] {
  const rows = stmts.getMessages.all(roomId, limit) as Array<{
    id: string;
    room_id: string;
    role: string;
    content: string;
    sender_name: string | null;
    sender_color: string | null;
    tool_name: string | null;
    diff_patch: string | null;
    status: string;
    ts: number;
    agent_id: string | null;
  }>;
  // Query is newest-first (LIMIT); chat UI expects chronological order.
  return rows.map(rowToMessage).reverse();
}

export function deleteRoom(id: string): void {
  stmts.deleteRoom.run(id);
}

export function getSetting(key: string): string | null {
  const row = stmts.getSetting.get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setSetting(key: string, value: string): void {
  stmts.setSetting.run(key, value);
}

export function deleteSetting(key: string): void {
  stmts.deleteSetting.run(key);
}

// --- Auth functions ---

export function createUser(
  id: string,
  email: string,
  name: string,
  passwordHash: string = "",
): { id: string; email: string; name: string; created_at: number } {
  const now = Date.now();
  stmts.insertUser.run(id, email, name, passwordHash, now);
  return { id, email, name, created_at: now };
}

/** Upsert a Clerk-backed user (id = Clerk user id). */
export function upsertUser(
  id: string,
  email: string,
  name: string,
): { id: string; email: string; name: string; created_at: number } {
  const now = Date.now();
  stmts.upsertUser.run(id, email, name, now);
  const row = stmts.getUserById.get(id) as
    | { id: string; email: string; name: string; created_at: number }
    | undefined;
  return row ?? { id, email, name, created_at: now };
}

export function createPairingCode(
  code: string,
  userId: string,
  expiresAt: number,
): void {
  stmts.insertPairingCode.run(code, userId, Date.now(), expiresAt);
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
  return stmts.getPairingCode.get(code) as
    | {
        code: string;
        user_id: string;
        created_at: number;
        expires_at: number;
        used: number;
      }
    | undefined;
}

export function usePairingCode(code: string): void {
  stmts.usePairingCode.run(code);
}

export function getUserByEmail(
  email: string,
): { id: string; email: string; name: string; password_hash: string; created_at: number } | undefined {
  return stmts.getUserByEmail.get(email) as
    | { id: string; email: string; name: string; password_hash: string; created_at: number }
    | undefined;
}

export function getUserById(
  id: string,
): { id: string; email: string; name: string; password_hash: string; created_at: number } | undefined {
  return stmts.getUserById.get(id) as
    | { id: string; email: string; name: string; password_hash: string; created_at: number }
    | undefined;
}

export function createSession(
  token: string,
  userId: string,
  expiresAt: number,
): void {
  stmts.insertSession.run(token, userId, Date.now(), expiresAt);
}

export function getSession(
  token: string,
): { token: string; user_id: string; created_at: number; expires_at: number } | undefined {
  return stmts.getSession.get(token) as
    | { token: string; user_id: string; created_at: number; expires_at: number }
    | undefined;
}

export function deleteSession(token: string): void {
  stmts.deleteSession.run(token);
}

export function deleteExpiredSessions(): void {
  stmts.deleteExpiredSessions.run(Date.now());
}

export function addRoomMember(
  roomId: string,
  userId: string,
  role: string,
): void {
  stmts.addRoomMember.run(roomId, userId, role);
}

export function getRoomMembers(
  roomId: string,
): Array<{ user_id: string; role: string }> {
  return stmts.getRoomMembers.all(roomId) as Array<{
    user_id: string;
    role: string;
  }>;
}

export function isRoomMember(roomId: string, userId: string): boolean {
  return stmts.isRoomMember.get(roomId, userId) !== undefined;
}

export function removeRoomMember(roomId: string, userId: string): void {
  stmts.removeRoomMember.run(roomId, userId);
}

export function getModelCache(
  cacheKey: string,
): { models: import("../../shared/events.js").ModelInfo[]; updatedAt: number } | null {
  const row = stmts.getModelCache.get(cacheKey) as
    | { models_json: string; updated_at: number }
    | undefined;
  if (!row) return null;
  try {
    const models = JSON.parse(row.models_json) as import("../../shared/events.js").ModelInfo[];
    if (!Array.isArray(models) || models.length === 0) return null;
    return { models, updatedAt: row.updated_at };
  } catch {
    return null;
  }
}

export function setModelCache(
  cacheKey: string,
  models: import("../../shared/events.js").ModelInfo[],
): void {
  if (!models.length) return;
  stmts.setModelCache.run(cacheKey, JSON.stringify(models), Date.now());
}

export function createInviteLink(
  code: string,
  roomId: string,
  createdBy: string,
  maxUses: number | null,
  expiresAt: number | null = null,
): void {
  stmts.insertInviteLink.run(
    code,
    roomId,
    createdBy,
    Date.now(),
    maxUses,
    expiresAt,
  );
}

export type InviteLinkRow = {
  code: string;
  room_id: string;
  created_by: string;
  created_at: number;
  max_uses: number | null;
  use_count: number;
  expires_at: number | null;
};

export function getInviteLink(code: string): InviteLinkRow | undefined {
  return stmts.getInviteLink.get(code) as InviteLinkRow | undefined;
}

export function listInviteLinks(roomId: string): InviteLinkRow[] {
  return stmts.listInviteLinks.all(roomId) as InviteLinkRow[];
}

export function deleteInviteLink(code: string): boolean {
  const result = stmts.deleteInviteLink.run(code);
  return result.changes > 0;
}

/** Atomically increment use_count if under maxUses and not expired. */
export function useInviteLink(code: string): boolean {
  const result = stmts.useInviteLink.run(code, Date.now());
  return result.changes > 0;
}

export function registerWorker(
  id: string,
  userId: string,
  name: string,
): void {
  stmts.insertWorker.run(id, userId, name, Date.now());
}

export function updateWorkerStatus(id: string, status: string): void {
  stmts.updateWorkerStatus.run(status, Date.now(), id);
}

export function getOnlineWorkers(
  userId: string,
): Array<{ id: string; name: string; status: string; last_seen_at: number }> {
  return stmts.getOnlineWorkers.all(userId) as Array<{
    id: string;
    name: string;
    status: string;
    last_seen_at: number;
  }>;
}

export function listRoomsByUser(userId: string): RoomRow[] {
  return stmts.listRoomsByUser.all(userId, userId) as RoomRow[];
}

// --- Agents ---

function rowToAgent(r: Record<string, unknown>): AgentRow {
  return {
    id: r.id as string,
    room_id: r.room_id as string,
    backend: (r.backend as AgentBackendKind) || "cursor",
    label: r.label as string,
    scope_path: (r.scope_path as string) ?? null,
    session_id: (r.session_id as string) ?? null,
    sdk_agent_id: (r.sdk_agent_id as string) ?? null,
    model_id: (r.model_id as string) || "auto",
    status: (r.status as AgentStatus) || "idle",
    branch: (r.branch as string) ?? null,
    pr_url: (r.pr_url as string) ?? null,
    created_by: (r.created_by as string) ?? null,
    created_at: r.created_at as number,
    sort_order: (r.sort_order as number) ?? 0,
  };
}

export function createAgent(input: CreateAgentInput): AgentRow {
  const id = input.id || newId("ag_");
  const now = Date.now();
  const existing = stmts.listAgents.all(input.roomId) as AgentRow[];
  const sortOrder =
    input.sortOrder ??
    (existing.length ? Math.max(...existing.map((a) => a.sort_order)) + 1 : 0);
  stmts.insertAgent.run(
    id,
    input.roomId,
    input.backend ?? "cursor",
    input.label,
    input.scopePath ?? null,
    input.sessionId ?? null,
    input.sdkAgentId ?? null,
    input.modelId ?? "auto",
    input.status ?? "idle",
    input.branch ?? null,
    input.prUrl ?? null,
    input.createdBy ?? null,
    now,
    sortOrder,
  );
  return stmts.getAgent.get(id) as AgentRow;
}

export function getAgent(id: string): AgentRow | undefined {
  const row = stmts.getAgent.get(id) as Record<string, unknown> | undefined;
  return row ? rowToAgent(row) : undefined;
}

export function listAgents(roomId: string): AgentRow[] {
  return (stmts.listAgents.all(roomId) as Array<Record<string, unknown>>).map(
    rowToAgent,
  );
}

export function updateAgentStatus(id: string, status: AgentStatus): void {
  stmts.updateAgentStatus.run(status, id);
}

export function setAgentSessionId(
  id: string,
  sessionId: string | null,
): void {
  stmts.updateAgentSessionId.run(sessionId, id);
}

export function setAgentSdkId(id: string, sdkAgentId: string | null): void {
  stmts.updateAgentSdkId.run(sdkAgentId, id);
}

export function setAgentModel(id: string, modelId: string): void {
  stmts.updateAgentModel.run(modelId, id);
}

export function setAgentLabel(id: string, label: string): void {
  stmts.updateAgentLabel.run(label, id);
}

export function setAgentScope(id: string, scopePath: string | null): void {
  stmts.updateAgentScope.run(scopePath, id);
}

export function setAgentPr(
  id: string,
  prUrl: string | null,
  branch?: string | null,
): void {
  const existing = getAgent(id);
  stmts.updateAgentPr.run(
    prUrl,
    branch !== undefined ? branch : (existing?.branch ?? null),
    id,
  );
}

export function deleteAgent(id: string): void {
  stmts.deleteAgent.run(id);
}

export function setAgentDriver(agentId: string, userId: string): void {
  stmts.setAgentDriver.run(agentId, userId, Date.now());
}

export function clearAgentDriver(agentId: string): void {
  stmts.clearAgentDriver.run(agentId);
}

export function getAgentDrivers(
  roomId: string,
): Array<{ agent_id: string; user_id: string; granted_at: number }> {
  return stmts.getAgentDrivers.all(roomId) as Array<{
    agent_id: string;
    user_id: string;
    granted_at: number;
  }>;
}

/** One-shot backfill: every room gets a default agent. Idempotent via settings key. */
export interface FileLockRow {
  room_id: string;
  path: string;
  agent_id: string;
  call_id: string | null;
  acquired_at: number;
  expires_at: number;
}

export interface UpsertFileLockInput {
  roomId: string;
  path: string;
  agentId: string;
  callId?: string | null;
  acquiredAt: number;
  expiresAt: number;
}

export function upsertFileLock(input: UpsertFileLockInput): void {
  stmts.upsertFileLock.run(
    input.roomId,
    input.path,
    input.agentId,
    input.callId ?? null,
    input.acquiredAt,
    input.expiresAt,
  );
}

export function getFileLock(
  roomId: string,
  path: string,
): FileLockRow | undefined {
  return stmts.getFileLock.get(roomId, path) as FileLockRow | undefined;
}

export function listFileLocks(roomId: string): FileLockRow[] {
  return stmts.listFileLocks.all(roomId) as FileLockRow[];
}

export function listAllFileLocks(): FileLockRow[] {
  return stmts.listAllFileLocks.all() as FileLockRow[];
}

export function deleteFileLock(roomId: string, path: string): void {
  stmts.deleteFileLock.run(roomId, path);
}

export function deleteFileLocksForAgent(
  roomId: string,
  agentId: string,
): number {
  const info = stmts.deleteFileLocksForAgent.run(roomId, agentId);
  return info.changes;
}

export function deleteFileLocksForRoom(roomId: string): void {
  stmts.deleteFileLocksForRoom.run(roomId);
}

export function deleteExpiredFileLocks(now: number): void {
  stmts.deleteExpiredFileLocks.run(now);
}

export function deleteExpiredFileLocksForRoom(
  roomId: string,
  now: number,
): void {
  stmts.deleteExpiredFileLocksForRoom.run(roomId, now);
}

export function migrateAgentsV1(): void {
  if (getSetting("migration:agents_v1") === "done") return;
  const rooms = listRooms();
  for (const room of rooms) {
    const count = (stmts.countAgents.get(room.id) as { c: number }).c;
    if (count > 0) {
      const agents = listAgents(room.id);
      if (agents[0]) {
        stmts.backfillMessagesAgent.run(agents[0].id, room.id);
      }
      continue;
    }
    const agent = createAgent({
      roomId: room.id,
      backend: "cursor",
      label: "Agent 1",
      sessionId: room.cursor_session_id,
      sdkAgentId: room.cursor_agent_id,
      modelId: room.model_id || "auto",
      createdBy: room.owner_id,
      sortOrder: 0,
    });
    stmts.backfillMessagesAgent.run(agent.id, room.id);
  }
  setSetting("migration:agents_v1", "done");
}

migrateAgentsV1();

