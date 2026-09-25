import * as db from "../db.js";
import {
  MAX_SWARM_GOAL,
  MAX_SWARM_POST,
  MAX_SWARM_TITLE,
  canEditSwarm,
  canPauseSwarm,
  canResumeSwarm,
  canStartSwarm,
  canStopSwarm,
  clampSwarmBudgetUsd,
  clampSwarmDeadlineHours,
  clampSwarmMaxCycles,
  clampSwarmMaxRunning,
  clampSwarmMaxWorkers,
  extractMentions,
  isActiveSwarmStatus,
  swarmAgentUsesRepo,
  swarmTitleFromGoal,
  type SwarmInfo,
  type SwarmSnapshot,
} from "../../shared/swarm.js";
import { sanitizeMemoryText } from "../../shared/roomContext.js";
import { parseGithubHttpsRepo } from "../../shared/issues.js";
import { log } from "../logger.js";
import * as store from "./store.js";
import { swarmRunner } from "./runner.js";
import { swarmSignals } from "./signals.js";

export class SwarmServiceError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

export function orgRoleFor(orgId: string | null, userId: string): string | null {
  if (!orgId) return null;
  return db.getOrganizationMember(orgId, userId)?.role ?? null;
}

export function actorCanViewSwarm(swarm: store.SwarmRow, userId: string): boolean {
  if (swarm.creatorId === userId) return true;
  return Boolean(swarm.orgId && db.isOrganizationMember(swarm.orgId, userId));
}

export function actorCanEditSwarm(swarm: store.SwarmRow, userId: string): boolean {
  return canEditSwarm(swarm, { userId, orgRole: orgRoleFor(swarm.orgId, userId) });
}

export function toSwarmInfo(swarm: store.SwarmRow, agents?: store.SwarmAgentRow[]): SwarmInfo {
  const list = agents ?? store.listSwarmAgents(swarm.id);
  const {
    idleOrchestratorCycles: _idle,
    budgetWarned: _warned,
    leaseOwner: _owner,
    leaseUntil: _until,
    ...info
  } = swarm;
  return {
    ...info,
    creatorName: db.getUserById(swarm.creatorId)?.name ?? null,
    runningAgents: list.filter((a) => a.status === "running").length,
    totalAgents: list.filter((a) => a.status !== "retired").length,
  };
}

function publicAgent(agent: store.SwarmAgentRow) {
  const {
    notesMd: _notes,
    tokenHash: _hash,
    tokenExpiresAt: _exp,
    consecutiveErrors: _errs,
    ...info
  } = agent;
  return info;
}

export function buildSwarmSnapshot(swarm: store.SwarmRow, userId: string): SwarmSnapshot {
  const agents = store.listSwarmAgents(swarm.id);
  return {
    swarm: toSwarmInfo(swarm, agents),
    agents: agents.map(publicAgent),
    tasks: store.listSwarmTasks(swarm.id),
    posts: store.listSwarmPosts(swarm.id, { limit: 250 }),
    hypotheses: store.listSwarmHypotheses(swarm.id),
    critiques: store.listSwarmCritiques(swarm.id, 400),
    ledger: store.getSwarmLedger(swarm.id),
    artifacts: store.listSwarmArtifacts(swarm.id),
    events: store.listSwarmEvents(swarm.id, 120),
    canEdit: actorCanEditSwarm(swarm, userId),
  };
}

export interface CreateSwarmRequest {
  title?: unknown;
  goal?: unknown;
  orgId?: unknown;
  repoUrl?: unknown;
  startingRef?: unknown;
  modelId?: unknown;
  budgetUsd?: unknown;
  deadlineHours?: unknown;
  maxWorkers?: unknown;
  maxRunning?: unknown;
  maxCycles?: unknown;
  autoStart?: unknown;
}

function parseOrgId(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed && trimmed !== "personal" ? trimmed : null;
}

