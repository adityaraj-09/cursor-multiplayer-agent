export const SWARM_STATUSES = [
  "draft",
  "planning",
  "researching",
  "awaiting_approval",
  "building",
  "paused",
  "stopped",
  "done",
  "failed",
] as const;
export type SwarmStatus = (typeof SWARM_STATUSES)[number];

/** Statuses where the runner schedules agent cycles. */
export const ACTIVE_SWARM_STATUSES = ["planning", "researching", "building"] as const;

export const TERMINAL_SWARM_STATUSES = ["stopped", "done", "failed"] as const;

export type SwarmPhase = "research" | "build";

export const SWARM_ROLES = [
  "orchestrator",
  "researcher",
  "critic",
  "ranker",
  "synthesizer",
  "verifier",
  "engineer",
  "integrator",
] as const;
export type SwarmRole = (typeof SWARM_ROLES)[number];

/** Roles that write code and can only be spawned in the build phase. */
export const REPO_ROLES: readonly SwarmRole[] = ["engineer", "integrator"];
export const WORKER_ROLES: readonly SwarmRole[] = SWARM_ROLES.filter(
  (role) => role !== "orchestrator",
);

export type SwarmAgentStatus = "idle" | "running" | "retired" | "error";

export const SWARM_TASK_STATUSES = [
  "pending",
  "claimed",
  "done",
  "failed",
  "cancelled",
] as const;
export type SwarmTaskStatus = (typeof SWARM_TASK_STATUSES)[number];

export const SWARM_TASK_KINDS = [
  "research",
  "critique",
  "rank",
  "synthesize",
  "verify",
  "build",
  "integrate",
] as const;
export type SwarmTaskKind = (typeof SWARM_TASK_KINDS)[number];

export const SWARM_POST_KINDS = [
  "finding",
  "question",
  "answer",
  "proposal",
  "critique",
  "decision",
  "directive",
  "progress",
] as const;
export type SwarmPostKind = (typeof SWARM_POST_KINDS)[number];

export const SWARM_BASE_CHANNELS = ["plan", "findings", "questions", "decisions"] as const;
export type SwarmBaseChannel = (typeof SWARM_BASE_CHANNELS)[number];

export const SWARM_HYPOTHESIS_STATUSES = [
  "proposed",
  "promoted",
  "rejected",
] as const;
export type SwarmHypothesisStatus = (typeof SWARM_HYPOTHESIS_STATUSES)[number];

export const SWARM_CRITIQUE_VERDICTS = ["support", "refute", "needs_evidence"] as const;
export type SwarmCritiqueVerdict = (typeof SWARM_CRITIQUE_VERDICTS)[number];

export const SWARM_ARTIFACT_KINDS = [
  "report",
  "design",
  "notes",
  "benchmark",
  "data",
  "code_ref",
  "other",
] as const;
export type SwarmArtifactKind = (typeof SWARM_ARTIFACT_KINDS)[number];

export const DEFAULT_SWARM_BUDGET_USD = 25;
export const MAX_SWARM_BUDGET_USD = 2000;
export const DEFAULT_SWARM_DEADLINE_HOURS = 24;
export const MAX_SWARM_DEADLINE_HOURS = 24 * 14;
export const DEFAULT_SWARM_MAX_WORKERS = 5;
export const MAX_SWARM_WORKERS = 8;
export const DEFAULT_SWARM_MAX_RUNNING = 3;
export const MAX_SWARM_RUNNING = 6;
export const DEFAULT_SWARM_MAX_CYCLES = 200;
export const MAX_SWARM_CYCLES = 2000;
export const SWARM_STALL_LIMIT = 2;
export const SWARM_IDLE_ORCHESTRATOR_LIMIT = 3;
export const SWARM_MIN_CRITIQUED_HYPOTHESES = 4;
export const SWARM_BUDGET_WARN_RATIO = 0.8;
export const MAX_SWARM_TITLE = 160;
export const MAX_SWARM_GOAL = 12_000;
export const MAX_SWARM_POST = 8_000;
export const MAX_SWARM_NOTES = 12_000;
export const MAX_SWARM_TASK_SPEC = 4_000;
export const MAX_SWARM_LEDGER_FIELD = 12_000;
export const MAX_SWARM_ARTIFACT = 200_000;
export const MAX_SWARM_BRIEF = 3_000;
export const SWARM_ELO_START = 1200;
export const SWARM_ELO_K = 32;

