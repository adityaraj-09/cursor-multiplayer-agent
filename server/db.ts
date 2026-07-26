import Database from "better-sqlite3";
import { resolve } from "path";
import type { SteerLogEntry } from "../shared/events.js";

const DB_PATH = resolve(
  import.meta.dirname,
  "../data.db",
);

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
    status TEXT NOT NULL DEFAULT 'active'
  );

  CREATE TABLE IF NOT EXISTS steer_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    sender_name TEXT NOT NULL,
    sender_color TEXT NOT NULL,
    text TEXT NOT NULL,
    ts INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_steer_room_ts ON steer_messages(room_id, ts);
`);

const stmts = {
  insertRoom: db.prepare(`
    INSERT INTO rooms (id, name, repo_path, agent_command, created_at, last_active_at, status)
    VALUES (?, ?, ?, ?, ?, ?, 'active')
  `),
  listRooms: db.prepare(`
    SELECT * FROM rooms ORDER BY last_active_at DESC
  `),
  getRoom: db.prepare(`SELECT * FROM rooms WHERE id = ?`),
  updateActivity: db.prepare(`
    UPDATE rooms SET last_active_at = ? WHERE id = ?
  `),
  updateStatus: db.prepare(`
    UPDATE rooms SET status = ? WHERE id = ?
  `),
  insertSteer: db.prepare(`
    INSERT INTO steer_messages (room_id, sender_name, sender_color, text, ts)
    VALUES (?, ?, ?, ?, ?)
  `),
  getSteerHistory: db.prepare(`
    SELECT sender_name, sender_color, text, ts
    FROM steer_messages WHERE room_id = ?
    ORDER BY ts DESC LIMIT ?
  `),
  deleteRoom: db.prepare(`DELETE FROM rooms WHERE id = ?`),
};

export interface RoomRow {
  id: string;
  name: string;
  repo_path: string;
  agent_command: string;
  created_at: number;
  last_active_at: number;
  status: string;
}

export function createRoom(
  id: string,
  name: string,
  repoPath: string,
  agentCommand: string,
): RoomRow {
  const now = Date.now();
  stmts.insertRoom.run(id, name, repoPath, agentCommand, now, now);
  return stmts.getRoom.get(id) as RoomRow;
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

export function insertSteerMessage(
  roomId: string,
  sender: string,
  color: string,
  text: string,
  ts: number,
): void {
  stmts.insertSteer.run(roomId, sender, color, text, ts);
}

export function getSteerHistory(
  roomId: string,
  limit = 50,
): SteerLogEntry[] {
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

export function deleteRoom(id: string): void {
  stmts.deleteRoom.run(id);
}

