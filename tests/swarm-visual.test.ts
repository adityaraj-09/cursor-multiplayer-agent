import { describe, expect, it } from "vitest";
import type { SwarmAgentInfo, SwarmTaskInfo } from "../shared/swarm.js";
import {
  addVec,
  buildSwarmVisualGraph,
  replayCast,
  smootherstep,
  visualStatusFor,
} from "../shared/swarmVisual.js";

function agent(partial: Partial<SwarmAgentInfo> & Pick<SwarmAgentInfo, "id" | "role" | "label">): SwarmAgentInfo {
  return {
    swarmId: "sw_test",
    brief: "",
    status: "idle",
    cursorAgentId: null,
    hasRepo: false,
    branch: null,
    currentTaskId: null,
    cycles: 0,
    spentUsd: 0,
    tokensUsed: 0,
    lastCycleAt: null,
    lastBoardCallAt: null,
    runStartedAt: null,
    lastError: null,
    createdAt: 100,
    spawnedBy: partial.role === "orchestrator" ? null : "sa_orch",
    ...partial,
  };
}

function task(partial: Partial<SwarmTaskInfo> & Pick<SwarmTaskInfo, "id" | "title">): SwarmTaskInfo {
  return {
    swarmId: "sw_test",
    spec: "",
    kind: "research",
    status: "pending",
    ownerAgentId: null,
    roleHint: null,
    blockedBy: [],
    priority: 0,
    resultMd: null,
    attempts: 0,
    createdAt: 100,
    updatedAt: 100,
    completedAt: null,
    ...partial,
  };
}

const orch = agent({ id: "sa_orch", role: "orchestrator", label: "orchestrator", createdAt: 1 });
const scout = agent({
  id: "sa_scout",
  role: "researcher",
  label: "kernels-scout",
  createdAt: 20,
  status: "running",
  currentTaskId: "st_survey",
  spawnedBy: "sa_orch",
});
const critic = agent({
  id: "sa_critic",
  role: "critic",
  label: "red-team",
  createdAt: 40,
  spawnedBy: "sa_orch",
});
const retired = agent({
  id: "sa_old",
  role: "researcher",
  label: "retired-scout",
  createdAt: 30,
  status: "retired",
  spawnedBy: "sa_orch",
});
const late = agent({
  id: "sa_late",
  role: "verifier",
  label: "gatekeeper",
  createdAt: 90,
  spawnedBy: "sa_orch",
});
const survey = task({
  id: "st_survey",
  title: "Survey kernels",
  kind: "research",
  status: "claimed",
  ownerAgentId: "sa_scout",
  updatedAt: 200,
});

describe("swarm visual graph", () => {
  it("adds vectors for dragged role planes", () => {
    expect(addVec([1, 2, 3], [4, -1, 0.5])).toEqual([5, 1, 3.5]);
  });

  it("maps agent statuses for the scene", () => {
    expect(visualStatusFor("idle")).toBe("idle");
    expect(visualStatusFor("running")).toBe("working");
    expect(visualStatusFor("retired")).toBe("dead");
    expect(visualStatusFor("error")).toBe("error");
  });

  it("places the orchestrator above workers and draws spawn plus work edges", () => {
    const graph = buildSwarmVisualGraph({
      agents: [orch, scout, critic],
      tasks: [survey],
      includeRetired: false,
    });
    const orchNode = graph.agents.find((a) => a.role === "orchestrator")!;
    const scoutNode = graph.agents.find((a) => a.id === "sa_scout")!;
    expect(orchNode.scale).toBeGreaterThan(scoutNode.scale);
    expect(orchNode.position[1]).toBeGreaterThan(scoutNode.position[1]);
    expect(scoutNode.visualStatus).toBe("working");
    expect(scoutNode.taskTitle).toBe("Survey kernels");
    expect(graph.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "spawn", from: "sa_orch", to: "sa_scout" }),
        expect.objectContaining({ type: "spawn", from: "sa_orch", to: "sa_critic" }),
        expect.objectContaining({ type: "work", from: "sa_scout", to: "st_survey" }),
      ]),
    );
    expect(graph.floors.map((f) => f.role).sort()).toEqual(["critic", "orchestrator", "researcher"]);
  });

  it("falls back to the orchestrator when spawnedBy is missing", () => {
    const orphan = agent({
      id: "sa_orphan",
      role: "ranker",
      label: "elo",
      spawnedBy: null,
      createdAt: 50,
    });
    const graph = buildSwarmVisualGraph({ agents: [orch, orphan], tasks: [] });
    expect(graph.edges).toContainEqual({
      id: "spawn:sa_orch:sa_orphan",
      type: "spawn",
      from: "sa_orch",
      to: "sa_orphan",
    });
  });

  it("hides retired workers unless asked, and replay drops later spawns", () => {
    const hidden = buildSwarmVisualGraph({
      agents: [orch, scout, retired, late],
      tasks: [survey],
    });
    expect(hidden.agents.map((a) => a.id).sort()).toEqual(["sa_late", "sa_orch", "sa_scout"]);
    expect(hidden.edges.some((e) => e.to === "sa_old")).toBe(false);

    const shown = buildSwarmVisualGraph({
      agents: [orch, scout, retired, late],
      tasks: [survey],
      includeRetired: true,
    });
    expect(shown.agents.some((a) => a.id === "sa_old" && a.visualStatus === "dead")).toBe(true);

    const replay = buildSwarmVisualGraph({
      agents: [orch, scout, retired, late],
      tasks: [survey],
      includeRetired: true,
      asOf: 35,
    });
    expect(replay.agents.map((a) => a.id).sort()).toEqual(["sa_old", "sa_orch", "sa_scout"]);
    const liveIds = new Set([...replay.agents.map((a) => a.id), ...replay.work.map((w) => w.id)]);
    expect(replay.edges.every((e) => liveIds.has(e.from) && liveIds.has(e.to))).toBe(true);
    expect(replay.edges.some((e) => e.to === "sa_late" || e.from === "sa_late")).toBe(false);
  });

  it("keeps layout stable across rebuilds", () => {
    const a = buildSwarmVisualGraph({ agents: [orch, scout, critic], tasks: [survey] });
    const b = buildSwarmVisualGraph({ agents: [orch, scout, critic], tasks: [survey] });
    expect(a.agents.map((n) => [n.id, n.position])).toEqual(b.agents.map((n) => [n.id, n.position]));
  });

  it("keeps early agent seats when later spawns replay in", () => {
    const early = buildSwarmVisualGraph({
      agents: [orch, scout, critic, late],
      tasks: [survey],
      includeRetired: true,
      asOf: 20,
    });
    const later = buildSwarmVisualGraph({
      agents: [orch, scout, critic, late],
      tasks: [survey],
      includeRetired: true,
      asOf: 90,
    });
    expect(early.agents.find((a) => a.id === "sa_scout")?.position).toEqual(
      later.agents.find((a) => a.id === "sa_scout")?.position,
    );
    expect(replayCast([late, orch, scout], { includeRetired: true }).map((a) => a.id)).toEqual([
      "sa_orch",
      "sa_scout",
      "sa_late",
    ]);
    expect(smootherstep(0)).toBe(0);
    expect(smootherstep(1)).toBe(1);
    expect(smootherstep(0.5)).toBeCloseTo(0.5);
    expect(smootherstep(0.2)).toBeLessThan(0.2);
  });
});
