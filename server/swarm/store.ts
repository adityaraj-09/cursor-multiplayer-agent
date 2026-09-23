import { nanoid } from "nanoid";
import * as db from "../db.js";
import {
  SWARM_ELO_START,
  isSwarmArtifactKind,
  isSwarmCritiqueVerdict,
  isSwarmHypothesisStatus,
  isSwarmPostKind,
  isSwarmRole,
  isSwarmStatus,
  isSwarmTaskKind,
  isSwarmTaskStatus,
  type SwarmAgentInfo,
  type SwarmAgentStatus,
  type SwarmArtifactInfo,
  type SwarmArtifactKind,
  type SwarmCritiqueInfo,
  type SwarmCritiqueVerdict,
  type SwarmEventInfo,
  type SwarmHypothesisInfo,
  type SwarmHypothesisStatus,
  type SwarmInfo,
  type SwarmLedgerInfo,
  type SwarmMessageInfo,
  type SwarmPhase,
  type SwarmPostInfo,
  type SwarmPostKind,
  type SwarmProgressEntry,
  type SwarmRole,
  type SwarmStatus,
  type SwarmTaskInfo,
  type SwarmTaskKind,
  type SwarmTaskStatus,
} from "../../shared/swarm.js";

type Row = Record<string, unknown>;

const all = <T = Row>(sql: string, params: unknown[] = []) =>
  db.swarmQueryAll<T>(sql, params);
const run = (sql: string, params: unknown[] = []) => db.swarmQueryRun(sql, params);
const one = <T = Row>(sql: string, params: unknown[] = []): T | undefined =>
  all<T>(sql, params)[0];

export function newSwarmId(prefix: string): string {
  return `${prefix}_${nanoid(12)}`;
}

function n(v: unknown, fallback = 0): number {
  if (v === null || v === undefined || v === "") return fallback;
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : fallback;
}

function nn(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : null;
}

function s(v: unknown): string {
  return v === null || v === undefined ? "" : String(v);
}

function sn(v: unknown): string | null {
  return v === null || v === undefined || v === "" ? null : String(v);
}

