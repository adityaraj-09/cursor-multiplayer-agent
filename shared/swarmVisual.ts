import {
  SWARM_ROLES,
  type SwarmAgentInfo,
  type SwarmAgentStatus,
  type SwarmRole,
  type SwarmTaskInfo,
  type SwarmTaskKind,
  type SwarmTaskStatus,
} from "./swarm";

export type SwarmVisualStatus = "idle" | "working" | "dead" | "error";

export const ROLE_HEX: Record<SwarmRole, string> = {
  orchestrator: "#f0c674",
  researcher: "#8ec5ff",
  critic: "#f59e9e",
  ranker: "#c4a7ff",
  synthesizer: "#7ee2c4",
  verifier: "#3ecf8e",
  engineer: "#f7a86b",
  integrator: "#f7d56b",
};

export const ROLE_FLOORS: Record<SwarmRole, { y: number; z: number; xBias: number; label: string }> = {
  orchestrator: { y: 5.2, z: -3.1, xBias: 0, label: "Orchestrator" },
  researcher: { y: 3.35, z: -0.7, xBias: -3.6, label: "Research" },
  critic: { y: 2.15, z: 0.55, xBias: 0.15, label: "Critique" },
  ranker: { y: 1.35, z: 0.15, xBias: 3.35, label: "Rank" },
  synthesizer: { y: 0.35, z: 2.05, xBias: -1.35, label: "Synthesize" },
  verifier: { y: -0.25, z: 2.25, xBias: 2.15, label: "Verify" },
  engineer: { y: -1.45, z: 1.35, xBias: 5.15, label: "Build" },
  integrator: { y: -1.45, z: 2.45, xBias: 6.45, label: "Integrate" },
};

export const WORK_BOARD = { y: -2.35, z: 4.35, x: 0 };

export type Vec3 = [number, number, number];

export const ZERO_VEC: Vec3 = [0, 0, 0];

