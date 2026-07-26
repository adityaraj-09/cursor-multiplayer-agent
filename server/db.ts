import Database from "better-sqlite3";
import { resolve } from "path";
import type {
  AgentRuntime,
  AuthMode,
  ChatMessage,
  SteerLogEntry,
} from "../shared/events.js";

const DB_PATH = resolve(import.meta.dirname, "../data.db");

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
    key_hint TEXT
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

  CREATE INDEX IF NOT EXISTS idx_steer_room_ts ON steer_messages(room_id, ts);
  CREATE INDEX IF NOT EXISTS idx_messages_room_ts ON messages(room_id, ts);
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
];

for (const sql of migrations) {
  try {
    db.exec(sql);
  } catch {
    // column already exists
  }
}

const stmts = {
  insertRoom: db.prepare(`
    INSERT INTO rooms (
      id, name, repo_path, agent_command, created_at, last_active_at, status,
      runtime, auth_mode, model_id, repo_url, starting_ref, cursor_agent_id,
      pr_url, auto_create_pr, key_ciphertext, key_hint
    ) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),
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
    INSERT INTO messages (id, room_id, role, content, sender_name, sender_color, tool_name, diff_patch, status, ts)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),
  updateMessageContent: db.prepare(
    `UPDATE messages SET content = ?, status = ? WHERE id = ?`,
  ),
  updateMessageDiff: db.prepare(
    `UPDATE messages SET content = ?, status = ?, diff_patch = ? WHERE id = ?`,
  ),
  getMessages: db.prepare(`
    SELECT * FROM messages WHERE room_id = ?
    ORDER BY ts ASC, rowid ASC LIMIT ?
  `),
  deleteRoom: db.prepare(`DELETE FROM rooms WHERE id = ?`),
  getSetting: db.prepare(`SELECT value FROM settings WHERE key = ?`),
  setSetting: db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `),
  deleteSetting: db.prepare(`DELETE FROM settings WHERE key = ?`),
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
  };
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
    input.prUrl ?? null,
    input.autoCreatePR ? 1 : 0,
    input.keyCiphertext ?? null,
    input.keyHint ?? null,
  );
  return stmts.getRoom.get(input.id) as RoomRow;
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
  }>;
  return rows.map(rowToMessage);
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
