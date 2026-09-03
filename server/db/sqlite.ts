import Database from "better-sqlite3";
import { mkdirSync } from "fs";
import { dirname, resolve } from "path";
import { randomBytes } from "crypto";
import { repoMapNodePk } from "./repoMapIds.js";
import type {
  AgentBackendKind,
  AgentRuntime,
  AgentStatus,
  AuthMode,
  ChatMessage,
  SteerLogEntry,
} from "../../shared/events.js";
import type { ApprovalStatus } from "../../shared/approvals.js";
import type {
  MemoryKind,
  MemoryStatus,
  RepoMapGraph,
  RepoMapStatus,
} from "../../shared/roomContext.js";

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
    owner_id TEXT,
    org_id TEXT,
    control_mode TEXT NOT NULL DEFAULT 'open',
    approval_mode TEXT NOT NULL DEFAULT 'off',
    slack_webhook_ciphertext TEXT,
    slack_webhook_hint TEXT,
    memory_version INTEGER NOT NULL DEFAULT 0,
    auto_memory TEXT NOT NULL DEFAULT 'extract'
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
    todos_json TEXT,
    questions_json TEXT,
    reverted INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'done',
    ts INTEGER NOT NULL,
    sender_user_id TEXT
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
    role TEXT NOT NULL DEFAULT 'editor',
    PRIMARY KEY (room_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS invite_links (
    code TEXT PRIMARY KEY,
    room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    created_by TEXT NOT NULL REFERENCES users(id),
    created_at INTEGER NOT NULL,
    max_uses INTEGER,
    use_count INTEGER NOT NULL DEFAULT 0,
    expires_at INTEGER,
    role TEXT NOT NULL DEFAULT 'viewer'
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
    sort_order INTEGER NOT NULL DEFAULT 0,
    plan_mode INTEGER NOT NULL DEFAULT 0,
    auto_mem_cursor_ts INTEGER NOT NULL DEFAULT 0
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

  CREATE TABLE IF NOT EXISTS organizations (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    allowed_domains TEXT NOT NULL DEFAULT '',
    created_by TEXT NOT NULL REFERENCES users(id),
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS organization_members (
    org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'member',
    created_at INTEGER NOT NULL,
    PRIMARY KEY (org_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS organization_invites (
    code TEXT PRIMARY KEY,
    org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    created_by TEXT NOT NULL REFERENCES users(id),
    role TEXT NOT NULL DEFAULT 'member',
    created_at INTEGER NOT NULL,
    max_uses INTEGER,
    use_count INTEGER NOT NULL DEFAULT 0,
    expires_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS approval_requests (
    id TEXT PRIMARY KEY,
    room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    agent_id TEXT NOT NULL,
    call_id TEXT NOT NULL,
    tool_name TEXT NOT NULL,
    detail TEXT NOT NULL DEFAULT '',
    path TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at INTEGER NOT NULL,
    decided_at INTEGER,
    decided_by_user_id TEXT,
    decided_by_name TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_steer_room_ts ON steer_messages(room_id, ts);
  CREATE INDEX IF NOT EXISTS idx_messages_room_ts ON messages(room_id, ts);
  CREATE INDEX IF NOT EXISTS idx_agents_room ON agents(room_id, sort_order);
  CREATE INDEX IF NOT EXISTS idx_org_members_user ON organization_members(user_id);
  CREATE INDEX IF NOT EXISTS idx_approval_requests_room_status ON approval_requests(room_id, status);

  CREATE TABLE IF NOT EXISTS room_pings (
    id TEXT PRIMARY KEY,
    room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    actor_user_id TEXT NOT NULL,
    actor_name TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    targets TEXT NOT NULL DEFAULT 'everyone',
    status TEXT NOT NULL DEFAULT 'open',
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS room_ping_acks (
    ping_id TEXT NOT NULL REFERENCES room_pings(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL,
    user_name TEXT NOT NULL,
    acked_at INTEGER NOT NULL,
    PRIMARY KEY (ping_id, user_id)
  );

  CREATE INDEX IF NOT EXISTS idx_room_pings_room_status ON room_pings(room_id, status);
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
  `ALTER TABLE messages ADD COLUMN todos_json TEXT`,
  `ALTER TABLE rooms ADD COLUMN org_id TEXT`,
  `ALTER TABLE rooms ADD COLUMN control_mode TEXT NOT NULL DEFAULT 'open'`,
  `ALTER TABLE invite_links ADD COLUMN role TEXT NOT NULL DEFAULT 'viewer'`,
  `ALTER TABLE rooms ADD COLUMN approval_mode TEXT NOT NULL DEFAULT 'off'`,
  `ALTER TABLE agents ADD COLUMN plan_mode INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE messages ADD COLUMN sender_user_id TEXT`,
  `ALTER TABLE rooms ADD COLUMN slack_webhook_ciphertext TEXT`,
  `ALTER TABLE rooms ADD COLUMN slack_webhook_hint TEXT`,
  `ALTER TABLE messages ADD COLUMN plan_status TEXT`,
  `ALTER TABLE messages ADD COLUMN attachments_json TEXT`,
  `ALTER TABLE rooms ADD COLUMN memory_version INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE rooms ADD COLUMN auto_memory TEXT NOT NULL DEFAULT 'extract'`,
  `ALTER TABLE memory_entries ADD COLUMN source TEXT NOT NULL DEFAULT 'human'`,
  `ALTER TABLE agents ADD COLUMN auto_mem_cursor_ts INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE messages ADD COLUMN questions_json TEXT`,
  `ALTER TABLE messages ADD COLUMN reverted INTEGER NOT NULL DEFAULT 0`,
];

for (const sql of migrations) {
  try {
    db.exec(sql);
  } catch {
    // column already exists
  }
}

// Legacy room_members.role "member" → "editor" (idempotent).
try {
  db.exec(`UPDATE room_members SET role = 'editor' WHERE role = 'member'`);
} catch {
  // ignore
}

// Existing invite links without an explicit collaboration role stay editable
// for backward compatibility with previous open-collaboration behavior.
try {
  db.exec(`
    UPDATE invite_links
    SET role = 'editor'
    WHERE role IS NULL OR TRIM(role) = '' OR role = 'member'
  `);
} catch {
  // ignore
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

try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS organizations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      allowed_domains TEXT NOT NULL DEFAULT '',
      created_by TEXT NOT NULL REFERENCES users(id),
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS organization_members (
      org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL DEFAULT 'member',
      created_at INTEGER NOT NULL,
      PRIMARY KEY (org_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS organization_invites (
      code TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      created_by TEXT NOT NULL REFERENCES users(id),
      role TEXT NOT NULL DEFAULT 'member',
      created_at INTEGER NOT NULL,
      max_uses INTEGER,
      use_count INTEGER NOT NULL DEFAULT 0,
      expires_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_org_members_user ON organization_members(user_id);
    CREATE INDEX IF NOT EXISTS idx_rooms_org ON rooms(org_id);
  `);
} catch {
  // ignore
}

try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS approval_requests (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
      agent_id TEXT NOT NULL,
      call_id TEXT NOT NULL,
      tool_name TEXT NOT NULL,
      detail TEXT NOT NULL DEFAULT '',
      path TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at INTEGER NOT NULL,
      decided_at INTEGER,
      decided_by_user_id TEXT,
      decided_by_name TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_approval_requests_room_status ON approval_requests(room_id, status);
  `);
} catch {
  // ignore
}

try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS room_pings (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
      actor_user_id TEXT NOT NULL,
      actor_name TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      targets TEXT NOT NULL DEFAULT 'everyone',
      status TEXT NOT NULL DEFAULT 'open',
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS room_ping_acks (
      ping_id TEXT NOT NULL REFERENCES room_pings(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL,
      user_name TEXT NOT NULL,
      acked_at INTEGER NOT NULL,
      PRIMARY KEY (ping_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_room_pings_room_status ON room_pings(room_id, status);
  `);
} catch {
  // ignore
}

try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS repo_maps (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL UNIQUE REFERENCES rooms(id) ON DELETE CASCADE,
      repo_key TEXT NOT NULL,
      git_sha TEXT,
      status TEXT NOT NULL DEFAULT 'ready',
      error TEXT,
      file_count INTEGER NOT NULL DEFAULT 0,
      symbol_count INTEGER NOT NULL DEFAULT 0,
      edge_count INTEGER NOT NULL DEFAULT 0,
      graph_json TEXT NOT NULL DEFAULT '{"nodes":[],"edges":[]}',
      generated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS repo_map_nodes (
      id TEXT PRIMARY KEY,
      map_id TEXT NOT NULL REFERENCES repo_maps(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      path TEXT NOT NULL,
      name TEXT,
      symbol_type TEXT,
      line_start INTEGER,
      line_end INTEGER,
      keywords TEXT NOT NULL DEFAULT '',
      exported INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS repo_map_edges (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      map_id TEXT NOT NULL REFERENCES repo_maps(id) ON DELETE CASCADE,
      src TEXT NOT NULL,
      dst TEXT NOT NULL,
      rel TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS memory_entries (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      pinned INTEGER NOT NULL DEFAULT 0,
      created_by_user_id TEXT,
      created_by_agent_id TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      current_revision INTEGER NOT NULL DEFAULT 1,
      supersedes_id TEXT,
      source TEXT NOT NULL DEFAULT 'human'
    );
    CREATE TABLE IF NOT EXISTS memory_revisions (
      entry_id TEXT NOT NULL REFERENCES memory_entries(id) ON DELETE CASCADE,
      revision INTEGER NOT NULL,
      content TEXT NOT NULL,
      source_message_id TEXT,
      source_path TEXT,
      created_by_user_id TEXT,
      created_by_agent_id TEXT,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (entry_id, revision)
    );
    CREATE TABLE IF NOT EXISTS agent_context_receipts (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      run_id TEXT NOT NULL,
      map_id TEXT,
      git_sha TEXT,
      memory_version INTEGER NOT NULL DEFAULT 0,
      entry_ids_json TEXT NOT NULL DEFAULT '[]',
      file_ids_json TEXT NOT NULL DEFAULT '[]',
      is_baseline INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_memory_entries_room ON memory_entries(room_id, status, updated_at);
    CREATE INDEX IF NOT EXISTS idx_context_receipts_agent ON agent_context_receipts(agent_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_repo_map_nodes_map ON repo_map_nodes(map_id);
  `);
} catch {
  // ignore
}

const stmts = {
  insertRoom: db.prepare(`
    INSERT INTO rooms (
      id, name, repo_path, agent_command, created_at, last_active_at, status,
      runtime, auth_mode, model_id, repo_url, starting_ref, cursor_agent_id,
      cursor_session_id, pr_url, auto_create_pr, key_ciphertext, key_hint, owner_id, org_id,
      control_mode, approval_mode
    ) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),
  updateRoomOwner: db.prepare(`UPDATE rooms SET owner_id = ? WHERE id = ?`),
  updateControlMode: db.prepare(
    `UPDATE rooms SET control_mode = ? WHERE id = ?`,
  ),
  updateApprovalMode: db.prepare(
    `UPDATE rooms SET approval_mode = ? WHERE id = ?`,
  ),
  updateAutoMemory: db.prepare(
    `UPDATE rooms SET auto_memory = ? WHERE id = ?`,
  ),
  updateAgentAutoMemCursor: db.prepare(
    `UPDATE agents SET auto_mem_cursor_ts = ? WHERE id = ?`,
  ),
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
  updateRoomByokKey: db.prepare(
    `UPDATE rooms SET key_ciphertext = ?, key_hint = ? WHERE id = ?`,
  ),
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
    INSERT INTO messages (id, room_id, role, content, sender_name, sender_color, tool_name, diff_patch, todos_json, status, ts, agent_id, sender_user_id, plan_status, attachments_json, questions_json, reverted)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),
  updateMessagePlanStatus: db.prepare(
    `UPDATE messages SET plan_status = ? WHERE id = ?`,
  ),
  updateMessageContent: db.prepare(
    `UPDATE messages SET content = ?, status = ? WHERE id = ?`,
  ),
  updateMessageDiff: db.prepare(
    `UPDATE messages SET content = ?, status = ?, diff_patch = ? WHERE id = ?`,
  ),
  updateMessageTool: db.prepare(
    `UPDATE messages SET content = ?, status = ?,
        diff_patch = COALESCE(?, diff_patch),
        todos_json = COALESCE(?, todos_json),
        questions_json = COALESCE(?, questions_json)
     WHERE id = ?`,
  ),
  updateMessageReverted: db.prepare(
    `UPDATE messages SET reverted = ? WHERE id = ?`,
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
      model_id, status, branch, pr_url, created_by, created_at, sort_order, plan_mode
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
  updateAgentPlanMode: db.prepare(
    `UPDATE agents SET plan_mode = ? WHERE id = ?`,
  ),
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
    INSERT INTO invite_links (code, room_id, created_by, created_at, max_uses, use_count, expires_at, role)
    VALUES (?, ?, ?, ?, ?, 0, ?, ?)
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
    LEFT JOIN organization_members om ON om.org_id = r.org_id
    WHERE r.owner_id = ? OR rm.user_id = ? OR om.user_id = ?
    ORDER BY r.last_active_at DESC
  `),
  listPersonalRoomsByUser: db.prepare(`
    SELECT DISTINCT r.* FROM rooms r
    LEFT JOIN room_members rm ON rm.room_id = r.id
    WHERE (r.org_id IS NULL OR r.org_id = '')
      AND (r.owner_id = ? OR rm.user_id = ?)
    ORDER BY r.last_active_at DESC
  `),
  listRoomsByOrg: db.prepare(`
    SELECT * FROM rooms WHERE org_id = ? ORDER BY last_active_at DESC
  `),
  clearRoomsOrg: db.prepare(`
    UPDATE rooms SET org_id = NULL WHERE org_id = ?
  `),
  stopRoomsByOrg: db.prepare(`
    UPDATE rooms SET status = 'stopped' WHERE org_id = ? AND status = 'active'
  `),
  insertOrg: db.prepare(`
    INSERT INTO organizations (id, name, slug, allowed_domains, created_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `),
  getOrg: db.prepare(`SELECT * FROM organizations WHERE id = ?`),
  getOrgBySlug: db.prepare(`SELECT * FROM organizations WHERE slug = ?`),
  updateOrg: db.prepare(`
    UPDATE organizations SET name = ?, slug = ?, allowed_domains = ? WHERE id = ?
  `),
  deleteOrg: db.prepare(`DELETE FROM organizations WHERE id = ?`),
  listOrgsForUser: db.prepare(`
    SELECT o.*, om.role AS member_role
    FROM organizations o
    INNER JOIN organization_members om ON om.org_id = o.id
    WHERE om.user_id = ?
    ORDER BY o.name COLLATE NOCASE ASC
  `),
  listOrgsByDomain: db.prepare(`
    SELECT * FROM organizations
    WHERE allowed_domains != ''
    ORDER BY name COLLATE NOCASE ASC
  `),
  addOrgMember: db.prepare(`
    INSERT OR REPLACE INTO organization_members (org_id, user_id, role, created_at)
    VALUES (?, ?, ?, ?)
  `),
  getOrgMember: db.prepare(`
    SELECT * FROM organization_members WHERE org_id = ? AND user_id = ?
  `),
  listOrgMembers: db.prepare(`
    SELECT om.org_id, om.user_id, om.role, om.created_at, u.email, u.name
    FROM organization_members om
    INNER JOIN users u ON u.id = om.user_id
    WHERE om.org_id = ?
    ORDER BY
      CASE om.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END,
      u.name COLLATE NOCASE ASC
  `),
  countOrgMembers: db.prepare(`
    SELECT COUNT(*) AS c FROM organization_members WHERE org_id = ?
  `),
  updateOrgMemberRole: db.prepare(`
    UPDATE organization_members SET role = ? WHERE org_id = ? AND user_id = ?
  `),
  removeOrgMember: db.prepare(`
    DELETE FROM organization_members WHERE org_id = ? AND user_id = ?
  `),
  insertOrgInvite: db.prepare(`
    INSERT INTO organization_invites
      (code, org_id, created_by, role, created_at, max_uses, use_count, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, 0, ?)
  `),
  getOrgInvite: db.prepare(`SELECT * FROM organization_invites WHERE code = ?`),
  listOrgInvites: db.prepare(`
    SELECT * FROM organization_invites WHERE org_id = ? ORDER BY created_at DESC
  `),
  deleteOrgInvite: db.prepare(`DELETE FROM organization_invites WHERE code = ?`),
  bumpOrgInviteUse: db.prepare(`
    UPDATE organization_invites SET use_count = use_count + 1
    WHERE code = ?
      AND (max_uses IS NULL OR use_count < max_uses)
      AND (expires_at IS NULL OR expires_at > ?)
  `),

  insertApprovalRequest: db.prepare(`
    INSERT INTO approval_requests (
      id, room_id, agent_id, call_id, tool_name, detail, path, status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)
  `),
  getApprovalRequest: db.prepare(`SELECT * FROM approval_requests WHERE id = ?`),
  listPendingApprovals: db.prepare(`
    SELECT * FROM approval_requests WHERE room_id = ? AND status = 'pending'
    ORDER BY created_at ASC
  `),
  resolveApprovalRequest: db.prepare(`
    UPDATE approval_requests
    SET status = ?, decided_at = ?, decided_by_user_id = ?, decided_by_name = ?
    WHERE id = ?
  `),
  expireApprovalRequest: db.prepare(`
    UPDATE approval_requests SET status = 'expired', decided_at = ? WHERE id = ?
  `),

  updateSlackWebhook: db.prepare(`
    UPDATE rooms SET slack_webhook_ciphertext = ?, slack_webhook_hint = ? WHERE id = ?
  `),
  clearSlackWebhook: db.prepare(`
    UPDATE rooms SET slack_webhook_ciphertext = NULL, slack_webhook_hint = NULL WHERE id = ?
  `),

  insertRoomPing: db.prepare(`
    INSERT INTO room_pings (
      id, room_id, actor_user_id, actor_name, note, targets, status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'open', ?)
  `),
  getRoomPing: db.prepare(`SELECT * FROM room_pings WHERE id = ?`),
  listOpenRoomPings: db.prepare(`
    SELECT * FROM room_pings WHERE room_id = ? AND status = 'open'
    ORDER BY created_at DESC
  `),
  dismissRoomPing: db.prepare(`
    UPDATE room_pings SET status = 'dismissed' WHERE id = ? AND status = 'open'
  `),
  insertRoomPingAck: db.prepare(`
    INSERT OR IGNORE INTO room_ping_acks (ping_id, user_id, user_name, acked_at)
    VALUES (?, ?, ?, ?)
  `),
  getMemoryVersion: db.prepare(`SELECT memory_version FROM rooms WHERE id = ?`),
  bumpMemoryVersion: db.prepare(
    `UPDATE rooms SET memory_version = memory_version + 1 WHERE id = ?`,
  ),
  upsertRepoMap: db.prepare(`
    INSERT INTO repo_maps (
      id, room_id, repo_key, git_sha, status, error, file_count, symbol_count,
      edge_count, graph_json, generated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(room_id) DO UPDATE SET
      repo_key = excluded.repo_key,
      git_sha = excluded.git_sha,
      status = excluded.status,
      error = excluded.error,
      file_count = excluded.file_count,
      symbol_count = excluded.symbol_count,
      edge_count = excluded.edge_count,
      graph_json = excluded.graph_json,
      generated_at = excluded.generated_at,
      id = excluded.id
  `),
  getRepoMap: db.prepare(`SELECT * FROM repo_maps WHERE room_id = ?`),
  deleteRepoMapNodes: db.prepare(`DELETE FROM repo_map_nodes WHERE map_id = ?`),
  deleteRepoMapEdges: db.prepare(`DELETE FROM repo_map_edges WHERE map_id = ?`),
  insertRepoMapNode: db.prepare(`
    INSERT INTO repo_map_nodes (
      id, map_id, kind, path, name, symbol_type, line_start, line_end, keywords, exported
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),
  insertRepoMapEdge: db.prepare(`
    INSERT INTO repo_map_edges (map_id, src, dst, rel) VALUES (?, ?, ?, ?)
  `),
  insertMemoryEntry: db.prepare(`
    INSERT INTO memory_entries (
      id, room_id, kind, title, status, pinned, created_by_user_id, created_by_agent_id,
      created_at, updated_at, current_revision, supersedes_id, source
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),
  insertMemoryRevision: db.prepare(`
    INSERT INTO memory_revisions (
      entry_id, revision, content, source_message_id, source_path,
      created_by_user_id, created_by_agent_id, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `),
  getMemoryEntry: db.prepare(`
    SELECT e.*, r.content, r.source_message_id, r.source_path
    FROM memory_entries e
    JOIN memory_revisions r ON r.entry_id = e.id AND r.revision = e.current_revision
    WHERE e.id = ?
  `),
  listMemoryEntries: db.prepare(`
    SELECT e.*, r.content, r.source_message_id, r.source_path
    FROM memory_entries e
    JOIN memory_revisions r ON r.entry_id = e.id AND r.revision = e.current_revision
    WHERE e.room_id = ?
    ORDER BY e.pinned DESC, e.updated_at DESC
  `),
  updateMemoryEntry: db.prepare(`
    UPDATE memory_entries
    SET title = ?, status = ?, pinned = ?, updated_at = ?, current_revision = ?,
        supersedes_id = COALESCE(?, supersedes_id)
    WHERE id = ? AND current_revision = ?
  `),
  insertContextReceipt: db.prepare(`
    INSERT INTO agent_context_receipts (
      id, room_id, agent_id, run_id, map_id, git_sha, memory_version,
      entry_ids_json, file_ids_json, is_baseline, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),
  listContextReceiptsForAgent: db.prepare(`
    SELECT * FROM agent_context_receipts WHERE agent_id = ? ORDER BY created_at DESC LIMIT ?
  `),
  latestContextReceiptsForRoom: db.prepare(`
    SELECT * FROM agent_context_receipts
    WHERE room_id = ?
    ORDER BY created_at DESC
  `),
  listRoomPingAcks: db.prepare(`
    SELECT * FROM room_ping_acks WHERE ping_id = ? ORDER BY acked_at ASC
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
  org_id: string | null;
  control_mode: string;
  approval_mode: string;
  slack_webhook_ciphertext: string | null;
  slack_webhook_hint: string | null;
  memory_version?: number;
  auto_memory?: string;
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
  orgId?: string | null;
  controlMode?: string | null;
  approvalMode?: string;
}

export type OrgRoleRow = "owner" | "admin" | "member";

export interface OrganizationRow {
  id: string;
  name: string;
  slug: string;
  allowed_domains: string;
  created_by: string;
  created_at: number;
}

export interface OrganizationMemberRow {
  org_id: string;
  user_id: string;
  role: OrgRoleRow;
  created_at: number;
}

export interface OrganizationInviteRow {
  code: string;
  org_id: string;
  created_by: string;
  role: OrgRoleRow;
  created_at: number;
  max_uses: number | null;
  use_count: number;
  expires_at: number | null;
}

function parseAttachmentsJson(
  raw: string | null | undefined,
): ChatMessage["attachments"] {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return undefined;
    return parsed as NonNullable<ChatMessage["attachments"]>;
  } catch {
    return undefined;
  }
}

function parseTodosJson(
  raw: string | null | undefined,
): ChatMessage["todos"] {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return undefined;
    return parsed as NonNullable<ChatMessage["todos"]>;
  } catch {
    return undefined;
  }
}

function parseQuestionsJson(
  raw: string | null | undefined,
): ChatMessage["questions"] {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return undefined;
    return parsed as NonNullable<ChatMessage["questions"]>;
  } catch {
    return undefined;
  }
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
  todos_json?: string | null;
  status: string;
  ts: number;
  agent_id?: string | null;
  sender_user_id?: string | null;
  plan_status?: string | null;
  attachments_json?: string | null;
  questions_json?: string | null;
  reverted?: number | null;
}): ChatMessage {
  const planStatus =
    r.plan_status === "pending" ||
    r.plan_status === "approved" ||
    r.plan_status === "dismissed"
      ? r.plan_status
      : undefined;
  return {
    id: r.id,
    roomId: r.room_id,
    role: r.role as ChatMessage["role"],
    content: r.content,
    senderName: r.sender_name ?? undefined,
    senderColor: r.sender_color ?? undefined,
    toolName: r.tool_name ?? undefined,
    diffPatch: r.diff_patch || undefined,
    todos: parseTodosJson(r.todos_json),
    status: r.status as ChatMessage["status"],
    ts: r.ts,
    agentId: r.agent_id || undefined,
    senderUserId: r.sender_user_id || undefined,
    planStatus,
    attachments: parseAttachmentsJson(r.attachments_json),
    questions: parseQuestionsJson(r.questions_json),
    reverted: Boolean(r.reverted),
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
  plan_mode: number;
  auto_mem_cursor_ts?: number;
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
  planMode?: boolean;
}

export function createRoom(input: CreateRoomInput): RoomRow {
  const now = Date.now();
  const controlMode =
    input.controlMode?.trim() ||
    (input.runtime === "local" ? "driver" : "open");
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
    input.orgId ?? null,
    controlMode,
    input.approvalMode?.trim() || "off",
  );
  return stmts.getRoom.get(input.id) as RoomRow;
}

export function setRoomOwner(roomId: string, ownerId: string): void {
  stmts.updateRoomOwner.run(ownerId, roomId);
}

export function setRoomControlMode(roomId: string, controlMode: string): void {
  stmts.updateControlMode.run(controlMode, roomId);
}

export function setRoomApprovalMode(roomId: string, approvalMode: string): void {
  stmts.updateApprovalMode.run(approvalMode, roomId);
}

export function setRoomAutoMemory(roomId: string, mode: string): void {
  stmts.updateAutoMemory.run(mode, roomId);
}

export function setAgentAutoMemCursor(agentId: string, ts: number): void {
  stmts.updateAgentAutoMemCursor.run(ts, agentId);
}

export function listRooms(): RoomRow[] {
  return stmts.listRooms.all() as RoomRow[];
}

export function getRoom(id: string): RoomRow | undefined {
  const row = stmts.getRoom.get(id) as RoomRow | undefined;
  if (!row) return undefined;
  if (!row.control_mode) row.control_mode = "open";
  if (!row.approval_mode) row.approval_mode = "off";
  if (!row.auto_memory) row.auto_memory = "extract";
  if (row.slack_webhook_ciphertext === undefined) {
    row.slack_webhook_ciphertext = null;
  }
  if (row.slack_webhook_hint === undefined) {
    row.slack_webhook_hint = null;
  }
  return row;
}

export function getRoomMemberRole(
  roomId: string,
  userId: string,
): string | null {
  const members = getRoomMembers(roomId);
  const hit = members.find((m) => m.user_id === userId);
  return hit?.role ?? null;
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

/** Attach / replace an encrypted Cursor BYOK key on an existing room. */
export function setRoomByokKey(
  roomId: string,
  keyCiphertext: string,
  keyHint: string,
): void {
  stmts.updateRoomByokKey.run(keyCiphertext, keyHint, roomId);
}

/** Attach / replace an encrypted Slack incoming webhook on a room. */
export function setRoomSlackWebhook(
  roomId: string,
  ciphertext: string,
  hint: string,
): void {
  stmts.updateSlackWebhook.run(ciphertext, hint, roomId);
}

export function clearRoomSlackWebhook(roomId: string): void {
  stmts.clearSlackWebhook.run(roomId);
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
    msg.todos?.length ? JSON.stringify(msg.todos) : null,
    msg.status,
    msg.ts,
    msg.agentId ?? null,
    msg.senderUserId ?? null,
    msg.planStatus ?? null,
    msg.attachments?.length ? JSON.stringify(msg.attachments) : null,
    msg.questions?.length ? JSON.stringify(msg.questions) : null,
    msg.reverted ? 1 : 0,
  );
}

export function updateMessagePlanStatus(
  id: string,
  planStatus: NonNullable<ChatMessage["planStatus"]> | null,
): ChatMessage | undefined {
  stmts.updateMessagePlanStatus.run(planStatus, id);
  const hit = db
    .prepare(`SELECT * FROM messages WHERE id = ?`)
    .get(id) as Parameters<typeof rowToMessage>[0] | undefined;
  return hit ? rowToMessage(hit) : undefined;
}

export function getMessage(id: string): ChatMessage | undefined {
  const hit = db
    .prepare(`SELECT * FROM messages WHERE id = ?`)
    .get(id) as Parameters<typeof rowToMessage>[0] | undefined;
  return hit ? rowToMessage(hit) : undefined;
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

export function updateMessageTool(
  id: string,
  content: string,
  status: ChatMessage["status"],
  opts: {
    diffPatch?: string;
    todos?: ChatMessage["todos"];
    questions?: ChatMessage["questions"];
  } = {},
): void {
  const todosJson =
    opts.todos && opts.todos.length > 0 ? JSON.stringify(opts.todos) : null;
  const questionsJson =
    opts.questions && opts.questions.length > 0
      ? JSON.stringify(opts.questions)
      : null;
  // null keeps the previous column value (COALESCE in SQL).
  stmts.updateMessageTool.run(
    content,
    status,
    opts.diffPatch?.trim() ? opts.diffPatch : null,
    todosJson,
    questionsJson,
    id,
  );
}

export function updateMessageReverted(id: string, reverted = true): void {
  stmts.updateMessageReverted.run(reverted ? 1 : 0, id);
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
    sender_user_id: string | null;
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
  role: string = "viewer",
): void {
  stmts.insertInviteLink.run(
    code,
    roomId,
    createdBy,
    Date.now(),
    maxUses,
    expiresAt,
    role,
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
  role: string;
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
  return stmts.listRoomsByUser.all(userId, userId, userId) as RoomRow[];
}

export function listPersonalRoomsByUser(userId: string): RoomRow[] {
  return stmts.listPersonalRoomsByUser.all(userId, userId) as RoomRow[];
}

export function listRoomsByOrg(orgId: string): RoomRow[] {
  return stmts.listRoomsByOrg.all(orgId) as RoomRow[];
}

/** Stop active org rooms and detach them before deleting the organization. */
export function detachOrganizationRooms(orgId: string): number {
  stmts.stopRoomsByOrg.run(orgId);
  const result = stmts.clearRoomsOrg.run(orgId);
  return result.changes;
}

export function createOrganization(input: {
  id: string;
  name: string;
  slug: string;
  allowedDomains?: string;
  createdBy: string;
}): OrganizationRow {
  const now = Date.now();
  stmts.insertOrg.run(
    input.id,
    input.name,
    input.slug,
    input.allowedDomains ?? "",
    input.createdBy,
    now,
  );
  return stmts.getOrg.get(input.id) as OrganizationRow;
}

export function getOrganization(id: string): OrganizationRow | undefined {
  return stmts.getOrg.get(id) as OrganizationRow | undefined;
}

export function getOrganizationBySlug(
  slug: string,
): OrganizationRow | undefined {
  return stmts.getOrgBySlug.get(slug) as OrganizationRow | undefined;
}

export function updateOrganization(
  id: string,
  input: { name: string; slug: string; allowedDomains: string },
): void {
  stmts.updateOrg.run(input.name, input.slug, input.allowedDomains, id);
}

export function deleteOrganization(id: string): void {
  stmts.deleteOrg.run(id);
}

export function listOrganizationsForUser(
  userId: string,
): Array<OrganizationRow & { member_role: OrgRoleRow }> {
  return stmts.listOrgsForUser.all(userId) as Array<
    OrganizationRow & { member_role: OrgRoleRow }
  >;
}

export function listOrganizationsWithDomains(): OrganizationRow[] {
  return stmts.listOrgsByDomain.all() as OrganizationRow[];
}

export function addOrganizationMember(
  orgId: string,
  userId: string,
  role: OrgRoleRow,
): void {
  stmts.addOrgMember.run(orgId, userId, role, Date.now());
}

export function getOrganizationMember(
  orgId: string,
  userId: string,
): OrganizationMemberRow | undefined {
  return stmts.getOrgMember.get(orgId, userId) as
    | OrganizationMemberRow
    | undefined;
}

export function listOrganizationMembers(orgId: string): Array<{
  org_id: string;
  user_id: string;
  role: OrgRoleRow;
  created_at: number;
  email: string;
  name: string;
}> {
  return stmts.listOrgMembers.all(orgId) as Array<{
    org_id: string;
    user_id: string;
    role: OrgRoleRow;
    created_at: number;
    email: string;
    name: string;
  }>;
}

export function countOrganizationMembers(orgId: string): number {
  const row = stmts.countOrgMembers.get(orgId) as { c: number };
  return row?.c ?? 0;
}

export function updateOrganizationMemberRole(
  orgId: string,
  userId: string,
  role: OrgRoleRow,
): void {
  stmts.updateOrgMemberRole.run(role, orgId, userId);
}

export function removeOrganizationMember(
  orgId: string,
  userId: string,
): void {
  stmts.removeOrgMember.run(orgId, userId);
}

export function createOrganizationInvite(input: {
  code: string;
  orgId: string;
  createdBy: string;
  role?: OrgRoleRow;
  maxUses?: number | null;
  expiresAt?: number | null;
}): OrganizationInviteRow {
  stmts.insertOrgInvite.run(
    input.code,
    input.orgId,
    input.createdBy,
    input.role ?? "member",
    Date.now(),
    input.maxUses ?? null,
    input.expiresAt ?? null,
  );
  return stmts.getOrgInvite.get(input.code) as OrganizationInviteRow;
}

export function getOrganizationInvite(
  code: string,
): OrganizationInviteRow | undefined {
  return stmts.getOrgInvite.get(code) as OrganizationInviteRow | undefined;
}

export function listOrganizationInvites(
  orgId: string,
): OrganizationInviteRow[] {
  return stmts.listOrgInvites.all(orgId) as OrganizationInviteRow[];
}

export function deleteOrganizationInvite(code: string): void {
  stmts.deleteOrgInvite.run(code);
}

export function useOrganizationInvite(code: string): boolean {
  const result = stmts.bumpOrgInviteUse.run(code, Date.now());
  return result.changes > 0;
}

export function isOrganizationMember(orgId: string, userId: string): boolean {
  return Boolean(getOrganizationMember(orgId, userId));
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
    plan_mode: (r.plan_mode as number) ?? 0,
    auto_mem_cursor_ts: Number(r.auto_mem_cursor_ts ?? 0),
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
    input.planMode ? 1 : 0,
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

export function setAgentPlanMode(id: string, planMode: boolean): void {
  stmts.updateAgentPlanMode.run(planMode ? 1 : 0, id);
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

// --- Approval requests ---

export interface ApprovalRequestRow {
  id: string;
  room_id: string;
  agent_id: string;
  call_id: string;
  tool_name: string;
  detail: string;
  path: string | null;
  status: ApprovalStatus;
  created_at: number;
  decided_at: number | null;
  decided_by_user_id: string | null;
  decided_by_name: string | null;
}

export interface CreateApprovalRequestInput {
  id?: string;
  roomId: string;
  agentId: string;
  callId: string;
  toolName: string;
  detail?: string;
  path?: string | null;
}

export function createApprovalRequest(
  input: CreateApprovalRequestInput,
): ApprovalRequestRow {
  const id = input.id || newId("apr_");
  stmts.insertApprovalRequest.run(
    id,
    input.roomId,
    input.agentId,
    input.callId,
    input.toolName,
    input.detail ?? "",
    input.path ?? null,
    Date.now(),
  );
  return stmts.getApprovalRequest.get(id) as ApprovalRequestRow;
}

export function getApprovalRequest(id: string): ApprovalRequestRow | undefined {
  return stmts.getApprovalRequest.get(id) as ApprovalRequestRow | undefined;
}

export function listPendingApprovals(roomId: string): ApprovalRequestRow[] {
  return stmts.listPendingApprovals.all(roomId) as ApprovalRequestRow[];
}

export function resolveApprovalRequest(
  id: string,
  status: "approved" | "denied",
  decidedByUserId: string,
  decidedByName: string,
): ApprovalRequestRow | undefined {
  stmts.resolveApprovalRequest.run(
    status,
    Date.now(),
    decidedByUserId,
    decidedByName,
    id,
  );
  return getApprovalRequest(id);
}

export function expireApprovalRequest(id: string): void {
  stmts.expireApprovalRequest.run(Date.now(), id);
}

// --- Room review pings ---

export type RoomPingStatus = "open" | "dismissed";

export interface RoomPingRow {
  id: string;
  room_id: string;
  actor_user_id: string;
  actor_name: string;
  note: string;
  /** `'everyone'` or JSON array of user ids. */
  targets: string;
  status: RoomPingStatus;
  created_at: number;
}

export interface RoomPingAckRow {
  ping_id: string;
  user_id: string;
  user_name: string;
  acked_at: number;
}

export interface CreateRoomPingInput {
  id?: string;
  roomId: string;
  actorUserId: string;
  actorName: string;
  note?: string;
  /** `'everyone'` or list of user ids. */
  targets?: "everyone" | string[];
}

export function createRoomPing(input: CreateRoomPingInput): RoomPingRow {
  const id = input.id || newId("ping_");
  const targets =
    !input.targets || input.targets === "everyone"
      ? "everyone"
      : JSON.stringify(input.targets);
  stmts.insertRoomPing.run(
    id,
    input.roomId,
    input.actorUserId,
    input.actorName,
    (input.note || "").slice(0, 2000),
    targets,
    Date.now(),
  );
  return stmts.getRoomPing.get(id) as RoomPingRow;
}

export function getRoomPing(id: string): RoomPingRow | undefined {
  return stmts.getRoomPing.get(id) as RoomPingRow | undefined;
}

export function listOpenRoomPings(roomId: string): RoomPingRow[] {
  return stmts.listOpenRoomPings.all(roomId) as RoomPingRow[];
}

export function dismissRoomPing(id: string): RoomPingRow | undefined {
  stmts.dismissRoomPing.run(id);
  return getRoomPing(id);
}

/** Returns true when a new ack row was inserted. */
export function ackRoomPing(
  pingId: string,
  userId: string,
  userName: string,
): boolean {
  const result = stmts.insertRoomPingAck.run(
    pingId,
    userId,
    userName.slice(0, 80) || "Someone",
    Date.now(),
  );
  return result.changes > 0;
}

export function listRoomPingAcks(pingId: string): RoomPingAckRow[] {
  return stmts.listRoomPingAcks.all(pingId) as RoomPingAckRow[];
}

export interface RepoMapRow {
  id: string;
  room_id: string;
  repo_key: string;
  git_sha: string | null;
  status: RepoMapStatus;
  error: string | null;
  file_count: number;
  symbol_count: number;
  edge_count: number;
  graph_json: string;
  generated_at: number;
}

export interface MemoryEntryRow {
  id: string;
  room_id: string;
  kind: MemoryKind;
  title: string;
  status: MemoryStatus;
  pinned: number;
  created_by_user_id: string | null;
  created_by_agent_id: string | null;
  created_at: number;
  updated_at: number;
  current_revision: number;
  supersedes_id: string | null;
  content: string;
  source_message_id: string | null;
  source_path: string | null;
  source?: string;
}

export interface AgentContextReceiptRow {
  id: string;
  room_id: string;
  agent_id: string;
  run_id: string;
  map_id: string | null;
  git_sha: string | null;
  memory_version: number;
  entry_ids_json: string;
  file_ids_json: string;
  is_baseline: number;
  created_at: number;
}

export function getRoomMemoryVersion(roomId: string): number {
  const row = stmts.getMemoryVersion.get(roomId) as
    | { memory_version: number }
    | undefined;
  return Number(row?.memory_version || 0);
}

export function bumpRoomMemoryVersion(roomId: string): number {
  stmts.bumpMemoryVersion.run(roomId);
  return getRoomMemoryVersion(roomId);
}

export function getRepoMap(roomId: string): RepoMapRow | undefined {
  return stmts.getRepoMap.get(roomId) as RepoMapRow | undefined;
}

export function saveRepoMap(input: {
  id?: string;
  roomId: string;
  repoKey: string;
  gitSha: string | null;
  status: RepoMapStatus;
  error?: string | null;
  fileCount: number;
  symbolCount: number;
  edgeCount: number;
  graph: RepoMapGraph;
}): RepoMapRow {
  const existing = getRepoMap(input.roomId);
  const id = input.id || existing?.id || newId("map_");
  const now = Date.now();
  const graphJson = JSON.stringify(input.graph);
  const write = db.transaction(() => {
    if (existing) {
      stmts.deleteRepoMapNodes.run(existing.id);
      stmts.deleteRepoMapEdges.run(existing.id);
    }
    stmts.upsertRepoMap.run(
      id,
      input.roomId,
      input.repoKey,
      input.gitSha,
      input.status,
      input.error ?? null,
      input.fileCount,
      input.symbolCount,
      input.edgeCount,
      graphJson,
      now,
    );
    const seen = new Set<string>();
    for (const n of input.graph.nodes.slice(0, 8000)) {
      if (!n.id || seen.has(n.id)) continue;
      seen.add(n.id);
      stmts.insertRepoMapNode.run(
        repoMapNodePk(id, n.id),
        id,
        n.kind,
        n.path,
        n.name ?? null,
        n.symbolType ?? null,
        n.lineStart ?? null,
        n.lineEnd ?? null,
        (n.keywords || []).join(","),
        n.exported ? 1 : 0,
      );
    }
    for (const e of input.graph.edges.slice(0, 12000)) {
      stmts.insertRepoMapEdge.run(id, e.from, e.to, e.rel);
    }
  });
  write();
  return getRepoMap(input.roomId)!;
}

export function parseRepoMapGraph(row: RepoMapRow | undefined): RepoMapGraph {
  if (!row?.graph_json) return { nodes: [], edges: [] };
  try {
    const parsed = JSON.parse(row.graph_json) as RepoMapGraph;
    return {
      nodes: Array.isArray(parsed.nodes) ? parsed.nodes : [],
      edges: Array.isArray(parsed.edges) ? parsed.edges : [],
    };
  } catch {
    return { nodes: [], edges: [] };
  }
}

export function listMemoryEntries(
  roomId: string,
  opts?: { includeProposed?: boolean },
): MemoryEntryRow[] {
  const rows = stmts.listMemoryEntries.all(roomId) as MemoryEntryRow[];
  if (opts?.includeProposed) return rows;
  return rows.filter((r) => r.status !== "proposed");
}

export function getMemoryEntry(id: string): MemoryEntryRow | undefined {
  return stmts.getMemoryEntry.get(id) as MemoryEntryRow | undefined;
}

export function createMemoryEntry(input: {
  id?: string;
  roomId: string;
  kind: MemoryKind;
  title: string;
  content: string;
  status?: MemoryStatus;
  pinned?: boolean;
  createdByUserId?: string | null;
  createdByAgentId?: string | null;
  sourceMessageId?: string | null;
  sourcePath?: string | null;
  supersedesId?: string | null;
  source?: string;
}): MemoryEntryRow {
  const id = input.id || newId("mem_");
  const now = Date.now();
  const status: MemoryStatus = input.status || "active";
  stmts.insertMemoryEntry.run(
    id,
    input.roomId,
    input.kind,
    input.title,
    status,
    input.pinned ? 1 : 0,
    input.createdByUserId ?? null,
    input.createdByAgentId ?? null,
    now,
    now,
    1,
    input.supersedesId ?? null,
    input.source ?? "human",
  );
  stmts.insertMemoryRevision.run(
    id,
    1,
    input.content,
    input.sourceMessageId ?? null,
    input.sourcePath ?? null,
    input.createdByUserId ?? null,
    input.createdByAgentId ?? null,
    now,
  );
  if (status === "active") bumpRoomMemoryVersion(input.roomId);
  return getMemoryEntry(id)!;
}

export function updateMemoryEntry(input: {
  id: string;
  expectedRevision: number;
  title?: string;
  content?: string;
  status?: MemoryStatus;
  pinned?: boolean;
  sourceMessageId?: string | null;
  sourcePath?: string | null;
  actorUserId?: string | null;
  actorAgentId?: string | null;
}): MemoryEntryRow | null {
  const current = getMemoryEntry(input.id);
  if (!current) return null;
  if (current.current_revision !== input.expectedRevision) {
    const err = new Error("Memory revision conflict");
    (err as Error & { code?: string }).code = "revision_conflict";
    throw err;
  }
  const nextRev = current.current_revision + 1;
  const now = Date.now();
  const title = input.title ?? current.title;
  const status = input.status ?? current.status;
  const pinned =
    input.pinned === undefined ? current.pinned : input.pinned ? 1 : 0;
  const content = input.content ?? current.content;
  const result = stmts.updateMemoryEntry.run(
    title,
    status,
    pinned,
    now,
    nextRev,
    null,
    current.id,
    current.current_revision,
  );
  if (!result.changes) {
    const err = new Error("Memory revision conflict");
    (err as Error & { code?: string }).code = "revision_conflict";
    throw err;
  }
  stmts.insertMemoryRevision.run(
    current.id,
    nextRev,
    content,
    input.sourceMessageId ?? current.source_message_id,
    input.sourcePath ?? current.source_path,
    input.actorUserId ?? null,
    input.actorAgentId ?? null,
    now,
  );
  if (status === "active" || current.status === "active") {
    bumpRoomMemoryVersion(current.room_id);
  }
  return getMemoryEntry(current.id)!;
}

export function insertAgentContextReceipt(input: {
  id?: string;
  roomId: string;
  agentId: string;
  runId: string;
  mapId?: string | null;
  gitSha?: string | null;
  memoryVersion: number;
  entryIds: string[];
  fileIds: string[];
  isBaseline: boolean;
}): AgentContextReceiptRow {
  const id = input.id || newId("ctx_");
  const now = Date.now();
  stmts.insertContextReceipt.run(
    id,
    input.roomId,
    input.agentId,
    input.runId,
    input.mapId ?? null,
    input.gitSha ?? null,
    input.memoryVersion,
    JSON.stringify(input.entryIds),
    JSON.stringify(input.fileIds),
    input.isBaseline ? 1 : 0,
    now,
  );
  return {
    id,
    room_id: input.roomId,
    agent_id: input.agentId,
    run_id: input.runId,
    map_id: input.mapId ?? null,
    git_sha: input.gitSha ?? null,
    memory_version: input.memoryVersion,
    entry_ids_json: JSON.stringify(input.entryIds),
    file_ids_json: JSON.stringify(input.fileIds),
    is_baseline: input.isBaseline ? 1 : 0,
    created_at: now,
  };
}

export function listAgentContextReceipts(
  agentId: string,
  limit = 20,
): AgentContextReceiptRow[] {
  return stmts.listContextReceiptsForAgent.all(
    agentId,
    limit,
  ) as AgentContextReceiptRow[];
}

export function latestContextReceiptsByAgent(
  roomId: string,
): AgentContextReceiptRow[] {
  const rows = stmts.latestContextReceiptsForRoom.all(
    roomId,
  ) as AgentContextReceiptRow[];
  const seen = new Set<string>();
  const out: AgentContextReceiptRow[] = [];
  for (const row of rows) {
    if (seen.has(row.agent_id)) continue;
    seen.add(row.agent_id);
    out.push(row);
  }
  return out;
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