function jsonList(v: unknown): string[] {
  if (typeof v !== "string" || !v) return [];
  try {
    const parsed = JSON.parse(v);
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Swarms
// ---------------------------------------------------------------------------

export interface SwarmRow extends SwarmInfo {
  idleOrchestratorCycles: number;
  budgetWarned: boolean;
  leaseOwner: string | null;
  leaseUntil: number | null;
}

function toSwarm(r: Row): SwarmRow {
  const status = isSwarmStatus(r.status) ? r.status : "draft";
  return {
    id: s(r.id),
    orgId: sn(r.org_id),
    creatorId: s(r.creator_id),
    title: s(r.title),
    goal: s(r.goal),
    status,
    phase: r.phase === "build" ? "build" : "research",
    repoUrl: sn(r.repo_url),
    startingRef: s(r.starting_ref) || "main",
    modelId: s(r.model_id) || "auto",
    budgetUsd: n(r.budget_usd),
    spentUsd: n(r.spent_usd),
    tokensUsed: n(r.tokens_used),
    deadlineAt: nn(r.deadline_at),
    maxWorkers: n(r.max_workers, 5),
    maxRunning: n(r.max_running, 3),
    maxCycles: n(r.max_cycles, 200),
    cyclesDone: n(r.cycles_done),
    stallCount: n(r.stall_count),
    stopReason: sn(r.stop_reason),
    approvalNote: sn(r.approval_note),
    createdAt: n(r.created_at),
    updatedAt: n(r.updated_at),
    startedAt: nn(r.started_at),
    finishedAt: nn(r.finished_at),
    idleOrchestratorCycles: n(r.idle_orchestrator_cycles),
    budgetWarned: n(r.budget_warned) === 1,
    leaseOwner: sn(r.lease_owner),
    leaseUntil: nn(r.lease_until),
  };
}

export interface CreateSwarmInput {
  orgId?: string | null;
  creatorId: string;
  title: string;
  goal: string;
  status: SwarmStatus;
  repoUrl?: string | null;
  startingRef?: string;
  modelId?: string;
  budgetUsd: number;
  deadlineAt: number | null;
  maxWorkers: number;
  maxRunning: number;
  maxCycles: number;
}

export function createSwarm(input: CreateSwarmInput): SwarmRow {
  const id = newSwarmId("swm");
  const now = Date.now();
  run(
    `INSERT INTO swarms (
      id, org_id, creator_id, title, goal, status, phase, repo_url, starting_ref, model_id,
      budget_usd, deadline_at, max_workers, max_running, max_cycles, created_at, updated_at, started_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'research', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.orgId?.trim() || null,
      input.creatorId,
      input.title,
      input.goal,
      input.status,
      input.repoUrl?.trim() || null,
      input.startingRef?.trim() || "main",
      input.modelId?.trim() || "auto",
      input.budgetUsd,
      input.deadlineAt,
      input.maxWorkers,
      input.maxRunning,
      input.maxCycles,
      now,
      now,
      input.status === "draft" ? null : now,
    ],
  );
  return getSwarm(id)!;
}

export function getSwarm(id: string): SwarmRow | undefined {
  const r = one(`SELECT * FROM swarms WHERE id = ?`, [id]);
  return r ? toSwarm(r) : undefined;
}

export function listPersonalSwarms(userId: string): SwarmRow[] {
  return all(
    `SELECT * FROM swarms WHERE creator_id = ? AND (org_id IS NULL OR org_id = '') ORDER BY updated_at DESC`,
    [userId],
  ).map(toSwarm);
}

export function listOrgSwarms(orgId: string): SwarmRow[] {
  return all(`SELECT * FROM swarms WHERE org_id = ? ORDER BY updated_at DESC`, [orgId]).map(
    toSwarm,
  );
}

export function listRunnableSwarms(): SwarmRow[] {
  return all(
    `SELECT * FROM swarms WHERE status IN ('planning', 'researching', 'building') ORDER BY updated_at ASC`,
  ).map(toSwarm);
}

export function listSwarmsByStatus(statuses: SwarmStatus[]): SwarmRow[] {
  if (!statuses.length) return [];
  return all(
    `SELECT * FROM swarms WHERE status IN (${statuses.map(() => "?").join(", ")})`,
    statuses,
  ).map(toSwarm);
}

const SWARM_COLUMNS: Record<string, string> = {
  title: "title",
  goal: "goal",
  status: "status",
  phase: "phase",
  repoUrl: "repo_url",
  startingRef: "starting_ref",
  modelId: "model_id",
  budgetUsd: "budget_usd",
  spentUsd: "spent_usd",
  tokensUsed: "tokens_used",
  deadlineAt: "deadline_at",
  maxWorkers: "max_workers",
  maxRunning: "max_running",
  maxCycles: "max_cycles",
  cyclesDone: "cycles_done",
  stallCount: "stall_count",
  idleOrchestratorCycles: "idle_orchestrator_cycles",
  budgetWarned: "budget_warned",
  stopReason: "stop_reason",
  approvalNote: "approval_note",
  startedAt: "started_at",
  finishedAt: "finished_at",
};

export type SwarmPatch = Partial<{
  title: string;
  goal: string;
  status: SwarmStatus;
  phase: SwarmPhase;
  repoUrl: string | null;
  startingRef: string;
  modelId: string;
  budgetUsd: number;
  spentUsd: number;
  tokensUsed: number;
  deadlineAt: number | null;
  maxWorkers: number;
  maxRunning: number;
  maxCycles: number;
  cyclesDone: number;
  stallCount: number;
  idleOrchestratorCycles: number;
  budgetWarned: boolean;
  stopReason: string | null;
  approvalNote: string | null;
  startedAt: number | null;
  finishedAt: number | null;
}>;

function buildSet(
  patch: Record<string, unknown>,
  columns: Record<string, string>,
): { sql: string; values: unknown[] } {
  const parts: string[] = [];
  const values: unknown[] = [];
  for (const [key, value] of Object.entries(patch)) {
    const col = columns[key];
    if (!col || value === undefined) continue;
    parts.push(`${col} = ?`);
    values.push(typeof value === "boolean" ? (value ? 1 : 0) : value);
  }
  return { sql: parts.join(", "), values };
}

export function updateSwarm(id: string, patch: SwarmPatch): SwarmRow | undefined {
  const set = buildSet(patch, SWARM_COLUMNS);
  if (!set.sql) return getSwarm(id);
  run(`UPDATE swarms SET ${set.sql}, updated_at = ? WHERE id = ?`, [
    ...set.values,
    Date.now(),
    id,
  ]);
  return getSwarm(id);
}

export function incrementSwarmCounters(
  id: string,
  delta: { cyclesDone?: number; idleOrchestratorCycles?: number; stallCount?: number },
): void {
  run(
    `UPDATE swarms SET cycles_done = cycles_done + ?, idle_orchestrator_cycles = idle_orchestrator_cycles + ?,
      stall_count = stall_count + ?, updated_at = ? WHERE id = ?`,
    [
      delta.cyclesDone ?? 0,
      delta.idleOrchestratorCycles ?? 0,
      delta.stallCount ?? 0,
      Date.now(),
      id,
    ],
  );
}

export function deleteSwarm(id: string): boolean {
  for (const table of [
    "swarm_messages",
    "swarm_events",
    "swarm_artifacts",
    "swarm_matches",
    "swarm_critiques",
    "swarm_hypotheses",
    "swarm_ledger_revisions",
    "swarm_ledger",
    "swarm_posts",
    "swarm_tasks",
    "swarm_agents",
  ]) {
    run(`DELETE FROM ${table} WHERE swarm_id = ?`, [id]);
  }
  return run(`DELETE FROM swarms WHERE id = ?`, [id]) > 0;
}

/** Lease a swarm to one runner process. Returns true when this owner holds it. */
export function claimSwarmLease(
  id: string,
  owner: string,
  now: number,
  until: number,
): boolean {
  run(
    `UPDATE swarms SET lease_owner = ?, lease_until = ?
     WHERE id = ? AND (lease_owner IS NULL OR lease_owner = ? OR lease_until IS NULL OR lease_until < ?)`,
    [owner, until, id, owner, now],
  );
  const row = one<{ lease_owner: string | null }>(`SELECT lease_owner FROM swarms WHERE id = ?`, [
    id,
  ]);
  return row?.lease_owner === owner;
}

export function releaseSwarmLease(id: string, owner: string): void {
  run(`UPDATE swarms SET lease_owner = NULL, lease_until = NULL WHERE id = ? AND lease_owner = ?`, [
    id,
    owner,
  ]);
}

export function recomputeSwarmSpend(id: string): { spentUsd: number; tokensUsed: number } {
  const r = one(
    `SELECT COALESCE(SUM(spent_usd), 0) AS usd, COALESCE(SUM(tokens_used), 0) AS tokens
     FROM swarm_agents WHERE swarm_id = ?`,
    [id],
  );
  const spentUsd = Math.round(n(r?.usd) * 10_000) / 10_000;
  const tokensUsed = n(r?.tokens);
  run(`UPDATE swarms SET spent_usd = ?, tokens_used = ?, updated_at = ? WHERE id = ?`, [
    spentUsd,
    tokensUsed,
    Date.now(),
    id,
  ]);
  return { spentUsd, tokensUsed };
}

// ---------------------------------------------------------------------------
// Agents
// ---------------------------------------------------------------------------

export interface SwarmAgentRow extends SwarmAgentInfo {
  notesMd: string;
  tokenHash: string | null;
  tokenExpiresAt: number | null;
  consecutiveErrors: number;
  spawnedBy: string | null;
}

function toAgent(r: Row): SwarmAgentRow {
  const status = s(r.status);
  return {
    id: s(r.id),
    swarmId: s(r.swarm_id),
    role: isSwarmRole(r.role) ? r.role : "researcher",
    label: s(r.label),
    brief: s(r.brief),
    status: (["idle", "running", "retired", "error"].includes(status)
      ? status
      : "idle") as SwarmAgentStatus,
    cursorAgentId: sn(r.cursor_agent_id),
    hasRepo: n(r.has_repo) === 1,
    branch: sn(r.branch),
    currentTaskId: sn(r.current_task_id),
    cycles: n(r.cycles),
    spentUsd: n(r.spent_usd),
    tokensUsed: n(r.tokens_used),
    lastCycleAt: nn(r.last_cycle_at),
    lastBoardCallAt: nn(r.last_board_call_at),
    runStartedAt: nn(r.run_started_at),
    lastError: sn(r.last_error),
    createdAt: n(r.created_at),
    notesMd: s(r.notes_md),
    tokenHash: sn(r.token_hash),
    tokenExpiresAt: nn(r.token_expires_at),
    consecutiveErrors: n(r.consecutive_errors),
    spawnedBy: sn(r.spawned_by),
  };
}

export function createSwarmAgent(input: {
  swarmId: string;
  role: SwarmRole;
  label: string;
  brief: string;
  hasRepo: boolean;
  spawnedBy?: string | null;
}): SwarmAgentRow {
  const id = newSwarmId("sa");
  const now = Date.now();
  run(
    `INSERT INTO swarm_agents (id, swarm_id, role, label, brief, status, has_repo, spawned_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'idle', ?, ?, ?, ?)`,
    [
      id,
      input.swarmId,
      input.role,
      input.label,
      input.brief,
      input.hasRepo ? 1 : 0,
      input.spawnedBy ?? null,
      now,
      now,
    ],
  );
  return getSwarmAgent(id)!;
}

export function getSwarmAgent(id: string): SwarmAgentRow | undefined {
  const r = one(`SELECT * FROM swarm_agents WHERE id = ?`, [id]);
  return r ? toAgent(r) : undefined;
}

export function listSwarmAgents(swarmId: string): SwarmAgentRow[] {
  return all(`SELECT * FROM swarm_agents WHERE swarm_id = ? ORDER BY created_at ASC`, [
    swarmId,
  ]).map(toAgent);
}

export function findSwarmAgentByTokenHash(hash: string): SwarmAgentRow | undefined {
  const r = one(`SELECT * FROM swarm_agents WHERE token_hash = ?`, [hash]);
  return r ? toAgent(r) : undefined;
}

const AGENT_COLUMNS: Record<string, string> = {
  label: "label",
  brief: "brief",
  status: "status",
  cursorAgentId: "cursor_agent_id",
  branch: "branch",
  currentTaskId: "current_task_id",
  cycles: "cycles",
  consecutiveErrors: "consecutive_errors",
  spentUsd: "spent_usd",
  tokensUsed: "tokens_used",
  notesMd: "notes_md",
  tokenHash: "token_hash",
  tokenExpiresAt: "token_expires_at",
  lastCycleAt: "last_cycle_at",
  lastBoardCallAt: "last_board_call_at",
  runStartedAt: "run_started_at",
  lastError: "last_error",
};

export type SwarmAgentPatch = Partial<{
  label: string;
  brief: string;
  status: SwarmAgentStatus;
  cursorAgentId: string | null;
  branch: string | null;
  currentTaskId: string | null;
  cycles: number;
  consecutiveErrors: number;
  spentUsd: number;
  tokensUsed: number;
  notesMd: string;
  tokenHash: string | null;
  tokenExpiresAt: number | null;
  lastCycleAt: number | null;
  lastBoardCallAt: number | null;
  runStartedAt: number | null;
  lastError: string | null;
}>;

export function updateSwarmAgent(id: string, patch: SwarmAgentPatch): SwarmAgentRow | undefined {
  const set = buildSet(patch, AGENT_COLUMNS);
  if (!set.sql) return getSwarmAgent(id);
  run(`UPDATE swarm_agents SET ${set.sql}, updated_at = ? WHERE id = ?`, [
    ...set.values,
    Date.now(),
    id,
  ]);
  return getSwarmAgent(id);
}

export function touchSwarmAgentBoardCall(id: string, at = Date.now()): void {
  run(`UPDATE swarm_agents SET last_board_call_at = ? WHERE id = ?`, [at, id]);
}

/** Crash recovery: anything left `running` by a dead process goes back to idle. */
export function resetRunningSwarmAgents(swarmId: string): number {
  return run(
    `UPDATE swarm_agents SET status = 'idle', run_started_at = NULL, updated_at = ?
     WHERE swarm_id = ? AND status = 'running'`,
    [Date.now(), swarmId],
  );
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

function toTask(r: Row): SwarmTaskInfo {
  return {
    id: s(r.id),
    swarmId: s(r.swarm_id),
    title: s(r.title),
    spec: s(r.spec),
    kind: isSwarmTaskKind(r.kind) ? r.kind : "research",
    status: isSwarmTaskStatus(r.status) ? r.status : "pending",
    ownerAgentId: sn(r.owner_agent_id),
    roleHint: isSwarmRole(r.role_hint) ? r.role_hint : null,
    blockedBy: jsonList(r.blocked_by_json),
    priority: n(r.priority, 2),
    resultMd: sn(r.result_md),
    attempts: n(r.attempts),
    createdAt: n(r.created_at),
    updatedAt: n(r.updated_at),
    completedAt: nn(r.completed_at),
  };
}

export function createSwarmTask(input: {
  swarmId: string;
  title: string;
  spec: string;
  kind: SwarmTaskKind;
  roleHint?: SwarmRole | null;
  blockedBy?: string[];
  priority?: number;
  createdBy?: string | null;
}): SwarmTaskInfo {
  const id = newSwarmId("st");
  const now = Date.now();
  run(
    `INSERT INTO swarm_tasks (id, swarm_id, title, spec, kind, status, role_hint, blocked_by_json, priority, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.swarmId,
      input.title,
      input.spec,
      input.kind,
      input.roleHint ?? null,
      JSON.stringify(input.blockedBy ?? []),
      input.priority ?? 2,
      input.createdBy ?? null,
      now,
      now,
    ],
  );
  return getSwarmTask(id)!;
}

export function getSwarmTask(id: string): SwarmTaskInfo | undefined {
  const r = one(`SELECT * FROM swarm_tasks WHERE id = ?`, [id]);
  return r ? toTask(r) : undefined;
}

export function listSwarmTasks(swarmId: string): SwarmTaskInfo[] {
  return all(
    `SELECT * FROM swarm_tasks WHERE swarm_id = ? ORDER BY priority ASC, created_at ASC`,
    [swarmId],
  ).map(toTask);
}

/** Atomic pending → claimed. Returns the task only when this agent won it. */
export function claimSwarmTask(taskId: string, agentId: string): SwarmTaskInfo | undefined {
  run(
    `UPDATE swarm_tasks SET status = 'claimed', owner_agent_id = ?, attempts = attempts + 1, updated_at = ?
     WHERE id = ? AND status = 'pending'`,
    [agentId, Date.now(), taskId],
  );
  const task = getSwarmTask(taskId);
  return task?.status === "claimed" && task.ownerAgentId === agentId ? task : undefined;
}

export function updateSwarmTask(
  id: string,
  patch: Partial<{
    title: string;
    spec: string;
    status: SwarmTaskStatus;
    ownerAgentId: string | null;
    priority: number;
    resultMd: string | null;
    completedAt: number | null;
  }>,
): SwarmTaskInfo | undefined {
  const set = buildSet(patch, {
    title: "title",
    spec: "spec",
    status: "status",
    ownerAgentId: "owner_agent_id",
    priority: "priority",
    resultMd: "result_md",
    completedAt: "completed_at",
  });
  if (!set.sql) return getSwarmTask(id);
  run(`UPDATE swarm_tasks SET ${set.sql}, updated_at = ? WHERE id = ?`, [
    ...set.values,
    Date.now(),
    id,
  ]);
  return getSwarmTask(id);
}

/** Retired/crashed owners give their claimed tasks back to the pool. */
export function releaseSwarmTasksFor(agentId: string): number {
  return run(
    `UPDATE swarm_tasks SET status = 'pending', owner_agent_id = NULL, updated_at = ?
     WHERE owner_agent_id = ? AND status = 'claimed'`,
    [Date.now(), agentId],
  );
}

// ---------------------------------------------------------------------------
// Board posts
// ---------------------------------------------------------------------------

function toPost(r: Row): SwarmPostInfo {
  const role = s(r.author_role);
  return {
    id: s(r.id),
    swarmId: s(r.swarm_id),
    authorAgentId: sn(r.author_agent_id),
    authorUserId: sn(r.author_user_id),
    authorLabel: s(r.author_label),
    authorRole: isSwarmRole(role) || role === "human" || role === "system" ? (role as SwarmPostInfo["authorRole"]) : "system",
    channel: s(r.channel),
    kind: isSwarmPostKind(r.kind) ? r.kind : "progress",
    bodyMd: s(r.body_md),
    refs: jsonList(r.refs_json),
    mentions: jsonList(r.mentions_json),
    createdAt: n(r.created_at),
  };
}

export function insertSwarmPost(input: {
  swarmId: string;
  authorAgentId?: string | null;
  authorUserId?: string | null;
  authorLabel: string;
  authorRole: SwarmPostInfo["authorRole"];
  channel: string;
  kind: SwarmPostKind;
  bodyMd: string;
  refs?: string[];
  mentions?: string[];
}): SwarmPostInfo {
  const id = newSwarmId("sp");
  run(
    `INSERT INTO swarm_posts (id, swarm_id, author_agent_id, author_user_id, author_label, author_role, channel, kind, body_md, refs_json, mentions_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.swarmId,
      input.authorAgentId ?? null,
      input.authorUserId ?? null,
      input.authorLabel,
      input.authorRole,
      input.channel,
      input.kind,
      input.bodyMd,
      JSON.stringify(input.refs ?? []),
      JSON.stringify(input.mentions ?? []),
      Date.now(),
    ],
  );
  return toPost(one(`SELECT * FROM swarm_posts WHERE id = ?`, [id])!);
}

export function listSwarmPosts(
  swarmId: string,
  opts: { channel?: string; since?: number; limit?: number } = {},
): SwarmPostInfo[] {
  const where: string[] = ["swarm_id = ?"];
  const params: unknown[] = [swarmId];
  if (opts.channel) {
    where.push("channel = ?");
    params.push(opts.channel);
  }
  if (opts.since) {
    where.push("created_at > ?");
    params.push(opts.since);
  }
  const limit = Math.min(Math.max(opts.limit ?? 200, 1), 1000);
  const rows = all(
    `SELECT * FROM swarm_posts WHERE ${where.join(" AND ")} ORDER BY created_at DESC LIMIT ${limit}`,
    params,
  ).map(toPost);
  return rows.reverse();
}

export function countSwarmPostsSince(
  swarmId: string,
  since: number,
  excludeAgentId?: string,
): number {
  const r = one(
    `SELECT COUNT(*) AS c FROM swarm_posts WHERE swarm_id = ? AND created_at > ?
     AND (author_agent_id IS NULL OR author_agent_id <> ?)`,
    [swarmId, since, excludeAgentId ?? ""],
  );
  return n(r?.c);
}

export function countSwarmMentionsSince(
  swarmId: string,
  agentId: string,
  label: string,
  since: number,
): number {
  const r = one(
    `SELECT COUNT(*) AS c FROM swarm_posts WHERE swarm_id = ? AND created_at > ?
     AND (mentions_json LIKE ? OR mentions_json LIKE ?)`,
    [swarmId, since, `%"${agentId}"%`, `%"${label.toLowerCase()}"%`],
  );
  return n(r?.c);
}

// ---------------------------------------------------------------------------
// Ledger
// ---------------------------------------------------------------------------

function parseProgress(v: unknown): SwarmProgressEntry | null {
  if (typeof v !== "string" || !v) return null;
  try {
    const p = JSON.parse(v) as Partial<SwarmProgressEntry>;
    return {
      isRequestSatisfied: Boolean(p.isRequestSatisfied),
      isProgressBeingMade: Boolean(p.isProgressBeingMade),
      isInLoop: Boolean(p.isInLoop),
      nextFocus: s(p.nextFocus),
      reason: s(p.reason),
    };
  } catch {
    return null;
  }
}

function toLedger(r: Row): SwarmLedgerInfo {
  return {
    swarmId: s(r.swarm_id),
    revision: n(r.revision),
    factsMd: s(r.facts_md),
    guessesMd: s(r.guesses_md),
    planMd: s(r.plan_md),
    openQuestionsMd: s(r.open_questions_md),
    progress: parseProgress(r.progress_json),
    updatedBy: sn(r.updated_by),
    updatedAt: n(r.updated_at),
  };
}

export function getSwarmLedger(swarmId: string): SwarmLedgerInfo | null {
  const r = one(`SELECT * FROM swarm_ledger WHERE swarm_id = ?`, [swarmId]);
  return r ? toLedger(r) : null;
}

export function saveSwarmLedger(
  swarmId: string,
  patch: Partial<{
    factsMd: string;
    guessesMd: string;
    planMd: string;
    openQuestionsMd: string;
    progress: SwarmProgressEntry | null;
  }>,
  updatedBy: string,
): SwarmLedgerInfo {
  const current = getSwarmLedger(swarmId);
  const now = Date.now();
  const next = {
    factsMd: patch.factsMd ?? current?.factsMd ?? "",
    guessesMd: patch.guessesMd ?? current?.guessesMd ?? "",
    planMd: patch.planMd ?? current?.planMd ?? "",
    openQuestionsMd: patch.openQuestionsMd ?? current?.openQuestionsMd ?? "",
    progress: patch.progress !== undefined ? patch.progress : current?.progress ?? null,
    revision: (current?.revision ?? 0) + 1,
  };
  const progressJson = next.progress ? JSON.stringify(next.progress) : null;
  if (current) {
    run(
      `UPDATE swarm_ledger SET revision = ?, facts_md = ?, guesses_md = ?, plan_md = ?, open_questions_md = ?,
        progress_json = ?, updated_by = ?, updated_at = ? WHERE swarm_id = ?`,
      [
        next.revision,
        next.factsMd,
        next.guessesMd,
        next.planMd,
        next.openQuestionsMd,
        progressJson,
        updatedBy,
        now,
        swarmId,
      ],
    );
  } else {
    run(
      `INSERT INTO swarm_ledger (swarm_id, revision, facts_md, guesses_md, plan_md, open_questions_md, progress_json, updated_by, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        swarmId,
        next.revision,
        next.factsMd,
        next.guessesMd,
        next.planMd,
        next.openQuestionsMd,
        progressJson,
        updatedBy,
        now,
      ],
    );
  }
  run(
    `INSERT INTO swarm_ledger_revisions (swarm_id, revision, facts_md, guesses_md, plan_md, open_questions_md, progress_json, updated_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      swarmId,
      next.revision,
      next.factsMd,
      next.guessesMd,
      next.planMd,
      next.openQuestionsMd,
      progressJson,
      updatedBy,
      now,
    ],
  );
  return getSwarmLedger(swarmId)!;
}

export function listSwarmLedgerRevisions(swarmId: string, limit = 50): SwarmLedgerInfo[] {
  return all(
    `SELECT *, created_at AS updated_at FROM swarm_ledger_revisions WHERE swarm_id = ? ORDER BY revision DESC LIMIT ${Math.min(limit, 200)}`,
    [swarmId],
  ).map(toLedger);
}

// ---------------------------------------------------------------------------
// Hypotheses, critiques, tournament matches
// ---------------------------------------------------------------------------

function toHypothesis(r: Row): SwarmHypothesisInfo {
  return {
    id: s(r.id),
    swarmId: s(r.swarm_id),
    title: s(r.title),
    claimMd: s(r.claim_md),
    evidenceMd: s(r.evidence_md),
    parentIds: jsonList(r.parent_ids_json),
    elo: n(r.elo, SWARM_ELO_START),
    matches: n(r.matches),
    wins: n(r.wins),
    critiques: n(r.critiques),
    status: isSwarmHypothesisStatus(r.status) ? r.status : "proposed",
    authorAgentId: sn(r.author_agent_id),
    createdAt: n(r.created_at),
    updatedAt: n(r.updated_at),
  };
}

export function createSwarmHypothesis(input: {
  swarmId: string;
  title: string;
  claimMd: string;
  evidenceMd: string;
  parentIds?: string[];
  authorAgentId?: string | null;
}): SwarmHypothesisInfo {
  const id = newSwarmId("sh");
  const now = Date.now();
  run(
    `INSERT INTO swarm_hypotheses (id, swarm_id, title, claim_md, evidence_md, parent_ids_json, elo, author_agent_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.swarmId,
      input.title,
      input.claimMd,
      input.evidenceMd,
      JSON.stringify(input.parentIds ?? []),
      SWARM_ELO_START,
      input.authorAgentId ?? null,
      now,
      now,
    ],
  );
  return getSwarmHypothesis(id)!;
}

export function getSwarmHypothesis(id: string): SwarmHypothesisInfo | undefined {
  const r = one(`SELECT * FROM swarm_hypotheses WHERE id = ?`, [id]);
  return r ? toHypothesis(r) : undefined;
}

export function listSwarmHypotheses(swarmId: string): SwarmHypothesisInfo[] {
  return all(`SELECT * FROM swarm_hypotheses WHERE swarm_id = ? ORDER BY elo DESC, created_at ASC`, [
    swarmId,
  ]).map(toHypothesis);
}

export function updateSwarmHypothesis(
  id: string,
  patch: Partial<{
    elo: number;
    matches: number;
    wins: number;
    critiques: number;
    status: SwarmHypothesisStatus;
  }>,
): SwarmHypothesisInfo | undefined {
  const set = buildSet(patch, {
    elo: "elo",
    matches: "matches",
    wins: "wins",
    critiques: "critiques",
    status: "status",
  });
  if (!set.sql) return getSwarmHypothesis(id);
  run(`UPDATE swarm_hypotheses SET ${set.sql}, updated_at = ? WHERE id = ?`, [
    ...set.values,
    Date.now(),
    id,
  ]);
  return getSwarmHypothesis(id);
}

function toCritique(r: Row): SwarmCritiqueInfo {
  return {
    id: s(r.id),
    hypothesisId: s(r.hypothesis_id),
    authorAgentId: sn(r.author_agent_id),
    verdict: isSwarmCritiqueVerdict(r.verdict) ? r.verdict : "needs_evidence",
    score: n(r.score),
    bodyMd: s(r.body_md),
    createdAt: n(r.created_at),
  };
}

export function insertSwarmCritique(input: {
  swarmId: string;
  hypothesisId: string;
  authorAgentId: string | null;
  verdict: SwarmCritiqueVerdict;
  score: number;
  bodyMd: string;
}): SwarmCritiqueInfo {
  const id = newSwarmId("sc");
  run(
    `INSERT INTO swarm_critiques (id, swarm_id, hypothesis_id, author_agent_id, verdict, score, body_md, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.swarmId,
      input.hypothesisId,
      input.authorAgentId,
      input.verdict,
      input.score,
      input.bodyMd,
      Date.now(),
    ],
  );
  run(`UPDATE swarm_hypotheses SET critiques = critiques + 1, updated_at = ? WHERE id = ?`, [
    Date.now(),
    input.hypothesisId,
  ]);
  return toCritique(one(`SELECT * FROM swarm_critiques WHERE id = ?`, [id])!);
}

export function listSwarmCritiques(swarmId: string, limit = 300): SwarmCritiqueInfo[] {
  return all(
    `SELECT * FROM swarm_critiques WHERE swarm_id = ? ORDER BY created_at DESC LIMIT ${Math.min(limit, 1000)}`,
    [swarmId],
  ).map(toCritique);
}

export function insertSwarmMatch(input: {
  swarmId: string;
  hypothesisA: string;
  hypothesisB: string;
  winner: "a" | "b" | "draw";
  rationale: string;
  judgeAgentId: string | null;
}): string {
  const id = newSwarmId("smt");
  run(
    `INSERT INTO swarm_matches (id, swarm_id, hypothesis_a, hypothesis_b, winner, rationale, judge_agent_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.swarmId,
      input.hypothesisA,
      input.hypothesisB,
      input.winner,
      input.rationale,
      input.judgeAgentId,
      Date.now(),
    ],
  );
  return id;
}

export function countSwarmMatchesBetween(swarmId: string, a: string, b: string): number {
  const r = one(
    `SELECT COUNT(*) AS c FROM swarm_matches WHERE swarm_id = ?
     AND ((hypothesis_a = ? AND hypothesis_b = ?) OR (hypothesis_a = ? AND hypothesis_b = ?))`,
    [swarmId, a, b, b, a],
  );
  return n(r?.c);
}

// ---------------------------------------------------------------------------
// Artifacts
// ---------------------------------------------------------------------------

function toArtifact(r: Row): SwarmArtifactInfo {
  return {
    id: s(r.id),
    swarmId: s(r.swarm_id),
    agentId: sn(r.agent_id),
    kind: isSwarmArtifactKind(r.kind) ? r.kind : "other",
    name: s(r.name),
    size: n(r.size),
    createdAt: n(r.created_at),
    updatedAt: n(r.updated_at),
  };
}

export function upsertSwarmArtifact(input: {
  swarmId: string;
  agentId: string | null;
  kind: SwarmArtifactKind;
  name: string;
  content: string;
}): SwarmArtifactInfo {
  const now = Date.now();
  const existing = one(`SELECT id FROM swarm_artifacts WHERE swarm_id = ? AND name = ?`, [
    input.swarmId,
    input.name,
  ]);
  const size = Buffer.byteLength(input.content, "utf8");
  if (existing) {
    run(
      `UPDATE swarm_artifacts SET agent_id = ?, kind = ?, content = ?, size = ?, updated_at = ? WHERE id = ?`,
      [input.agentId, input.kind, input.content, size, now, s(existing.id)],
    );
    return getSwarmArtifactMeta(s(existing.id))!;
  }
  const id = newSwarmId("sar");
  run(
    `INSERT INTO swarm_artifacts (id, swarm_id, agent_id, kind, name, content, size, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, input.swarmId, input.agentId, input.kind, input.name, input.content, size, now, now],
  );
  return getSwarmArtifactMeta(id)!;
}

export function getSwarmArtifactMeta(id: string): SwarmArtifactInfo | undefined {
  const r = one(
    `SELECT id, swarm_id, agent_id, kind, name, size, created_at, updated_at FROM swarm_artifacts WHERE id = ?`,
    [id],
  );
  return r ? toArtifact(r) : undefined;
}

export function getSwarmArtifactContent(
  swarmId: string,
  idOrName: string,
): (SwarmArtifactInfo & { content: string }) | undefined {
  const r = one(
    `SELECT * FROM swarm_artifacts WHERE swarm_id = ? AND (id = ? OR name = ?)`,
    [swarmId, idOrName, idOrName],
  );
  return r ? { ...toArtifact(r), content: s(r.content) } : undefined;
}

export function listSwarmArtifacts(swarmId: string): SwarmArtifactInfo[] {
  return all(
    `SELECT id, swarm_id, agent_id, kind, name, size, created_at, updated_at FROM swarm_artifacts
     WHERE swarm_id = ? ORDER BY updated_at DESC`,
    [swarmId],
  ).map(toArtifact);
}

// ---------------------------------------------------------------------------
// Events + transcripts
// ---------------------------------------------------------------------------

function toEvent(r: Row): SwarmEventInfo {
  return {
    id: s(r.id),
    swarmId: s(r.swarm_id),
    agentId: sn(r.agent_id),
    kind: s(r.kind),
    message: s(r.message),
    createdAt: n(r.created_at),
  };
}

export function insertSwarmEvent(input: {
  swarmId: string;
  agentId?: string | null;
  kind: string;
  message?: string;
  meta?: Record<string, unknown>;
}): SwarmEventInfo {
  const id = newSwarmId("sev");
  run(
    `INSERT INTO swarm_events (id, swarm_id, agent_id, kind, message, meta_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.swarmId,
      input.agentId ?? null,
      input.kind,
      input.message ?? "",
      input.meta ? JSON.stringify(input.meta) : null,
      Date.now(),
    ],
  );
  return toEvent(one(`SELECT * FROM swarm_events WHERE id = ?`, [id])!);
}

export function listSwarmEvents(swarmId: string, limit = 80): SwarmEventInfo[] {
  return all(
    `SELECT * FROM swarm_events WHERE swarm_id = ? ORDER BY created_at DESC LIMIT ${Math.min(limit, 500)}`,
    [swarmId],
  ).map(toEvent);
}

export function latestSwarmEvent(
  swarmId: string,
  kind: string,
): (SwarmEventInfo & { meta: Record<string, unknown> | null }) | undefined {
  const r = one(
    `SELECT * FROM swarm_events WHERE swarm_id = ? AND kind = ? ORDER BY created_at DESC LIMIT 1`,
    [swarmId, kind],
  );
  if (!r) return undefined;
  let meta: Record<string, unknown> | null = null;
  try {
    meta = r.meta_json ? (JSON.parse(String(r.meta_json)) as Record<string, unknown>) : null;
  } catch {
    meta = null;
  }
  return { ...toEvent(r), meta };
}

function toMessage(r: Row): SwarmMessageInfo {
  const role = s(r.role);
  const status = s(r.status);
  return {
    id: s(r.id),
    agentId: s(r.agent_id),
    cycle: n(r.cycle),
    role: (["user", "assistant", "tool", "error"].includes(role) ? role : "assistant") as SwarmMessageInfo["role"],
    content: s(r.content),
    toolName: sn(r.tool_name),
    status: (["running", "done", "error"].includes(status) ? status : null) as SwarmMessageInfo["status"],
    ts: n(r.ts),
  };
}

export function upsertSwarmMessages(swarmId: string, messages: SwarmMessageInfo[]): void {
  for (const m of messages) {
    run(
      `INSERT INTO swarm_messages (id, swarm_id, agent_id, cycle, role, content, tool_name, status, ts)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET content = excluded.content, status = excluded.status, tool_name = excluded.tool_name`,
      [m.id, swarmId, m.agentId, m.cycle, m.role, m.content, m.toolName, m.status, m.ts],
    );
  }
}

export function listSwarmMessages(agentId: string, limit = 400): SwarmMessageInfo[] {
  return all(
    `SELECT * FROM swarm_messages WHERE agent_id = ? ORDER BY ts DESC LIMIT ${Math.min(limit, 2000)}`,
    [agentId],
  )
    .map(toMessage)
    .reverse();
}