export function createSwarmForUser(userId: string, body: CreateSwarmRequest): store.SwarmRow {
  const goal = sanitizeMemoryText(body.goal, MAX_SWARM_GOAL);
  if (goal.length < 20) {
    throw new SwarmServiceError("Describe the goal in at least a sentence or two (20+ characters)");
  }
  const orgId = parseOrgId(body.orgId);
  if (orgId && !db.isOrganizationMember(orgId, userId)) {
    throw new SwarmServiceError("Organization not found", 404);
  }
  let repoUrl: string | null = null;
  if (typeof body.repoUrl === "string" && body.repoUrl.trim()) {
    repoUrl = parseGithubHttpsRepo(body.repoUrl);
    if (!repoUrl) throw new SwarmServiceError("Repository must be an https://github.com/owner/repo URL");
  }
  const title =
    sanitizeMemoryText(body.title, MAX_SWARM_TITLE) || swarmTitleFromGoal(goal);
  const autoStart = body.autoStart !== false;
  const deadlineHours = clampSwarmDeadlineHours(body.deadlineHours);
  const swarm = store.createSwarm({
    orgId,
    creatorId: userId,
    title,
    goal,
    status: autoStart ? "planning" : "draft",
    repoUrl,
    startingRef:
      typeof body.startingRef === "string" && body.startingRef.trim()
        ? body.startingRef.trim().slice(0, 120)
        : "main",
    modelId:
      typeof body.modelId === "string" && body.modelId.trim() ? body.modelId.trim().slice(0, 80) : "auto",
    budgetUsd: clampSwarmBudgetUsd(body.budgetUsd),
    deadlineAt: autoStart ? Date.now() + deadlineHours * 3_600_000 : null,
    maxWorkers: clampSwarmMaxWorkers(body.maxWorkers),
    maxRunning: clampSwarmMaxRunning(body.maxRunning),
    maxCycles: clampSwarmMaxCycles(body.maxCycles),
  });
  store.createSwarmAgent({
    swarmId: swarm.id,
    role: "orchestrator",
    label: "orchestrator",
    brief: "",
    hasRepo: swarmAgentUsesRepo({ repoUrl }),
  });
  store.insertSwarmEvent({
    swarmId: swarm.id,
    kind: "created",
    message: autoStart ? "Swarm created and started" : "Swarm created as draft",
    meta: { deadlineHours },
  });
  if (!autoStart) {
    store.saveSwarmLedger(swarm.id, {}, "system");
  }
  log("swarm", "created", { swarmId: swarm.id, orgId: orgId || "personal", autoStart });
  if (autoStart) swarmSignals.kick(swarm.id);
  return store.getSwarm(swarm.id)!;
}

function requireEditable(swarmId: string, userId: string): store.SwarmRow {
  const swarm = store.getSwarm(swarmId);
  if (!swarm || !actorCanViewSwarm(swarm, userId)) throw new SwarmServiceError("Swarm not found", 404);
  if (!actorCanEditSwarm(swarm, userId)) {
    throw new SwarmServiceError("Only the creator or a team admin can change this swarm", 403);
  }
  return swarm;
}

function humanLabel(userId: string): string {
  return db.getUserById(userId)?.name || "Human";
}

function orchestratorOf(swarmId: string): store.SwarmAgentRow | undefined {
  return store.listSwarmAgents(swarmId).find((a) => a.role === "orchestrator");
}

export function startSwarm(swarmId: string, userId: string): store.SwarmRow {
  const swarm = requireEditable(swarmId, userId);
  if (!canStartSwarm(swarm.status)) throw new SwarmServiceError(`Cannot start a ${swarm.status} swarm`, 409);
  const meta = store.latestSwarmEvent(swarm.id, "created")?.meta;
  const hours = clampSwarmDeadlineHours(meta?.deadlineHours);
  const next = store.updateSwarm(swarm.id, {
    status: "planning",
    startedAt: Date.now(),
    deadlineAt: Date.now() + hours * 3_600_000,
    stopReason: null,
  })!;
  store.insertSwarmEvent({ swarmId: swarm.id, kind: "started", message: `Started by ${humanLabel(userId)}` });
  swarmSignals.kick(swarm.id);
  return next;
}