export interface SwarmInfo {
  id: string;
  orgId: string | null;
  creatorId: string;
  creatorName?: string | null;
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
  stopReason: string | null;
  approvalNote: string | null;
  createdAt: number;
  updatedAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  runningAgents?: number;
  totalAgents?: number;
}

export interface SwarmAgentInfo {
  id: string;
  swarmId: string;
  role: SwarmRole;
  label: string;
  brief: string;
  status: SwarmAgentStatus;
  cursorAgentId: string | null;
  hasRepo: boolean;
  branch: string | null;
  currentTaskId: string | null;
  cycles: number;
  spentUsd: number;
  tokensUsed: number;
  lastCycleAt: number | null;
  lastBoardCallAt: number | null;
  runStartedAt: number | null;
  lastError: string | null;
  createdAt: number;
  /** Agent that spawned this worker. Null for the orchestrator. */
  spawnedBy: string | null;
}

export interface SwarmTaskInfo {
  id: string;
  swarmId: string;
  title: string;
  spec: string;
  kind: SwarmTaskKind;
  status: SwarmTaskStatus;
  ownerAgentId: string | null;
  roleHint: SwarmRole | null;
  blockedBy: string[];
  priority: number;
  resultMd: string | null;
  attempts: number;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
}

export interface SwarmPostInfo {
  id: string;
  swarmId: string;
  authorAgentId: string | null;
  authorUserId: string | null;
  authorLabel: string;
  authorRole: SwarmRole | "human" | "system";
  channel: string;
  kind: SwarmPostKind;
  bodyMd: string;
  refs: string[];
  mentions: string[];
  createdAt: number;
}

export interface SwarmLedgerInfo {
  swarmId: string;
  revision: number;
  factsMd: string;
  guessesMd: string;
  planMd: string;
  openQuestionsMd: string;
  progress: SwarmProgressEntry | null;
  updatedBy: string | null;
  updatedAt: number;
}

export interface SwarmProgressEntry {
  isRequestSatisfied: boolean;
  isProgressBeingMade: boolean;
  isInLoop: boolean;
  nextFocus: string;
  reason: string;
}

