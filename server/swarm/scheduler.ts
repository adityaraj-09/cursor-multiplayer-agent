import {
  SWARM_STALL_LIMIT,
  taskDependenciesMet,
  taskMatchesRole,
  type SwarmPhase,
  type SwarmRole,
  type SwarmStatus,
  type SwarmTaskInfo,
} from "../../shared/swarm.js";

export const ORCHESTRATOR_MIN_GAP_MS = 45_000;
export const WORKER_MIN_GAP_MS = 15_000;
export const MAX_CONSECUTIVE_ERRORS = 3;
/** After an error, back off before retrying the same agent. */
export const ERROR_BACKOFF_MS = 90_000;

export interface SchedulerAgent {
  id: string;
  role: SwarmRole;
  status: "idle" | "running" | "retired" | "error";
  cycles: number;
  lastCycleAt: number | null;
  consecutiveErrors: number;
}

export interface SchedulerInput {
  now: number;
  status: SwarmStatus;
  phase: SwarmPhase;
  maxRunning: number;
  stallCount: number;
  agents: SchedulerAgent[];
  runningIds: ReadonlySet<string>;
  tasks: Pick<SwarmTaskInfo, "id" | "kind" | "status" | "ownerAgentId" | "roleHint" | "blockedBy">[];
  /** Posts addressed to each agent since its last cycle. */
  mentions: ReadonlyMap<string, number>;
  /** Board / task activity by others since the orchestrator's last cycle. */
  activitySinceOrchestrator: number;
  /** Worker cycles that finished since the orchestrator's last cycle. */
  workerCyclesSinceOrchestrator: number;
  /** Free Cursor run slots for this swarm's API-key scope. */
  freeSlots: number;
  /**
   * Work that exists without an explicit task (uncritiqued hypotheses for
   * critics, unranked pairs for rankers, an unverified report for the verifier).
   */
  implicitWork?: ReadonlyMap<SwarmRole, number>;
}

export interface SchedulerPlan {
  start: string[];
  /** Orchestrator is being woken only because nobody has work. */
  orchestratorIdleWake: boolean;
}

function cooledDown(agent: SchedulerAgent, now: number, gap: number): boolean {
  if (agent.lastCycleAt === null) return true;
  const wait = agent.consecutiveErrors > 0 ? Math.max(gap, ERROR_BACKOFF_MS) : gap;
  return now - agent.lastCycleAt >= wait;
}

function available(agent: SchedulerAgent, runningIds: ReadonlySet<string>): boolean {
  if (runningIds.has(agent.id)) return false;
  if (agent.status === "retired" || agent.status === "running") return false;
  if (agent.consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) return false;
  return true;
}

/**
 * Decide which agents start a cycle right now. Pure: the runner supplies state
 * and executes the plan. Orchestrator first; workers only when they have work.
 */