export function addVec(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export interface SwarmVisualAgentNode {
  id: string;
  kind: "agent";
  role: SwarmRole;
  label: string;
  brief: string;
  status: SwarmAgentStatus;
  visualStatus: SwarmVisualStatus;
  spawnedBy: string | null;
  currentTaskId: string | null;
  taskTitle: string | null;
  position: Vec3;
  scale: number;
}

export interface SwarmVisualWorkNode {
  id: string;
  kind: "work";
  title: string;
  taskKind: SwarmTaskKind;
  status: SwarmTaskStatus;
  ownerAgentId: string | null;
  position: Vec3;
}

export interface SwarmVisualEdge {
  id: string;
  type: "spawn" | "work";
  from: string;
  to: string;
}

export interface SwarmVisualFloor {
  role: SwarmRole;
  label: string;
  center: Vec3;
  width: number;
  depth: number;
}

export interface SwarmVisualGraph {
  agents: SwarmVisualAgentNode[];
  work: SwarmVisualWorkNode[];
  edges: SwarmVisualEdge[];
  floors: SwarmVisualFloor[];
}

export function visualStatusFor(status: SwarmAgentStatus): SwarmVisualStatus {
  if (status === "running") return "working";
  if (status === "retired") return "dead";
  if (status === "error") return "error";
  return "idle";
}

export function agentVisibleInGraph(
  agent: Pick<SwarmAgentInfo, "status" | "createdAt" | "role">,
  opts: { includeRetired?: boolean; asOf?: number | null } = {},
): boolean {
  if (opts.asOf != null && agent.createdAt > opts.asOf) return false;
  if (agent.role === "orchestrator") return true;
  if (!opts.includeRetired && agent.status === "retired") return false;
  return true;
}

export function replayCast(
  agents: SwarmAgentInfo[],
  opts: { includeRetired?: boolean } = {},
): SwarmAgentInfo[] {
  return agents
    .filter((agent) => agentVisibleInGraph(agent, { includeRetired: opts.includeRetired, asOf: null }))
    .slice()
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
}

/** Perlin smootherstep — slow in and out, no linear snap. */
export function smootherstep(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x * x * x * (x * (x * 6 - 15) + 10);
}

function layoutAgents(agents: SwarmAgentInfo[]): Map<string, Vec3> {
  const byRole = new Map<SwarmRole, SwarmAgentInfo[]>();
  for (const role of SWARM_ROLES) byRole.set(role, []);
  for (const agent of agents) {
    (byRole.get(agent.role) ?? []).push(agent);
  }
  const positions = new Map<string, Vec3>();
  for (const role of SWARM_ROLES) {
    const lane = ROLE_FLOORS[role];
    const list = (byRole.get(role) ?? [])
      .slice()
      .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
    const n = list.length;
    list.forEach((agent, i) => {
      const x = lane.xBias + (i - (n - 1) / 2) * 1.55;
      const z = lane.z + (i % 2 === 0 ? 0 : 0.32);
      positions.set(agent.id, [x, lane.y, z]);
    });
  }
  return positions;
}

function floorsFor(agents: SwarmVisualAgentNode[]): SwarmVisualFloor[] {
  const floors: SwarmVisualFloor[] = [];
  for (const role of SWARM_ROLES) {
    const nodes = agents.filter((a) => a.role === role);
    if (!nodes.length) continue;
    const xs = nodes.map((n) => n.position[0]);
    const zs = nodes.map((n) => n.position[2]);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minZ = Math.min(...zs);
    const maxZ = Math.max(...zs);
    const padX = role === "orchestrator" ? 1.6 : 1.25;
    const padZ = role === "orchestrator" ? 1.3 : 1.05;
    floors.push({
      role,
      label: ROLE_FLOORS[role].label,
      center: [(minX + maxX) / 2, ROLE_FLOORS[role].y - 0.02, (minZ + maxZ) / 2],
      width: Math.max(2.2, maxX - minX + padX * 2),
      depth: Math.max(1.6, maxZ - minZ + padZ * 2),
    });
  }
  return floors;
}

function workPositions(count: number): Vec3[] {
  const cols = Math.min(4, Math.max(1, count));
  const rows = Math.ceil(count / cols);
  return Array.from({ length: count }, (_, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = WORK_BOARD.x + (col - (cols - 1) / 2) * 1.85;
    const z = WORK_BOARD.z + (row - (rows - 1) / 2) * 1.15;
    return [x, WORK_BOARD.y, z];
  });
}

export function buildSwarmVisualGraph(input: {
  agents: SwarmAgentInfo[];
  tasks: SwarmTaskInfo[];
  includeRetired?: boolean;
  asOf?: number | null;
}): SwarmVisualGraph {
  const layoutPool = replayCast(input.agents, { includeRetired: input.includeRetired });
  const visible = input.agents
    .filter((agent) => agentVisibleInGraph(agent, input))
    .slice()
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  const visibleIds = new Set(visible.map((a) => a.id));
  const positions = layoutAgents(layoutPool);
  const taskById = new Map(input.tasks.map((t) => [t.id, t]));

  const agents: SwarmVisualAgentNode[] = visible.map((agent) => {
    const current = agent.currentTaskId ? taskById.get(agent.currentTaskId) : undefined;
    const owned = input.tasks.find((t) => t.ownerAgentId === agent.id && t.status !== "cancelled");
    return {
      id: agent.id,
      kind: "agent",
      role: agent.role,
      label: agent.label,
      brief: agent.brief,
      status: agent.status,
      visualStatus: visualStatusFor(agent.status),
      spawnedBy: agent.spawnedBy,
      currentTaskId: agent.currentTaskId,
      taskTitle: current?.title ?? owned?.title ?? null,
      position: positions.get(agent.id) ?? [0, 0, 0],
      scale: agent.role === "orchestrator" ? 1.45 : 1,
    };
  });

  const workSource = input.tasks.filter((task) => {
    if (task.status === "cancelled") return false;
    if (task.ownerAgentId && visibleIds.has(task.ownerAgentId)) return true;
    return visible.some((a) => a.currentTaskId === task.id);
  });
  const ranked = workSource
    .slice()
    .sort((a, b) => {
      const rank = (t: SwarmTaskInfo) =>
        t.status === "claimed" ? 0 : visible.some((agent) => agent.currentTaskId === t.id) ? 1 : 2;
      return rank(a) - rank(b) || b.updatedAt - a.updatedAt;
    })
    .slice(0, 12);
  const spots = workPositions(ranked.length);
  const work: SwarmVisualWorkNode[] = ranked.map((task, i) => ({
    id: task.id,
    kind: "work",
    title: task.title,
    taskKind: task.kind,
    status: task.status,
    ownerAgentId: task.ownerAgentId,
    position: spots[i] ?? [WORK_BOARD.x, WORK_BOARD.y, WORK_BOARD.z],
  }));
  const workIds = new Set(work.map((node) => node.id));

  const orch = agents.find((a) => a.role === "orchestrator");
  const edges: SwarmVisualEdge[] = [];
  for (const agent of agents) {
    if (agent.role === "orchestrator") continue;
    const parent =
      (agent.spawnedBy && visibleIds.has(agent.spawnedBy) && agent.spawnedBy) || orch?.id || null;
    if (!parent) continue;
    edges.push({
      id: `spawn:${parent}:${agent.id}`,
      type: "spawn",
      from: parent,
      to: agent.id,
    });
  }

  const seenWork = new Set<string>();
  const addWork = (from: string, to: string) => {
    const id = `work:${from}:${to}`;
    if (seenWork.has(id) || !workIds.has(to) || !visibleIds.has(from)) return;
    seenWork.add(id);
    edges.push({ id, type: "work", from, to });
  };
  for (const agent of agents) {
    if (agent.currentTaskId) addWork(agent.id, agent.currentTaskId);
  }
  for (const node of work) {
    if (node.ownerAgentId && (node.status === "claimed" || node.status === "done")) {
      addWork(node.ownerAgentId, node.id);
    }
  }

  return { agents, work, edges, floors: floorsFor(agents) };
}