export interface SwarmHypothesisInfo {
  id: string;
  swarmId: string;
  title: string;
  claimMd: string;
  evidenceMd: string;
  parentIds: string[];
  elo: number;
  matches: number;
  wins: number;
  critiques: number;
  status: SwarmHypothesisStatus;
  authorAgentId: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface SwarmCritiqueInfo {
  id: string;
  hypothesisId: string;
  authorAgentId: string | null;
  verdict: SwarmCritiqueVerdict;
  score: number;
  bodyMd: string;
  createdAt: number;
}

export interface SwarmArtifactInfo {
  id: string;
  swarmId: string;
  agentId: string | null;
  kind: SwarmArtifactKind;
  name: string;
  size: number;
  createdAt: number;
  updatedAt: number;
}

export interface SwarmEventInfo {
  id: string;
  swarmId: string;
  agentId: string | null;
  kind: string;
  message: string;
  createdAt: number;
}

export interface SwarmMessageInfo {
  id: string;
  agentId: string;
  cycle: number;
  role: "user" | "assistant" | "tool" | "error";
  content: string;
  toolName: string | null;
  status: "running" | "done" | "error" | null;
  ts: number;
}

export interface SwarmSnapshot {
  swarm: SwarmInfo;
  agents: SwarmAgentInfo[];
  tasks: SwarmTaskInfo[];
  posts: SwarmPostInfo[];
  hypotheses: SwarmHypothesisInfo[];
  critiques: SwarmCritiqueInfo[];
  ledger: SwarmLedgerInfo | null;
  artifacts: SwarmArtifactInfo[];
  events: SwarmEventInfo[];
  canEdit: boolean;
}

function includes<T extends string>(list: readonly T[], value: unknown): value is T {
  return typeof value === "string" && (list as readonly string[]).includes(value);
}

export const isSwarmStatus = (v: unknown): v is SwarmStatus => includes(SWARM_STATUSES, v);
export const isSwarmRole = (v: unknown): v is SwarmRole => includes(SWARM_ROLES, v);
export const isSwarmTaskKind = (v: unknown): v is SwarmTaskKind =>
  includes(SWARM_TASK_KINDS, v);
export const isSwarmTaskStatus = (v: unknown): v is SwarmTaskStatus =>
  includes(SWARM_TASK_STATUSES, v);
export const isSwarmPostKind = (v: unknown): v is SwarmPostKind =>
  includes(SWARM_POST_KINDS, v);
export const isSwarmArtifactKind = (v: unknown): v is SwarmArtifactKind =>
  includes(SWARM_ARTIFACT_KINDS, v);
export const isSwarmCritiqueVerdict = (v: unknown): v is SwarmCritiqueVerdict =>
  includes(SWARM_CRITIQUE_VERDICTS, v);
export const isSwarmHypothesisStatus = (v: unknown): v is SwarmHypothesisStatus =>
  includes(SWARM_HYPOTHESIS_STATUSES, v);

export function isActiveSwarmStatus(status: SwarmStatus): boolean {
  return (ACTIVE_SWARM_STATUSES as readonly string[]).includes(status);
}

export function isTerminalSwarmStatus(status: SwarmStatus): boolean {
  return (TERMINAL_SWARM_STATUSES as readonly string[]).includes(status);
}

export function canStartSwarm(status: SwarmStatus): boolean {
  return status === "draft";
}

export function canPauseSwarm(status: SwarmStatus): boolean {
  return isActiveSwarmStatus(status) || status === "awaiting_approval";
}

export function canResumeSwarm(status: SwarmStatus): boolean {
  return status === "paused";
}

export function canStopSwarm(status: SwarmStatus): boolean {
  return !isTerminalSwarmStatus(status);
}

export function isSwarmChannel(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if ((SWARM_BASE_CHANNELS as readonly string[]).includes(value)) return true;
  return /^task:[A-Za-z0-9_-]{4,40}$/.test(value);
}

export function roleNeedsRepo(role: SwarmRole): boolean {
  return REPO_ROLES.includes(role);
}

/** When the human attached a repo, every agent gets a checkout so they can read it. */
export function swarmAgentUsesRepo(
  swarm: Pick<SwarmInfo, "repoUrl">,
  _role?: SwarmRole,
): boolean {
  return Boolean(swarm.repoUrl);
}

/** Engineers / integrators only exist once the research report is approved. */
export function roleAllowedInPhase(role: SwarmRole, phase: SwarmPhase): boolean {
  if (role === "orchestrator") return false;
  if (roleNeedsRepo(role)) return phase === "build";
  return true;
}

export function canEditSwarm(
  swarm: { creatorId: string; orgId?: string | null },
  actor: { userId: string; orgRole?: string | null },
): boolean {
  if (swarm.creatorId === actor.userId) return true;
  return actor.orgRole === "owner" || actor.orgRole === "admin";
}

function clampNumber(raw: unknown, min: number, max: number, fallback: number): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function clampSwarmBudgetUsd(raw: unknown): number {
  return Math.round(clampNumber(raw, 1, MAX_SWARM_BUDGET_USD, DEFAULT_SWARM_BUDGET_USD) * 100) / 100;
}

export function clampSwarmDeadlineHours(raw: unknown): number {
  return clampNumber(raw, 1, MAX_SWARM_DEADLINE_HOURS, DEFAULT_SWARM_DEADLINE_HOURS);
}

export function clampSwarmMaxWorkers(raw: unknown): number {
  return Math.round(clampNumber(raw, 1, MAX_SWARM_WORKERS, DEFAULT_SWARM_MAX_WORKERS));
}

export function clampSwarmMaxRunning(raw: unknown): number {
  return Math.round(clampNumber(raw, 1, MAX_SWARM_RUNNING, DEFAULT_SWARM_MAX_RUNNING));
}

export function clampSwarmMaxCycles(raw: unknown): number {
  return Math.round(clampNumber(raw, 5, MAX_SWARM_CYCLES, DEFAULT_SWARM_MAX_CYCLES));
}

export type SwarmEloOutcome = "a" | "b" | "draw";

export function nextEloRatings(
  ratingA: number,
  ratingB: number,
  outcome: SwarmEloOutcome,
  k = SWARM_ELO_K,
): { a: number; b: number } {
  const expectedA = 1 / (1 + 10 ** ((ratingB - ratingA) / 400));
  const scoreA = outcome === "a" ? 1 : outcome === "b" ? 0 : 0.5;
  const delta = k * (scoreA - expectedA);
  const round = (n: number) => Math.round(n * 10) / 10;
  return { a: round(ratingA + delta), b: round(ratingB - delta) };
}

export interface SwarmLimitState {
  status: SwarmStatus;
  budgetUsd: number;
  spentUsd: number;
  deadlineAt: number | null;
  maxCycles: number;
  cyclesDone: number;
}

export type SwarmLimitVerdict =
  | { action: "continue" }
  | { action: "pause"; reason: "budget" }
  | { action: "stop"; reason: "deadline" | "max_cycles" };

/** Hard limits the runner enforces before starting any cycle. */
export function evaluateSwarmLimits(state: SwarmLimitState, now: number): SwarmLimitVerdict {
  if (state.spentUsd >= state.budgetUsd) return { action: "pause", reason: "budget" };
  if (state.deadlineAt !== null && now >= state.deadlineAt) {
    return { action: "stop", reason: "deadline" };
  }
  if (state.cyclesDone >= state.maxCycles) return { action: "stop", reason: "max_cycles" };
  return { action: "continue" };
}

export function shouldWarnBudget(spentUsd: number, budgetUsd: number): boolean {
  return budgetUsd > 0 && spentUsd >= budgetUsd * SWARM_BUDGET_WARN_RATIO;
}

export interface SwarmDoneGateInput {
  phase: SwarmPhase;
  hasReport: boolean;
  critiquedHypotheses: number;
  latestVerificationPassed: boolean | null;
  openBuildTasks: number;
  minCritiquedHypotheses?: number;
}

/** A swarm may only finish with a report, enough vetted ideas, and a passing verifier. */
export function evaluateDoneGate(input: SwarmDoneGateInput): {
  ok: boolean;
  missing: string[];
} {
  const missing: string[] = [];
  const minCritiqued = input.minCritiquedHypotheses ?? SWARM_MIN_CRITIQUED_HYPOTHESES;
  if (!input.hasReport) missing.push("a `report` artifact from the synthesizer");
  if (input.critiquedHypotheses < minCritiqued) {
    missing.push(
      `at least ${minCritiqued} critiqued hypotheses (have ${input.critiquedHypotheses})`,
    );
  }
  if (input.latestVerificationPassed !== true) {
    missing.push("a passing verify_result from the verifier after the latest report");
  }
  if (input.phase === "build" && input.openBuildTasks > 0) {
    missing.push(`${input.openBuildTasks} build task(s) still open`);
  }
  return { ok: missing.length === 0, missing };
}

export function taskDependenciesMet(
  task: Pick<SwarmTaskInfo, "blockedBy">,
  byId: Map<string, Pick<SwarmTaskInfo, "status">>,
): boolean {
  return task.blockedBy.every((id) => byId.get(id)?.status === "done");
}

export function taskMatchesRole(task: Pick<SwarmTaskInfo, "roleHint" | "kind">, role: SwarmRole): boolean {
  if (task.roleHint) return task.roleHint === role;
  switch (task.kind) {
    case "research":
      return role === "researcher";
    case "critique":
      return role === "critic";
    case "rank":
      return role === "ranker";
    case "synthesize":
      return role === "synthesizer";
    case "verify":
      return role === "verifier";
    case "build":
      return role === "engineer";
    case "integrate":
      return role === "integrator";
  }
}

export function extractMentions(body: string): string[] {
  const out = new Set<string>();
  for (const match of body.matchAll(/(^|\s)@([A-Za-z0-9][A-Za-z0-9_-]{0,39})/g)) {
    out.add(match[2]!.toLowerCase());
  }
  return [...out];
}

export function slugifySwarmLabel(raw: string, fallback = "agent"): string {
  const slug = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
  return slug || fallback;
}

export function swarmTitleFromGoal(goal: string): string {
  const firstLine = goal.trim().split(/\n/)[0] || "Swarm";
  const clean = firstLine.replace(/\s+/g, " ").trim();
  return clean.length > 80 ? `${clean.slice(0, 77).trimEnd()}…` : clean;
}

/** Compact label for a swarm's stored Cursor model id (no catalog required). */
export function formatSwarmModelLabel(modelId: string | null | undefined): string {
  const id = (modelId ?? "").trim();
  if (!id || id === "auto") return "Auto";
  const leaf = id.includes("/") ? id.split("/").pop() || id : id;
  return leaf.length > 28 ? `${leaf.slice(0, 26).trimEnd()}…` : leaf;
}

function clip(text: string, max: number): string {
  const t = text.trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

export interface SwarmDigestInput {
  agentId: string;
  agentLabel: string;
  since: number;
  posts: Pick<
    SwarmPostInfo,
    "id" | "authorLabel" | "authorRole" | "channel" | "kind" | "bodyMd" | "mentions" | "createdAt"
  >[];
  tasks: Pick<SwarmTaskInfo, "id" | "title" | "status" | "ownerAgentId" | "kind">[];
  hypotheses: Pick<SwarmHypothesisInfo, "id" | "title" | "elo" | "critiques" | "status">[];
  agents: Pick<SwarmAgentInfo, "id" | "label" | "role" | "status">[];
  maxChars?: number;
}

/**
 * Deterministic board digest injected into every cycle prompt. Agents get the
 * decisions, directives, and anything addressed to them — not the whole board.
 */
export function buildBoardDigest(input: SwarmDigestInput): string {
  const maxChars = input.maxChars ?? 9_000;
  const labelLc = input.agentLabel.toLowerCase();
  const sorted = [...input.posts].sort((a, b) => a.createdAt - b.createdAt);
  const directives = sorted
    .filter((p) => p.kind === "directive" || p.channel === "plan")
    .slice(-6);
  const decisions = sorted.filter((p) => p.kind === "decision").slice(-5);
  const forMe = sorted
    .filter(
      (p) =>
        p.createdAt > input.since &&
        (p.mentions.includes(input.agentId) || p.mentions.includes(labelLc)),
    )
    .slice(-8);
  const fresh = sorted
    .filter(
      (p) =>
        p.createdAt > input.since &&
        (p.kind === "finding" || p.kind === "critique" || p.kind === "proposal"),
    )
    .slice(-10);
  const openQuestions = sorted
    .filter((p) => p.kind === "question" && p.createdAt > input.since)
    .slice(-5);

  const line = (p: SwarmDigestInput["posts"][number], max = 420) =>
    `- [${p.kind} · #${p.channel} · ${p.authorLabel}] ${clip(p.bodyMd.replace(/\s+/g, " "), max)} (post ${p.id})`;

  const sections: string[] = [];
  sections.push(
    `### Team\n${input.agents
      .filter((a) => a.status !== "retired")
      .map((a) => `- @${a.label} — ${a.role}${a.id === input.agentId ? " (you)" : ""} · ${a.status}`)
      .join("\n")}`,
  );
  if (directives.length) {
    sections.push(`### Current directives\n${directives.map((p) => line(p, 600)).join("\n")}`);
  }
  if (decisions.length) {
    sections.push(`### Decisions\n${decisions.map((p) => line(p)).join("\n")}`);
  }
  if (forMe.length) {
    sections.push(`### Addressed to you\n${forMe.map((p) => line(p, 600)).join("\n")}`);
  }
  if (fresh.length) {
    sections.push(`### New since your last cycle\n${fresh.map((p) => line(p)).join("\n")}`);
  }
  if (openQuestions.length) {
    sections.push(`### Open questions\n${openQuestions.map((p) => line(p)).join("\n")}`);
  }
  const top = [...input.hypotheses]
    .filter((h) => h.status !== "rejected")
    .sort((a, b) => b.elo - a.elo)
    .slice(0, 8);
  if (top.length) {
    sections.push(
      `### Hypothesis leaderboard\n${top
        .map((h, i) => `${i + 1}. ${clip(h.title, 140)} — Elo ${Math.round(h.elo)}, ${h.critiques} critique(s) (${h.id})`)
        .join("\n")}`,
    );
  }
  const openTasks = input.tasks.filter((t) => t.status === "pending" || t.status === "claimed");
  if (openTasks.length) {
    sections.push(
      `### Open tasks\n${openTasks
        .slice(0, 14)
        .map((t) => `- ${t.id} [${t.kind} · ${t.status}${t.ownerAgentId === input.agentId ? " · yours" : ""}] ${clip(t.title, 140)}`)
        .join("\n")}`,
    );
  }

  let out = sections.join("\n\n");
  if (out.length > maxChars) out = `${out.slice(0, maxChars - 40).trimEnd()}\n…(digest truncated — call board_read)`;
  return out;
}
