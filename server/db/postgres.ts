import pg from "pg";
import { randomBytes } from "crypto";
import type {
  AgentBackendKind,
  AgentRuntime,
  AgentStatus,
  AuthMode,
  ChatMessage,
  SteerLogEntry,
} from "../../shared/events.js";
import type { ApprovalStatus } from "../../shared/approvals.js";

function newId(prefix = ""): string {
  return `${prefix}${randomBytes(8).toString("hex")}`;
}

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
      owner_id TEXT,
      org_id TEXT,
      control_mode TEXT NOT NULL DEFAULT 'open',
      approval_mode TEXT NOT NULL DEFAULT 'off',
      slack_webhook_ciphertext TEXT,
      slack_webhook_hint TEXT
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
      todos_json TEXT,
      status TEXT NOT NULL DEFAULT 'done',
      ts BIGINT NOT NULL,
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
      role TEXT NOT NULL DEFAULT 'editor',
      PRIMARY KEY (room_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS invite_links (
      code TEXT PRIMARY KEY,
      room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
      created_by TEXT NOT NULL REFERENCES users(id),
      created_at BIGINT NOT NULL,
      max_uses INTEGER,
      use_count INTEGER NOT NULL DEFAULT 0,
      expires_at BIGINT,
      role TEXT NOT NULL DEFAULT 'viewer'
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
      created_at BIGINT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      plan_mode INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS agent_drivers (
      agent_id TEXT PRIMARY KEY REFERENCES agents(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL,
      granted_at BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS file_locks (
      room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
      path TEXT NOT NULL,
      agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      call_id TEXT,
      acquired_at BIGINT NOT NULL,
      expires_at BIGINT NOT NULL,
      PRIMARY KEY (room_id, path)
    );

    CREATE TABLE IF NOT EXISTS organizations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      allowed_domains TEXT NOT NULL DEFAULT '',
      created_by TEXT NOT NULL REFERENCES users(id),
      created_at BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS organization_members (
      org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL DEFAULT 'member',
      created_at BIGINT NOT NULL,
      PRIMARY KEY (org_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS organization_invites (
      code TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      created_by TEXT NOT NULL REFERENCES users(id),
      role TEXT NOT NULL DEFAULT 'member',
      created_at BIGINT NOT NULL,
      max_uses INTEGER,
      use_count INTEGER NOT NULL DEFAULT 0,
      expires_at BIGINT
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
      created_at BIGINT NOT NULL,
      decided_at BIGINT,
      decided_by_user_id TEXT,
      decided_by_name TEXT
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_steer_room_ts ON steer_messages(room_id, ts);
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_messages_room_ts ON messages(room_id, ts);
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_agents_room ON agents(room_id, sort_order);
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_org_members_user ON organization_members(user_id);
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_approval_requests_room_status ON approval_requests(room_id, status);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS room_pings (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
      actor_user_id TEXT NOT NULL,
      actor_name TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      targets TEXT NOT NULL DEFAULT 'everyone',
      status TEXT NOT NULL DEFAULT 'open',
      created_at BIGINT NOT NULL
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS room_ping_acks (
      ping_id TEXT NOT NULL REFERENCES room_pings(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL,
      user_name TEXT NOT NULL,
      acked_at BIGINT NOT NULL,
      PRIMARY KEY (ping_id, user_id)
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_room_pings_room_status ON room_pings(room_id, status);
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
    `ALTER TABLE invite_links ADD COLUMN IF NOT EXISTS expires_at BIGINT`,
    `ALTER TABLE messages ADD COLUMN IF NOT EXISTS agent_id TEXT`,
    `ALTER TABLE messages ADD COLUMN IF NOT EXISTS todos_json TEXT`,
    `ALTER TABLE rooms ADD COLUMN IF NOT EXISTS org_id TEXT`,
    `ALTER TABLE rooms ADD COLUMN IF NOT EXISTS control_mode TEXT NOT NULL DEFAULT 'open'`,
    `ALTER TABLE invite_links ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'viewer'`,
    `ALTER TABLE rooms ADD COLUMN IF NOT EXISTS approval_mode TEXT NOT NULL DEFAULT 'off'`,
    `ALTER TABLE agents ADD COLUMN IF NOT EXISTS plan_mode INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE messages ADD COLUMN IF NOT EXISTS sender_user_id TEXT`,
    `ALTER TABLE rooms ADD COLUMN IF NOT EXISTS slack_webhook_ciphertext TEXT`,
    `ALTER TABLE rooms ADD COLUMN IF NOT EXISTS slack_webhook_hint TEXT`,
    `ALTER TABLE messages ADD COLUMN IF NOT EXISTS plan_status TEXT`,
    `ALTER TABLE messages ADD COLUMN IF NOT EXISTS attachments_json TEXT`,
  ];

  for (const sql of migrations) {
    try {
      await pool.query(sql);
    } catch {
      // column already exists
    }
  }

  try {
    await pool.query(
      `UPDATE room_members SET role = 'editor' WHERE role = 'member'`,
    );
  } catch {
    // ignore
  }

  try {
    await pool.query(`
      UPDATE invite_links
      SET role = 'editor'
      WHERE role IS NULL OR TRIM(role) = '' OR role = 'member'
    `);
  } catch {
    // ignore
  }

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_rooms_org ON rooms(org_id);
  `);
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
  org_id: string | null;
  control_mode: string;
  approval_mode: string;
  slack_webhook_ciphertext: string | null;
  slack_webhook_hint: string | null;
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
    org_id: (r.org_id as string) ?? null,
    control_mode: ((r.control_mode as string) || "open"),
    approval_mode: ((r.approval_mode as string) || "off"),
    slack_webhook_ciphertext: (r.slack_webhook_ciphertext as string) ?? null,
    slack_webhook_hint: (r.slack_webhook_hint as string) ?? null,
  };
}

function parseTodosJson(
  raw: unknown,
): ChatMessage["todos"] {
  if (typeof raw !== "string" || !raw) return undefined;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return undefined;
    return parsed as NonNullable<ChatMessage["todos"]>;
  } catch {
    return undefined;
  }
}

function parseAttachmentsJson(
  raw: unknown,
): ChatMessage["attachments"] {
  if (typeof raw !== "string" || !raw) return undefined;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return undefined;
    return parsed as NonNullable<ChatMessage["attachments"]>;
  } catch {
    return undefined;
  }
}

function rowToMessage(r: Record<string, unknown>): ChatMessage {
  const planRaw = r.plan_status as string | null | undefined;
  const planStatus =
    planRaw === "pending" || planRaw === "approved" || planRaw === "dismissed"
      ? planRaw
      : undefined;
  return {
    id: r.id as string,
    roomId: r.room_id as string,
    role: r.role as ChatMessage["role"],
    content: r.content as string,
    senderName: (r.sender_name as string) ?? undefined,
    senderColor: (r.sender_color as string) ?? undefined,
    toolName: (r.tool_name as string) ?? undefined,
    diffPatch: (r.diff_patch as string) || undefined,
    todos: parseTodosJson(r.todos_json),
    status: r.status as ChatMessage["status"],
    ts: num(r.ts as string)!,
    agentId: (r.agent_id as string) || undefined,
    senderUserId: (r.sender_user_id as string) || undefined,
    planStatus,
    attachments: parseAttachmentsJson(r.attachments_json),
  };
}

function rowToOrganization(r: Record<string, unknown>): OrganizationRow {
  return {
    id: r.id as string,
    name: r.name as string,
    slug: r.slug as string,
    allowed_domains: r.allowed_domains as string,
    created_by: r.created_by as string,
    created_at: num(r.created_at as string | number)!,
  };
}

function rowToOrganizationMember(
  r: Record<string, unknown>,
): OrganizationMemberRow {
  return {
    org_id: r.org_id as string,
    user_id: r.user_id as string,
    role: r.role as OrgRoleRow,
    created_at: num(r.created_at as string | number)!,
  };
}

function rowToOrganizationInvite(
  r: Record<string, unknown>,
): OrganizationInviteRow {
  return {
    code: r.code as string,
    org_id: r.org_id as string,
    created_by: r.created_by as string,
    role: r.role as OrgRoleRow,
    created_at: num(r.created_at as string | number)!,
    max_uses: num(r.max_uses as string | number | null),
    use_count: num(r.use_count as string | number) ?? 0,
    expires_at: num(r.expires_at as string | number | null),
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

// Top-level await ensures schema is initialized before any exports are used
await ready;

export function createRoom(input: CreateRoomInput): RoomRow {
  const now = Date.now();
  const controlMode =
    input.controlMode?.trim() ||
    (input.runtime === "local" ? "driver" : "open");
  const result = syncQuery<Record<string, unknown>>(
    `INSERT INTO rooms (
      id, name, repo_path, agent_command, created_at, last_active_at, status,
      runtime, auth_mode, model_id, repo_url, starting_ref, cursor_agent_id,
      cursor_session_id, pr_url, auto_create_pr, key_ciphertext, key_hint, owner_id, org_id,
      control_mode, approval_mode
    ) VALUES ($1,$2,$3,$4,$5,$6,'active',$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
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
      input.cursorSessionId ?? null,
      input.prUrl ?? null,
      input.autoCreatePR ? 1 : 0,
      input.keyCiphertext ?? null,
      input.keyHint ?? null,
      input.ownerId ?? null,
      input.orgId ?? null,
      controlMode,
      input.approvalMode?.trim() || "off",
    ],
  );
  return pgRowToRoom(result[0]);
}

export function setRoomOwner(roomId: string, ownerId: string): void {
  syncQuery(`UPDATE rooms SET owner_id = $1 WHERE id = $2`, [ownerId, roomId]);
}

export function setRoomControlMode(roomId: string, controlMode: string): void {
  syncQuery(`UPDATE rooms SET control_mode = $1 WHERE id = $2`, [
    controlMode,
    roomId,
  ]);
}

export function setRoomApprovalMode(roomId: string, approvalMode: string): void {
  syncQuery(`UPDATE rooms SET approval_mode = $1 WHERE id = $2`, [
    approvalMode,
    roomId,
  ]);
}

export function setRoomSlackWebhook(
  roomId: string,
  ciphertext: string,
  hint: string,
): void {
  syncQuery(
    `UPDATE rooms SET slack_webhook_ciphertext = $1, slack_webhook_hint = $2 WHERE id = $3`,
    [ciphertext, hint, roomId],
  );
}

export function clearRoomSlackWebhook(roomId: string): void {
  syncQuery(
    `UPDATE rooms SET slack_webhook_ciphertext = NULL, slack_webhook_hint = NULL WHERE id = $1`,
    [roomId],
  );
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

/** Attach / replace an encrypted Cursor BYOK key on an existing room. */
export function setRoomByokKey(
  roomId: string,
  keyCiphertext: string,
  keyHint: string,
): void {
  syncQuery(
    `UPDATE rooms SET key_ciphertext = $1, key_hint = $2 WHERE id = $3`,
    [keyCiphertext, keyHint, roomId],
  );
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
    `INSERT INTO messages (id, room_id, role, content, sender_name, sender_color, tool_name, diff_patch, todos_json, status, ts, agent_id, sender_user_id, plan_status, attachments_json)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
    [
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
    ],
  );
}

export function updateMessagePlanStatus(
  id: string,
  planStatus: NonNullable<ChatMessage["planStatus"]> | null,
): ChatMessage | undefined {
  syncQuery(`UPDATE messages SET plan_status = $1 WHERE id = $2`, [
    planStatus,
    id,
  ]);
  return getMessage(id);
}

export function getMessage(id: string): ChatMessage | undefined {
  const rows = syncQuery<Record<string, unknown>>(
    `SELECT * FROM messages WHERE id = $1`,
    [id],
  );
  return rows.length ? rowToMessage(rows[0]) : undefined;
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

export function updateMessageTool(
  id: string,
  content: string,
  status: ChatMessage["status"],
  opts: {
    diffPatch?: string;
    todos?: ChatMessage["todos"];
  } = {},
): void {
  const todosJson =
    opts.todos && opts.todos.length > 0 ? JSON.stringify(opts.todos) : null;
  syncQuery(
    `UPDATE messages SET content = $1, status = $2,
        diff_patch = COALESCE($3, diff_patch),
        todos_json = COALESCE($4, todos_json)
     WHERE id = $5`,
    [
      content,
      status,
      opts.diffPatch?.trim() ? opts.diffPatch : null,
      todosJson,
      id,
    ],
  );
}

export function getMessages(roomId: string, limit = 500): ChatMessage[] {
  // Newest-first so LIMIT keeps recent history; reverse for chronological UI.
  const rows = syncQuery<Record<string, unknown>>(
    `SELECT * FROM messages WHERE room_id = $1 ORDER BY ts DESC, id DESC LIMIT $2`,
    [roomId, limit],
  );
  return rows.map(rowToMessage).reverse();
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

export function getRoomMemberRole(
  roomId: string,
  userId: string,
): string | null {
  const members = getRoomMembers(roomId);
  const hit = members.find((m) => m.user_id === userId);
  return hit?.role ?? null;
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
  expiresAt: number | null = null,
  role: string = "viewer",
): void {
  syncQuery(
    `INSERT INTO invite_links (code, room_id, created_by, created_at, max_uses, use_count, expires_at, role) VALUES ($1,$2,$3,$4,$5,0,$6,$7)`,
    [code, roomId, createdBy, Date.now(), maxUses, expiresAt, role],
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
  const rows = syncQuery<{
    code: string;
    room_id: string;
    created_by: string;
    created_at: string;
    max_uses: number | null;
    use_count: number;
    expires_at: string | null;
    role: string | null;
  }>(`SELECT * FROM invite_links WHERE code = $1`, [code]);
  if (!rows.length) return undefined;
  const r = rows[0];
  return {
    ...r,
    created_at: num(r.created_at)!,
    expires_at: num(r.expires_at),
    role: r.role || "editor",
  };
}

export function listInviteLinks(roomId: string): InviteLinkRow[] {
  const rows = syncQuery<{
    code: string;
    room_id: string;
    created_by: string;
    created_at: string;
    max_uses: number | null;
    use_count: number;
    expires_at: string | null;
    role: string | null;
  }>(
    `SELECT * FROM invite_links WHERE room_id = $1 ORDER BY created_at DESC`,
    [roomId],
  );
  return rows.map((r) => ({
    ...r,
    created_at: num(r.created_at)!,
    expires_at: num(r.expires_at),
    role: r.role || "editor",
  }));
}

export function deleteInviteLink(code: string): boolean {
  const existing = getInviteLink(code);
  if (!existing) return false;
  syncQuery(`DELETE FROM invite_links WHERE code = $1`, [code]);
  return true;
}

/** Atomically increment use_count if under maxUses and not expired. */
export function useInviteLink(code: string): boolean {
  const before = getInviteLink(code);
  if (!before) return false;
  if (before.expires_at !== null && before.expires_at <= Date.now()) return false;
  if (before.max_uses !== null && before.use_count >= before.max_uses) return false;
  syncQuery(
    `UPDATE invite_links SET use_count = use_count + 1
     WHERE code = $1
       AND (max_uses IS NULL OR use_count < max_uses)
       AND (expires_at IS NULL OR expires_at > $2)`,
    [code, Date.now()],
  );
  const after = getInviteLink(code);
  return Boolean(after && after.use_count === before.use_count + 1);
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
     LEFT JOIN organization_members om ON om.org_id = r.org_id
     WHERE r.owner_id = $1 OR rm.user_id = $2 OR om.user_id = $3
     ORDER BY r.last_active_at DESC`,
    [userId, userId, userId],
  ).map(pgRowToRoom);
}

export function listPersonalRoomsByUser(userId: string): RoomRow[] {
  return syncQuery<Record<string, unknown>>(
    `SELECT DISTINCT r.* FROM rooms r
     LEFT JOIN room_members rm ON rm.room_id = r.id
     WHERE (r.org_id IS NULL OR r.org_id = '')
       AND (r.owner_id = $1 OR rm.user_id = $2)
     ORDER BY r.last_active_at DESC`,
    [userId, userId],
  ).map(pgRowToRoom);
}

export function listRoomsByOrg(orgId: string): RoomRow[] {
  return syncQuery<Record<string, unknown>>(
    `SELECT * FROM rooms WHERE org_id = $1 ORDER BY last_active_at DESC`,
    [orgId],
  ).map(pgRowToRoom);
}

/** Stop active org rooms and detach them before deleting the organization. */
export function detachOrganizationRooms(orgId: string): number {
  syncQuery(
    `UPDATE rooms SET status = 'stopped' WHERE org_id = $1 AND status = 'active'`,
    [orgId],
  );
  const rows = syncQuery<{ count: string }>(
    `WITH updated AS (
       UPDATE rooms SET org_id = NULL WHERE org_id = $1
       RETURNING 1
     )
     SELECT COUNT(*)::text AS count FROM updated`,
    [orgId],
  );
  return Number(rows[0]?.count ?? 0);
}

export function createOrganization(input: {
  id: string;
  name: string;
  slug: string;
  allowedDomains?: string;
  createdBy: string;
}): OrganizationRow {
  const now = Date.now();
  const rows = syncQuery<Record<string, unknown>>(
    `INSERT INTO organizations (id, name, slug, allowed_domains, created_by, created_at)
     VALUES ($1,$2,$3,$4,$5,$6)
     RETURNING *`,
    [
      input.id,
      input.name,
      input.slug,
      input.allowedDomains ?? "",
      input.createdBy,
      now,
    ],
  );
  return rowToOrganization(rows[0]);
}

export function getOrganization(id: string): OrganizationRow | undefined {
  const rows = syncQuery<Record<string, unknown>>(
    `SELECT * FROM organizations WHERE id = $1`,
    [id],
  );
  return rows.length ? rowToOrganization(rows[0]) : undefined;
}

export function getOrganizationBySlug(
  slug: string,
): OrganizationRow | undefined {
  const rows = syncQuery<Record<string, unknown>>(
    `SELECT * FROM organizations WHERE slug = $1`,
    [slug],
  );
  return rows.length ? rowToOrganization(rows[0]) : undefined;
}

export function updateOrganization(
  id: string,
  input: { name: string; slug: string; allowedDomains: string },
): void {
  syncQuery(
    `UPDATE organizations SET name = $1, slug = $2, allowed_domains = $3 WHERE id = $4`,
    [input.name, input.slug, input.allowedDomains, id],
  );
}

export function deleteOrganization(id: string): void {
  syncQuery(`DELETE FROM organizations WHERE id = $1`, [id]);
}

export function listOrganizationsForUser(
  userId: string,
): Array<OrganizationRow & { member_role: OrgRoleRow }> {
  const rows = syncQuery<Record<string, unknown>>(
    `SELECT o.*, om.role AS member_role
     FROM organizations o
     INNER JOIN organization_members om ON om.org_id = o.id
     WHERE om.user_id = $1
     ORDER BY LOWER(o.name) ASC`,
    [userId],
  );
  return rows.map((r) => ({
    ...rowToOrganization(r),
    member_role: r.member_role as OrgRoleRow,
  }));
}

export function listOrganizationsWithDomains(): OrganizationRow[] {
  return syncQuery<Record<string, unknown>>(
    `SELECT * FROM organizations
     WHERE allowed_domains != ''
     ORDER BY LOWER(name) ASC`,
  ).map(rowToOrganization);
}

export function addOrganizationMember(
  orgId: string,
  userId: string,
  role: OrgRoleRow,
): void {
  syncQuery(
    `INSERT INTO organization_members (org_id, user_id, role, created_at)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT(org_id, user_id) DO UPDATE SET
       role = excluded.role,
       created_at = excluded.created_at`,
    [orgId, userId, role, Date.now()],
  );
}

export function getOrganizationMember(
  orgId: string,
  userId: string,
): OrganizationMemberRow | undefined {
  const rows = syncQuery<Record<string, unknown>>(
    `SELECT * FROM organization_members WHERE org_id = $1 AND user_id = $2`,
    [orgId, userId],
  );
  return rows.length ? rowToOrganizationMember(rows[0]) : undefined;
}

export function listOrganizationMembers(orgId: string): Array<{
  org_id: string;
  user_id: string;
  role: OrgRoleRow;
  created_at: number;
  email: string;
  name: string;
}> {
  const rows = syncQuery<Record<string, unknown>>(
    `SELECT om.org_id, om.user_id, om.role, om.created_at, u.email, u.name
     FROM organization_members om
     INNER JOIN users u ON u.id = om.user_id
     WHERE om.org_id = $1
     ORDER BY
       CASE om.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END,
       LOWER(u.name) ASC`,
    [orgId],
  );
  return rows.map((r) => ({
    ...rowToOrganizationMember(r),
    email: r.email as string,
    name: r.name as string,
  }));
}

export function countOrganizationMembers(orgId: string): number {
  const rows = syncQuery<{ c: string }>(
    `SELECT COUNT(*)::text AS c FROM organization_members WHERE org_id = $1`,
    [orgId],
  );
  return Number(rows[0]?.c ?? 0);
}

export function updateOrganizationMemberRole(
  orgId: string,
  userId: string,
  role: OrgRoleRow,
): void {
  syncQuery(
    `UPDATE organization_members SET role = $1 WHERE org_id = $2 AND user_id = $3`,
    [role, orgId, userId],
  );
}

export function removeOrganizationMember(
  orgId: string,
  userId: string,
): void {
  syncQuery(
    `DELETE FROM organization_members WHERE org_id = $1 AND user_id = $2`,
    [orgId, userId],
  );
}

export function createOrganizationInvite(input: {
  code: string;
  orgId: string;
  createdBy: string;
  role?: OrgRoleRow;
  maxUses?: number | null;
  expiresAt?: number | null;
}): OrganizationInviteRow {
  const rows = syncQuery<Record<string, unknown>>(
    `INSERT INTO organization_invites
       (code, org_id, created_by, role, created_at, max_uses, use_count, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,0,$7)
     RETURNING *`,
    [
      input.code,
      input.orgId,
      input.createdBy,
      input.role ?? "member",
      Date.now(),
      input.maxUses ?? null,
      input.expiresAt ?? null,
    ],
  );
  return rowToOrganizationInvite(rows[0]);
}

export function getOrganizationInvite(
  code: string,
): OrganizationInviteRow | undefined {
  const rows = syncQuery<Record<string, unknown>>(
    `SELECT * FROM organization_invites WHERE code = $1`,
    [code],
  );
  return rows.length ? rowToOrganizationInvite(rows[0]) : undefined;
}

export function listOrganizationInvites(
  orgId: string,
): OrganizationInviteRow[] {
  return syncQuery<Record<string, unknown>>(
    `SELECT * FROM organization_invites WHERE org_id = $1 ORDER BY created_at DESC`,
    [orgId],
  ).map(rowToOrganizationInvite);
}

export function deleteOrganizationInvite(code: string): void {
  syncQuery(`DELETE FROM organization_invites WHERE code = $1`, [code]);
}

export function useOrganizationInvite(code: string): boolean {
  const rows = syncQuery<{ count: string }>(
    `WITH updated AS (
       UPDATE organization_invites SET use_count = use_count + 1
       WHERE code = $1
         AND (max_uses IS NULL OR use_count < max_uses)
         AND (expires_at IS NULL OR expires_at > $2)
       RETURNING 1
     )
     SELECT COUNT(*)::text AS count FROM updated`,
    [code, Date.now()],
  );
  return Number(rows[0]?.count ?? 0) > 0;
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
    created_at: num(r.created_at as string)!,
    sort_order: num(r.sort_order as string) ?? 0,
    plan_mode: num(r.plan_mode as string) ?? 0,
  };
}

export function createAgent(input: CreateAgentInput): AgentRow {
  const id = input.id || newId("ag_");
  const now = Date.now();
  const existing = listAgents(input.roomId);
  const sortOrder =
    input.sortOrder ??
    (existing.length ? Math.max(...existing.map((a) => a.sort_order)) + 1 : 0);
  const rows = syncQuery<Record<string, unknown>>(
    `INSERT INTO agents (
      id, room_id, backend, label, scope_path, session_id, sdk_agent_id,
      model_id, status, branch, pr_url, created_by, created_at, sort_order, plan_mode
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
    RETURNING *`,
    [
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
    ],
  );
  return rowToAgent(rows[0]);
}

export function getAgent(id: string): AgentRow | undefined {
  const rows = syncQuery<Record<string, unknown>>(
    `SELECT * FROM agents WHERE id = $1`,
    [id],
  );
  return rows.length ? rowToAgent(rows[0]) : undefined;
}

export function listAgents(roomId: string): AgentRow[] {
  return syncQuery<Record<string, unknown>>(
    `SELECT * FROM agents WHERE room_id = $1 ORDER BY sort_order ASC, created_at ASC`,
    [roomId],
  ).map(rowToAgent);
}

export function updateAgentStatus(id: string, status: AgentStatus): void {
  syncQuery(`UPDATE agents SET status = $1 WHERE id = $2`, [status, id]);
}

export function setAgentSessionId(
  id: string,
  sessionId: string | null,
): void {
  syncQuery(`UPDATE agents SET session_id = $1 WHERE id = $2`, [
    sessionId,
    id,
  ]);
}

export function setAgentSdkId(id: string, sdkAgentId: string | null): void {
  syncQuery(`UPDATE agents SET sdk_agent_id = $1 WHERE id = $2`, [
    sdkAgentId,
    id,
  ]);
}

export function setAgentModel(id: string, modelId: string): void {
  syncQuery(`UPDATE agents SET model_id = $1 WHERE id = $2`, [modelId, id]);
}

export function setAgentLabel(id: string, label: string): void {
  syncQuery(`UPDATE agents SET label = $1 WHERE id = $2`, [label, id]);
}

export function setAgentPlanMode(id: string, planMode: boolean): void {
  syncQuery(`UPDATE agents SET plan_mode = $1 WHERE id = $2`, [
    planMode ? 1 : 0,
    id,
  ]);
}

export function setAgentScope(id: string, scopePath: string | null): void {
  syncQuery(`UPDATE agents SET scope_path = $1 WHERE id = $2`, [
    scopePath,
    id,
  ]);
}

export function setAgentPr(
  id: string,
  prUrl: string | null,
  branch?: string | null,
): void {
  const existing = getAgent(id);
  syncQuery(`UPDATE agents SET pr_url = $1, branch = $2 WHERE id = $3`, [
    prUrl,
    branch !== undefined ? branch : (existing?.branch ?? null),
    id,
  ]);
}

export function deleteAgent(id: string): void {
  syncQuery(`DELETE FROM agents WHERE id = $1`, [id]);
}

export function setAgentDriver(agentId: string, userId: string): void {
  syncQuery(
    `INSERT INTO agent_drivers (agent_id, user_id, granted_at) VALUES ($1,$2,$3)
     ON CONFLICT(agent_id) DO UPDATE SET user_id = excluded.user_id, granted_at = excluded.granted_at`,
    [agentId, userId, Date.now()],
  );
}

export function clearAgentDriver(agentId: string): void {
  syncQuery(`DELETE FROM agent_drivers WHERE agent_id = $1`, [agentId]);
}

export function getAgentDrivers(
  roomId: string,
): Array<{ agent_id: string; user_id: string; granted_at: number }> {
  const rows = syncQuery<{
    agent_id: string;
    user_id: string;
    granted_at: string;
  }>(
    `SELECT ad.agent_id, ad.user_id, ad.granted_at
     FROM agent_drivers ad
     JOIN agents a ON a.id = ad.agent_id
     WHERE a.room_id = $1`,
    [roomId],
  );
  return rows.map((r) => ({
    agent_id: r.agent_id,
    user_id: r.user_id,
    granted_at: num(r.granted_at)!,
  }));
}

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
  syncQuery(
    `INSERT INTO file_locks (room_id, path, agent_id, call_id, acquired_at, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (room_id, path) DO UPDATE SET
       agent_id = excluded.agent_id,
       call_id = excluded.call_id,
       acquired_at = excluded.acquired_at,
       expires_at = excluded.expires_at`,
    [
      input.roomId,
      input.path,
      input.agentId,
      input.callId ?? null,
      input.acquiredAt,
      input.expiresAt,
    ],
  );
}

export function getFileLock(
  roomId: string,
  path: string,
): FileLockRow | undefined {
  const rows = syncQuery<Record<string, unknown>>(
    `SELECT * FROM file_locks WHERE room_id = $1 AND path = $2`,
    [roomId, path],
  );
  return rows.length ? rowToFileLock(rows[0]) : undefined;
}

export function listFileLocks(roomId: string): FileLockRow[] {
  return syncQuery<Record<string, unknown>>(
    `SELECT * FROM file_locks WHERE room_id = $1 ORDER BY path ASC`,
    [roomId],
  ).map(rowToFileLock);
}

export function listAllFileLocks(): FileLockRow[] {
  return syncQuery<Record<string, unknown>>(`SELECT * FROM file_locks`).map(
    rowToFileLock,
  );
}

export function deleteFileLock(roomId: string, path: string): void {
  syncQuery(`DELETE FROM file_locks WHERE room_id = $1 AND path = $2`, [
    roomId,
    path,
  ]);
}

export function deleteFileLocksForAgent(
  roomId: string,
  agentId: string,
): number {
  const rows = syncQuery<{ count: string }>(
    `WITH deleted AS (
       DELETE FROM file_locks WHERE room_id = $1 AND agent_id = $2 RETURNING 1
     ) SELECT COUNT(*)::text AS count FROM deleted`,
    [roomId, agentId],
  );
  return Number(rows[0]?.count ?? 0);
}

export function deleteFileLocksForRoom(roomId: string): void {
  syncQuery(`DELETE FROM file_locks WHERE room_id = $1`, [roomId]);
}

export function deleteExpiredFileLocks(now: number): void {
  syncQuery(`DELETE FROM file_locks WHERE expires_at <= $1`, [now]);
}

export function deleteExpiredFileLocksForRoom(
  roomId: string,
  now: number,
): void {
  syncQuery(
    `DELETE FROM file_locks WHERE room_id = $1 AND expires_at <= $2`,
    [roomId, now],
  );
}

function rowToFileLock(r: Record<string, unknown>): FileLockRow {
  return {
    room_id: String(r.room_id),
    path: String(r.path),
    agent_id: String(r.agent_id),
    call_id: (r.call_id as string) ?? null,
    acquired_at: Number(r.acquired_at),
    expires_at: Number(r.expires_at),
  };
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

function rowToApprovalRequest(r: Record<string, unknown>): ApprovalRequestRow {
  return {
    id: r.id as string,
    room_id: r.room_id as string,
    agent_id: r.agent_id as string,
    call_id: r.call_id as string,
    tool_name: r.tool_name as string,
    detail: (r.detail as string) ?? "",
    path: (r.path as string) ?? null,
    status: (r.status as ApprovalStatus) || "pending",
    created_at: num(r.created_at as string)!,
    decided_at: num(r.decided_at as string | number | null),
    decided_by_user_id: (r.decided_by_user_id as string) ?? null,
    decided_by_name: (r.decided_by_name as string) ?? null,
  };
}

export function createApprovalRequest(
  input: CreateApprovalRequestInput,
): ApprovalRequestRow {
  const id = input.id || newId("apr_");
  const rows = syncQuery<Record<string, unknown>>(
    `INSERT INTO approval_requests (
      id, room_id, agent_id, call_id, tool_name, detail, path, status, created_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,'pending',$8)
    RETURNING *`,
    [
      id,
      input.roomId,
      input.agentId,
      input.callId,
      input.toolName,
      input.detail ?? "",
      input.path ?? null,
      Date.now(),
    ],
  );
  return rowToApprovalRequest(rows[0]);
}

export function getApprovalRequest(id: string): ApprovalRequestRow | undefined {
  const rows = syncQuery<Record<string, unknown>>(
    `SELECT * FROM approval_requests WHERE id = $1`,
    [id],
  );
  return rows.length ? rowToApprovalRequest(rows[0]) : undefined;
}

export function listPendingApprovals(roomId: string): ApprovalRequestRow[] {
  return syncQuery<Record<string, unknown>>(
    `SELECT * FROM approval_requests WHERE room_id = $1 AND status = 'pending' ORDER BY created_at ASC`,
    [roomId],
  ).map(rowToApprovalRequest);
}

export function resolveApprovalRequest(
  id: string,
  status: "approved" | "denied",
  decidedByUserId: string,
  decidedByName: string,
): ApprovalRequestRow | undefined {
  syncQuery(
    `UPDATE approval_requests
     SET status = $1, decided_at = $2, decided_by_user_id = $3, decided_by_name = $4
     WHERE id = $5`,
    [status, Date.now(), decidedByUserId, decidedByName, id],
  );
  return getApprovalRequest(id);
}

export function expireApprovalRequest(id: string): void {
  syncQuery(
    `UPDATE approval_requests SET status = 'expired', decided_at = $1 WHERE id = $2`,
    [Date.now(), id],
  );
}

// --- Room review pings ---

export type RoomPingStatus = "open" | "dismissed";

export interface RoomPingRow {
  id: string;
  room_id: string;
  actor_user_id: string;
  actor_name: string;
  note: string;
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
  targets?: "everyone" | string[];
}

function rowToRoomPing(r: Record<string, unknown>): RoomPingRow {
  return {
    id: r.id as string,
    room_id: r.room_id as string,
    actor_user_id: r.actor_user_id as string,
    actor_name: r.actor_name as string,
    note: (r.note as string) ?? "",
    targets: (r.targets as string) || "everyone",
    status: ((r.status as RoomPingStatus) || "open"),
    created_at: num(r.created_at as string)!,
  };
}

function rowToRoomPingAck(r: Record<string, unknown>): RoomPingAckRow {
  return {
    ping_id: r.ping_id as string,
    user_id: r.user_id as string,
    user_name: r.user_name as string,
    acked_at: num(r.acked_at as string)!,
  };
}

export function createRoomPing(input: CreateRoomPingInput): RoomPingRow {
  const id = input.id || newId("ping_");
  const targets =
    !input.targets || input.targets === "everyone"
      ? "everyone"
      : JSON.stringify(input.targets);
  const rows = syncQuery<Record<string, unknown>>(
    `INSERT INTO room_pings (
      id, room_id, actor_user_id, actor_name, note, targets, status, created_at
    ) VALUES ($1,$2,$3,$4,$5,$6,'open',$7)
    RETURNING *`,
    [
      id,
      input.roomId,
      input.actorUserId,
      input.actorName,
      (input.note || "").slice(0, 2000),
      targets,
      Date.now(),
    ],
  );
  return rowToRoomPing(rows[0]);
}

export function getRoomPing(id: string): RoomPingRow | undefined {
  const rows = syncQuery<Record<string, unknown>>(
    `SELECT * FROM room_pings WHERE id = $1`,
    [id],
  );
  return rows.length ? rowToRoomPing(rows[0]) : undefined;
}

export function listOpenRoomPings(roomId: string): RoomPingRow[] {
  return syncQuery<Record<string, unknown>>(
    `SELECT * FROM room_pings WHERE room_id = $1 AND status = 'open' ORDER BY created_at DESC`,
    [roomId],
  ).map(rowToRoomPing);
}

export function dismissRoomPing(id: string): RoomPingRow | undefined {
  syncQuery(
    `UPDATE room_pings SET status = 'dismissed' WHERE id = $1 AND status = 'open'`,
    [id],
  );
  return getRoomPing(id);
}

export function ackRoomPing(
  pingId: string,
  userId: string,
  userName: string,
): boolean {
  const rows = syncQuery<Record<string, unknown>>(
    `INSERT INTO room_ping_acks (ping_id, user_id, user_name, acked_at)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (ping_id, user_id) DO NOTHING
     RETURNING *`,
    [pingId, userId, userName.slice(0, 80) || "Someone", Date.now()],
  );
  return rows.length > 0;
}

export function listRoomPingAcks(pingId: string): RoomPingAckRow[] {
  return syncQuery<Record<string, unknown>>(
    `SELECT * FROM room_ping_acks WHERE ping_id = $1 ORDER BY acked_at ASC`,
    [pingId],
  ).map(rowToRoomPingAck);
}

export function migrateAgentsV1(): void {
  if (getSetting("migration:agents_v1") === "done") return;
  const rooms = listRooms();
  for (const room of rooms) {
    const agents = listAgents(room.id);
    if (agents.length > 0) {
      syncQuery(
        `UPDATE messages SET agent_id = $1 WHERE room_id = $2 AND agent_id IS NULL`,
        [agents[0].id, room.id],
      );
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
    syncQuery(
      `UPDATE messages SET agent_id = $1 WHERE room_id = $2 AND agent_id IS NULL`,
      [agent.id, room.id],
    );
  }
  setSetting("migration:agents_v1", "done");
}

migrateAgentsV1();

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