export function pauseSwarm(swarmId: string, userId: string): store.SwarmRow {
  const swarm = requireEditable(swarmId, userId);
  if (!canPauseSwarm(swarm.status)) throw new SwarmServiceError(`Cannot pause a ${swarm.status} swarm`, 409);
  const next = store.updateSwarm(swarm.id, { status: "paused", stopReason: "paused_by_user" })!;
  store.insertSwarmEvent({
    swarmId: swarm.id,
    kind: "paused",
    message: `Paused by ${humanLabel(userId)} — running cycles finish, nothing new starts`,
  });
  return next;
}

function resumeStatus(swarm: store.SwarmRow): "planning" | "researching" | "building" {
  if (swarm.phase === "build") return "building";
  const orchestrator = orchestratorOf(swarm.id);
  return orchestrator && orchestrator.cycles > 0 ? "researching" : "planning";
}

export function resumeSwarm(swarmId: string, userId: string): store.SwarmRow {
  const swarm = requireEditable(swarmId, userId);
  if (!canResumeSwarm(swarm.status)) throw new SwarmServiceError(`Cannot resume a ${swarm.status} swarm`, 409);
  if (swarm.spentUsd >= swarm.budgetUsd) {
    throw new SwarmServiceError("The budget is used up — raise it before resuming", 409);
  }
  if (swarm.deadlineAt !== null && swarm.deadlineAt <= Date.now()) {
    throw new SwarmServiceError("The deadline has passed — extend it before resuming", 409);
  }
  for (const agent of store.listSwarmAgents(swarm.id)) {
    if (agent.status === "error") {
      store.updateSwarmAgent(agent.id, { status: "idle", consecutiveErrors: 0, lastError: null });
    }
  }
  const next = store.updateSwarm(swarm.id, {
    status: resumeStatus(swarm),
    stopReason: null,
    idleOrchestratorCycles: 0,
    stallCount: 0,
  })!;
  store.insertSwarmEvent({ swarmId: swarm.id, kind: "resumed", message: `Resumed by ${humanLabel(userId)}` });
  swarmSignals.kick(swarm.id);
  return next;
}

export async function stopSwarm(swarmId: string, userId: string): Promise<store.SwarmRow> {
  const swarm = requireEditable(swarmId, userId);
  if (!canStopSwarm(swarm.status)) throw new SwarmServiceError(`The swarm is already ${swarm.status}`, 409);
  const next = store.updateSwarm(swarm.id, {
    status: "stopped",
    stopReason: "stopped_by_user",
    finishedAt: Date.now(),
  })!;
  store.insertSwarmEvent({ swarmId: swarm.id, kind: "stopped", message: `Stopped by ${humanLabel(userId)}` });
  await swarmRunner.haltSwarm(swarm.id);
  return next;
}

export function decideBuildApproval(
  swarmId: string,
  userId: string,
  input: { approve: boolean; note?: unknown },
): store.SwarmRow {
  const swarm = requireEditable(swarmId, userId);
  if (swarm.status !== "awaiting_approval") {
    throw new SwarmServiceError("The swarm is not waiting for approval", 409);
  }
  const note = sanitizeMemoryText(input.note, MAX_SWARM_POST);
  const who = humanLabel(userId);
  const orchestrator = orchestratorOf(swarm.id);
  if (input.approve) {
    store.updateSwarm(swarm.id, {
      status: "building",
      phase: "build",
      stallCount: 0,
      approvalNote: note ? `${swarm.approvalNote ?? ""}\n\nApprover note (${who}): ${note}`.trim() : swarm.approvalNote,
    });
  } else {
    store.updateSwarm(swarm.id, { status: "researching", stallCount: 0 });
  }
  store.insertSwarmPost({
    swarmId: swarm.id,
    authorUserId: userId,
    authorLabel: who,
    authorRole: "human",
    channel: "plan",
    kind: "directive",
    bodyMd: input.approve
      ? `**Build phase approved** by ${who}.${note ? `\n\n${note}` : ""}\n\nPlan build tasks, spawn engineers and an integrator, and deliver a pull request.`
      : `**Build phase not approved** by ${who}. Keep researching.${note ? `\n\n${note}` : ""}`,
    mentions: orchestrator ? [orchestrator.id] : [],
  });
  store.insertSwarmEvent({
    swarmId: swarm.id,
    kind: input.approve ? "build_approved" : "build_rejected",
    message: `${input.approve ? "Approved" : "Sent back"} by ${who}`,
  });
  swarmSignals.kick(swarm.id);
  return store.getSwarm(swarm.id)!;
}

