import type {
  SwarmAgentInfo,
  SwarmArtifactInfo,
  SwarmCritiqueInfo,
  SwarmEventInfo,
  SwarmHypothesisInfo,
  SwarmInfo,
  SwarmLedgerInfo,
  SwarmPostInfo,
  SwarmTaskInfo,
} from "../../../../shared/swarm";
import rawSwarm from "./vllm-data/swarm.json";
import rawAgents from "./vllm-data/agents.json";
import rawPosts from "./vllm-data/posts.json";
import rawTasks from "./vllm-data/tasks.json";
import rawHypotheses from "./vllm-data/hypotheses.json";
import rawCritiques from "./vllm-data/critiques.json";
import rawLedger from "./vllm-data/ledger.json";
import rawEvents from "./vllm-data/events.json";
import rawArtifacts from "./vllm-data/artifacts.json";

const SWARM_ID = rawSwarm.id;

type RawAgent = (typeof rawAgents)[number];
type RawArtifact = (typeof rawArtifacts)[number];

function toTs(value: number | string): number {
  if (typeof value === "number") return value;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? Date.now() : parsed;
}

export const VLLM_AGENTS: SwarmAgentInfo[] = (rawAgents as RawAgent[]).map((agent) => ({
  id: agent.id,
  swarmId: SWARM_ID,
  role: agent.role as SwarmAgentInfo["role"],
  label: agent.label,
  brief: agent.brief,
  status: agent.status as SwarmAgentInfo["status"],
  cursorAgentId: agent.cursorAgentId,
  hasRepo: agent.hasRepo,
  branch: agent.branch,
  currentTaskId: agent.currentTaskId,
  cycles: agent.cycles,
  spentUsd: agent.spentUsd,
  tokensUsed: agent.tokensUsed,
  lastCycleAt: agent.lastCycleAt,
  lastBoardCallAt: null,
  runStartedAt: null,
  lastError: agent.lastError,
  createdAt: agent.createdAt,
  spawnedBy: agent.role === "orchestrator" ? null : "sa_w9B2juaMax9-",
}));

export const VLLM_SWARM: SwarmInfo = {
  ...(rawSwarm as Omit<SwarmInfo, "runningAgents" | "totalAgents" | "creatorName">),
  creatorName: "Jules",
  runningAgents: VLLM_AGENTS.filter((agent) => agent.status === "running").length,
  totalAgents: VLLM_AGENTS.length,
};

export const VLLM_POSTS = rawPosts as SwarmPostInfo[];
export const VLLM_TASKS = rawTasks as SwarmTaskInfo[];
export const VLLM_HYPOTHESES = rawHypotheses as SwarmHypothesisInfo[];
export const VLLM_CRITIQUES = rawCritiques as SwarmCritiqueInfo[];
export const VLLM_EVENTS = rawEvents as SwarmEventInfo[];

export const VLLM_LEDGER: SwarmLedgerInfo = (rawLedger as { current: SwarmLedgerInfo }).current;

export const VLLM_ARTIFACTS: SwarmArtifactInfo[] = (rawArtifacts as RawArtifact[]).map((item) => ({
  id: item.id,
  swarmId: SWARM_ID,
  agentId: item.agentId,
  kind: item.kind as SwarmArtifactInfo["kind"],
  name: item.name,
  size: item.size,
  createdAt: toTs(item.createdAt),
  updatedAt: toTs(item.updatedAt),
}));

const now = Date.now();

export const DEMO_SWARM_LIST: SwarmInfo[] = [
  {
    id: "swm_auth_rebuild",
    orgId: null,
    creatorId: "user_jules",
    creatorName: "Jules",
    title: "Auth session rebuild",
    goal: "Map every Clerk appearance leak onto the shared dark chrome and hand a ranked fix list to the room.",
    status: "researching",
    phase: "research",
    repoUrl: "https://github.com/kinetic/rider-ios",
    startingRef: "main",
    modelId: "composer-2.5",
    budgetUsd: 15,
    spentUsd: 4.2,
    tokensUsed: 1_240_000,
    deadlineAt: now + 18 * 60 * 60 * 1000,
    maxWorkers: 4,
    maxRunning: 3,
    maxCycles: 80,
    cyclesDone: 9,
    stallCount: 0,
    stopReason: null,
    approvalNote: null,
    createdAt: now - 3 * 60 * 60 * 1000,
    updatedAt: now - 4 * 60 * 1000,
    startedAt: now - 3 * 60 * 60 * 1000,
    finishedAt: null,
    runningAgents: 2,
    totalAgents: 5,
  },
  {
    id: "swm_pickup_policy",
    orgId: null,
    creatorId: "user_maya",
    creatorName: "Maya",
    title: "Issue pickup policy",
    goal: "Decide delay, concurrency, and retry rules so headless agents pick up tickets without flooding the workspace.",
    status: "awaiting_approval",
    phase: "research",
    repoUrl: "https://github.com/kinetic/steer",
    startingRef: "main",
    modelId: "opus-4.6",
    budgetUsd: 20,
    spentUsd: 11.4,
    tokensUsed: 2_100_000,
    deadlineAt: now + 6 * 60 * 60 * 1000,
    maxWorkers: 4,
    maxRunning: 2,
    maxCycles: 60,
    cyclesDone: 14,
    stallCount: 0,
    stopReason: null,
    approvalNote: "Research is done. Approve to prototype the pickup queue on the shared branch.",
    createdAt: now - 26 * 60 * 60 * 1000,
    updatedAt: now - 40 * 60 * 1000,
    startedAt: now - 26 * 60 * 60 * 1000,
    finishedAt: null,
    runningAgents: 0,
    totalAgents: 6,
  },
  VLLM_SWARM,
];