export function planSwarmCycles(input: SchedulerInput): SchedulerPlan {
  const empty: SchedulerPlan = { start: [], orchestratorIdleWake: false };
  if (!["planning", "researching", "building"].includes(input.status)) return empty;

  const runningInSwarm = input.agents.filter((a) => input.runningIds.has(a.id)).length;
  let capacity = Math.min(input.maxRunning - runningInSwarm, input.freeSlots);
  if (capacity <= 0) return empty;

  const byId = new Map(input.tasks.map((t) => [t.id, t]));
  const claimableByRole = new Map<SwarmRole, number>();
  for (const task of input.tasks) {
    if (task.status !== "pending" || !taskDependenciesMet(task, byId)) continue;
    for (const role of new Set(input.agents.map((a) => a.role))) {
      if (taskMatchesRole(task, role)) {
        claimableByRole.set(role, (claimableByRole.get(role) ?? 0) + 1);
      }
    }
  }

  const orchestrator = input.agents.find((a) => a.role === "orchestrator");
  const workers = input.agents
    .filter((a) => a.role !== "orchestrator")
    .sort((a, b) => (a.lastCycleAt ?? 0) - (b.lastCycleAt ?? 0));

  const workerPicks: string[] = [];
  const claimBudget = new Map(claimableByRole);
  const implicitBudget = new Map(input.implicitWork ?? []);
  for (const w of workers) {
    if (!available(w, input.runningIds) || !cooledDown(w, input.now, WORKER_MIN_GAP_MS)) continue;
    const holdsTask = input.tasks.some((t) => t.ownerAgentId === w.id && t.status === "claimed");
    const mentioned = (input.mentions.get(w.id) ?? 0) > 0;
    const claimable = claimBudget.get(w.role) ?? 0;
    const implicit = implicitBudget.get(w.role) ?? 0;
    if (holdsTask || mentioned) {
      workerPicks.push(w.id);
    } else if (claimable > 0) {
      claimBudget.set(w.role, claimable - 1);
      workerPicks.push(w.id);
    } else if (implicit > 0) {
      implicitBudget.set(w.role, implicit - 1);
      workerPicks.push(w.id);
    }
  }

  const anyWorkerRunning = workers.some((w) => input.runningIds.has(w.id));
  const nobodyHasWork = workerPicks.length === 0 && !anyWorkerRunning;
  const plan: SchedulerPlan = { start: [], orchestratorIdleWake: false };

  if (orchestrator && available(orchestrator, input.runningIds)) {
    const firstCycle = orchestrator.cycles === 0;
    const gapOk = firstCycle || cooledDown(orchestrator, input.now, ORCHESTRATOR_MIN_GAP_MS);
    const liveWorkers = workers.filter((w) => w.status !== "retired").length;
    const mentioned = (input.mentions.get(orchestrator.id) ?? 0) > 0;
    const enoughWork =
      input.workerCyclesSinceOrchestrator >= Math.max(2, Math.ceil(liveWorkers / 2));
    const reason =
      firstCycle ||
      mentioned ||
      enoughWork ||
      input.stallCount >= SWARM_STALL_LIMIT ||
      (input.activitySinceOrchestrator > 0 && !anyWorkerRunning) ||
      nobodyHasWork;
    if (gapOk && reason) {
      plan.start.push(orchestrator.id);
      plan.orchestratorIdleWake =
        !firstCycle && nobodyHasWork && !mentioned && input.activitySinceOrchestrator === 0;
      capacity -= 1;
    }
  }

  for (const id of workerPicks) {
    if (capacity <= 0) break;
    plan.start.push(id);
    capacity -= 1;
  }
  return plan;
}

export interface ImplicitWorkInput {
  hypotheses: { critiques: number; matches: number; status: string; updatedAt: number }[];
  report: { updatedAt: number } | null;
  lastVerificationAt: number | null;
}

/** Research-loop work that does not need the orchestrator to write a task. */
export function computeImplicitWork(input: ImplicitWorkInput): Map<SwarmRole, number> {
  const live = input.hypotheses.filter((h) => h.status !== "rejected");
  const work = new Map<SwarmRole, number>();
  const uncritiqued = live.filter((h) => h.critiques === 0).length;
  if (uncritiqued) work.set("critic", uncritiqued);
  const underRanked = live.filter((h) => h.matches < 2).length;
  if (live.length >= 2 && underRanked) work.set("ranker", Math.ceil(underRanked / 2));
  const critiqued = live.filter((h) => h.critiques > 0);
  const changedSinceReport = input.report
    ? critiqued.filter((h) => h.updatedAt > input.report!.updatedAt).length
    : critiqued.length;
  if (critiqued.length >= 3 && changedSinceReport >= (input.report ? 2 : 3)) {
    work.set("synthesizer", 1);
  }
  if (input.report && (input.lastVerificationAt ?? 0) < input.report.updatedAt) {
    work.set("verifier", 1);
  }
  return work;
}

/** Cursor's concurrency / rate limits surface as errors on send. */
export function isCursorCapacityError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("too many concurrent") ||
    m.includes("concurrent runs") ||
    m.includes("rate-limited") ||
    m.includes("rate limited") ||
    m.includes("429") ||
    m.includes("limit for your current plan") ||
    m.includes("run more cloud agents")
  );
}