export function postHumanDirective(
  swarmId: string,
  userId: string,
  input: { body?: unknown; channel?: unknown },
) {
  const swarm = store.getSwarm(swarmId);
  if (!swarm || !actorCanViewSwarm(swarm, userId)) throw new SwarmServiceError("Swarm not found", 404);
  if (!actorCanEditSwarm(swarm, userId)) {
    throw new SwarmServiceError("Only the creator or a team admin can steer this swarm", 403);
  }
  const body = sanitizeMemoryText(input.body, MAX_SWARM_POST);
  if (!body) throw new SwarmServiceError("Message is required");
  const agents = store.listSwarmAgents(swarm.id);
  const labels = new Set(extractMentions(body));
  const mentions = agents
    .filter((a) => a.status !== "retired" && (labels.has(a.label.toLowerCase()) || a.role === "orchestrator"))
    .map((a) => a.id);
  const toQuestions = input.channel === "questions";
  const post = store.insertSwarmPost({
    swarmId: swarm.id,
    authorUserId: userId,
    authorLabel: humanLabel(userId),
    authorRole: "human",
    channel: toQuestions ? "questions" : "plan",
    kind: toQuestions ? "answer" : "directive",
    bodyMd: body,
    mentions,
  });
  if (swarm.status === "paused" && swarm.stopReason === "needs_input") {
    store.updateSwarm(swarm.id, {
      status: resumeStatus(swarm),
      stopReason: null,
      idleOrchestratorCycles: 0,
    });
    store.insertSwarmEvent({
      swarmId: swarm.id,
      kind: "resumed",
      message: "Resumed after human input",
    });
  }
  swarmSignals.kick(swarm.id);
  return post;
}

export function updateSwarmSettings(
  swarmId: string,
  userId: string,
  body: {
    title?: unknown;
    budgetUsd?: unknown;
    deadlineHours?: unknown;
    maxWorkers?: unknown;
    maxRunning?: unknown;
    maxCycles?: unknown;
  },
): store.SwarmRow {
  const swarm = requireEditable(swarmId, userId);
  const patch: store.SwarmPatch = {};
  if (body.title !== undefined) {
    const title = sanitizeMemoryText(body.title, MAX_SWARM_TITLE);
    if (!title) throw new SwarmServiceError("Title is required");
    patch.title = title;
  }
  if (body.budgetUsd !== undefined) {
    patch.budgetUsd = clampSwarmBudgetUsd(body.budgetUsd);
    if (patch.budgetUsd > swarm.spentUsd) patch.budgetWarned = false;
  }
  if (body.deadlineHours !== undefined) {
    patch.deadlineAt = Date.now() + clampSwarmDeadlineHours(body.deadlineHours) * 3_600_000;
  }
  if (body.maxWorkers !== undefined) patch.maxWorkers = clampSwarmMaxWorkers(body.maxWorkers);
  if (body.maxRunning !== undefined) patch.maxRunning = clampSwarmMaxRunning(body.maxRunning);
  if (body.maxCycles !== undefined) patch.maxCycles = clampSwarmMaxCycles(body.maxCycles);
  const next = store.updateSwarm(swarm.id, patch)!;
  store.insertSwarmEvent({
    swarmId: swarm.id,
    kind: "settings_changed",
    message: `Settings updated by ${humanLabel(userId)}`,
    meta: patch as Record<string, unknown>,
  });
  if (isActiveSwarmStatus(next.status)) swarmSignals.kick(swarm.id);
  return next;
}

export function deleteSwarmForUser(swarmId: string, userId: string): void {
  const swarm = requireEditable(swarmId, userId);
  if (isActiveSwarmStatus(swarm.status) || store.listSwarmAgents(swarm.id).some((a) => swarmRunner.isRunning(a.id))) {
    throw new SwarmServiceError("Stop the swarm before deleting it", 409);
  }
  store.deleteSwarm(swarm.id);
}
