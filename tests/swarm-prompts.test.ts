import { describe, expect, it } from "vitest";
import { buildCyclePrompt } from "../server/swarm/prompts.js";
import type { SwarmAgentRow, SwarmRow } from "../server/swarm/store.js";

function swarm(overrides: Partial<SwarmRow> = {}): SwarmRow {
  return {
    id: "sw_test",
    orgId: null,
    creatorId: "u1",
    title: "Demand-based tokens",
    goal: "Compare a demand-based addressed-token approach to the current implementation.",
    status: "planning",
    phase: "research",
    repoUrl: "https://github.com/acme/engine",
    startingRef: "main",
    modelId: "auto",
    budgetUsd: 25,
    spentUsd: 0,
    tokensUsed: 0,
    deadlineAt: 1_700_000_000_000,
    maxWorkers: 5,
    maxRunning: 3,
    maxCycles: 200,
    cyclesDone: 0,
    stallCount: 0,
    stopReason: null,
    approvalNote: null,
    createdAt: 1,
    updatedAt: 1,
    startedAt: 1,
    finishedAt: null,
    idleOrchestratorCycles: 0,
    budgetWarned: false,
    leaseOwner: null,
    leaseUntil: null,
    ...overrides,
  };
}

function agent(overrides: Partial<SwarmAgentRow> = {}): SwarmAgentRow {
  return {
    id: "sa_orch",
    swarmId: "sw_test",
    role: "orchestrator",
    label: "orchestrator",
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
    createdAt: 1,
    notesMd: "",
    tokenHash: null,
    tokenExpiresAt: null,
    consecutiveErrors: 0,
    spawnedBy: null,
    ...overrides,
  };
}

function prompt(row: SwarmRow, orch: SwarmAgentRow) {
  return buildCyclePrompt({
    swarm: row,
    agent: orch,
    agents: [orch],
    tasks: [],
    ledger: null,
    digest: "",
    gateMissing: ["a `report` artifact from the synthesizer"],
    now: 1_699_000_000_000,
  });
}

describe("swarm cycle prompts", () => {
  it("tells the no-checkout orchestrator about the attached repo and not to request_human for it", () => {
    const text = prompt(swarm(), agent());
    expect(text).toContain("https://github.com/acme/engine");
    expect(text).toContain("## Attached repository");
    expect(text).toContain("Do not request_human for the URL");
    expect(text).toContain("map the current implementation");
    expect(text).toMatch(/repo https:\/\/github.com\/acme\/engine @ main/);
    expect(text).not.toMatch(/You have no repository/);
    expect(text).not.toMatch(/repoUrl is null/);
  });

  it("does not claim a repo is attached when the swarm has none", () => {
    const text = prompt(swarm({ repoUrl: null }), agent());
    expect(text).toContain("This swarm has no attached repository");
    expect(text).toContain("no attached repository");
    expect(text).not.toContain("## Attached repository");
    expect(text).not.toContain("You have no repository");
  });

  it("describes a local checkout for build agents", () => {
    const engineer = agent({
      id: "sa_eng",
      role: "engineer",
      label: "coder",
      hasRepo: true,
      cycles: 1,
    });
    const text = buildCyclePrompt({
      swarm: swarm({ phase: "build", status: "building" }),
      agent: engineer,
      agents: [engineer],
      tasks: [],
      ledger: null,
      digest: "",
      gateMissing: [],
      now: 1_699_000_000_000,
    });
    expect(text).toContain("You have a local checkout of https://github.com/acme/engine");
    expect(text).toContain("## Repository");
    expect(text).not.toContain("## Attached repository");
  });
});
