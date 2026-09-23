import { describe, expect, it } from "vitest";
import {
  buildBoardDigest,
  clampSwarmBudgetUsd,
  clampSwarmMaxWorkers,
  evaluateDoneGate,
  evaluateSwarmLimits,
  extractMentions,
  formatSwarmModelLabel,
  isSwarmChannel,
  nextEloRatings,
  roleAllowedInPhase,
  shouldWarnBudget,
  swarmAgentUsesRepo,
  slugifySwarmLabel,
  swarmTitleFromGoal,
  taskDependenciesMet,
  taskMatchesRole,
} from "../shared/swarm.js";
import {
  computeImplicitWork,
  isCursorCapacityError,
  planSwarmCycles,
  type SchedulerInput,
} from "../server/swarm/scheduler.js";

describe("swarm domain helpers", () => {
  it("updates Elo symmetrically and rewards upsets more", () => {
    const even = nextEloRatings(1200, 1200, "a");
    expect(even.a).toBe(1216);
    expect(even.b).toBe(1184);
    const upset = nextEloRatings(1100, 1300, "a");
    expect(upset.a - 1100).toBeGreaterThan(16);
    expect(upset.a + upset.b).toBeCloseTo(2400, 5);
    const draw = nextEloRatings(1200, 1200, "draw");
    expect(draw).toEqual({ a: 1200, b: 1200 });
  });

  it("enforces budget, deadline, and cycle caps in that order", () => {
    const base = {
      status: "researching" as const,
      budgetUsd: 10,
      spentUsd: 1,
      deadlineAt: 10_000,
      maxCycles: 50,
      cyclesDone: 3,
    };
    expect(evaluateSwarmLimits(base, 5_000)).toEqual({ action: "continue" });
    expect(evaluateSwarmLimits({ ...base, spentUsd: 10 }, 5_000)).toEqual({ action: "pause", reason: "budget" });
    expect(evaluateSwarmLimits(base, 10_000)).toEqual({ action: "stop", reason: "deadline" });
    expect(evaluateSwarmLimits({ ...base, cyclesDone: 50 }, 5_000)).toEqual({
      action: "stop",
      reason: "max_cycles",
    });
    expect(shouldWarnBudget(8, 10)).toBe(true);
    expect(shouldWarnBudget(7.9, 10)).toBe(false);
  });

  it("refuses to finish without a report, critiques, and a passing verifier", () => {
    const missing = evaluateDoneGate({
      phase: "research",
      hasReport: false,
      critiquedHypotheses: 1,
      latestVerificationPassed: null,
      openBuildTasks: 0,
    });
    expect(missing.ok).toBe(false);
    expect(missing.missing).toHaveLength(3);
    const ok = evaluateDoneGate({
      phase: "research",
      hasReport: true,
      critiquedHypotheses: 4,
      latestVerificationPassed: true,
      openBuildTasks: 0,
    });
    expect(ok).toEqual({ ok: true, missing: [] });
    const build = evaluateDoneGate({
      phase: "build",
      hasReport: true,
      critiquedHypotheses: 9,
      latestVerificationPassed: true,
      openBuildTasks: 2,
    });
    expect(build.ok).toBe(false);
    expect(build.missing[0]).toContain("build task");
  });

  it("parses channels, mentions, labels, and titles", () => {
    expect(isSwarmChannel("findings")).toBe(true);
    expect(isSwarmChannel("task:st_abc123")).toBe(true);
    expect(isSwarmChannel("random")).toBe(false);
    expect(extractMentions("hey @kernels-scout and @Critic, see this")).toEqual(["kernels-scout", "critic"]);
    expect(extractMentions("email a@b.com")).toEqual([]);
    expect(slugifySwarmLabel("  KV Cache Scout!! ")).toBe("kv-cache-scout");
    expect(swarmTitleFromGoal("Find a new way to host LLMs\nmore detail")).toBe("Find a new way to host LLMs");
    expect(formatSwarmModelLabel("auto")).toBe("Auto");
    expect(formatSwarmModelLabel("")).toBe("Auto");
    expect(formatSwarmModelLabel("claude-4.5-sonnet")).toBe("claude-4.5-sonnet");
    expect(formatSwarmModelLabel("cursor/composer-1")).toBe("composer-1");
    expect(clampSwarmBudgetUsd(-5)).toBe(1);
    expect(clampSwarmMaxWorkers(99)).toBe(8);
  });

  it("gates code roles to the build phase and matches tasks to roles", () => {
    expect(roleAllowedInPhase("engineer", "research")).toBe(false);
    expect(roleAllowedInPhase("engineer", "build")).toBe(true);
    expect(swarmAgentUsesRepo({ repoUrl: "https://github.com/acme/engine" })).toBe(true);
    expect(swarmAgentUsesRepo({ repoUrl: null })).toBe(false);
    expect(roleAllowedInPhase("critic", "research")).toBe(true);
    expect(taskMatchesRole({ kind: "critique", roleHint: null }, "critic")).toBe(true);
    expect(taskMatchesRole({ kind: "research", roleHint: "synthesizer" }, "researcher")).toBe(false);
    const byId = new Map([
      ["a", { status: "done" as const }],
      ["b", { status: "pending" as const }],
    ]);
    expect(taskDependenciesMet({ blockedBy: ["a"] }, byId)).toBe(true);
    expect(taskDependenciesMet({ blockedBy: ["a", "b"] }, byId)).toBe(false);
  });

  it("builds a focused digest with directives, mentions, and the leaderboard", () => {
    const digest = buildBoardDigest({
      agentId: "sa_me",
      agentLabel: "scout",
      since: 100,
      agents: [
        { id: "sa_orch", label: "orchestrator", role: "orchestrator", status: "idle" },
        { id: "sa_me", label: "scout", role: "researcher", status: "running" },
      ],
      posts: [
        { id: "p1", authorLabel: "orchestrator", authorRole: "orchestrator", channel: "plan", kind: "directive", bodyMd: "Focus on KV cache paging", mentions: [], createdAt: 50 },
        { id: "p2", authorLabel: "critic", authorRole: "critic", channel: "findings", kind: "critique", bodyMd: "Speculative decoding claim lacks evidence", mentions: [], createdAt: 150 },
        { id: "p3", authorLabel: "orchestrator", authorRole: "orchestrator", channel: "questions", kind: "question", bodyMd: "@scout what did you find?", mentions: ["sa_me"], createdAt: 160 },
        { id: "p0", authorLabel: "x", authorRole: "researcher", channel: "findings", kind: "finding", bodyMd: "old", mentions: [], createdAt: 10 },
      ],
      tasks: [{ id: "st_1", title: "Survey paged attention", status: "claimed", ownerAgentId: "sa_me", kind: "research" }],
      hypotheses: [
        { id: "h1", title: "Disaggregated prefill", elo: 1240, critiques: 2, status: "proposed" },
        { id: "h2", title: "Dead end", elo: 1300, critiques: 1, status: "rejected" },
      ],
    });
    expect(digest).toContain("Focus on KV cache paging");
    expect(digest).toContain("### Addressed to you");
    expect(digest).toContain("what did you find");
    expect(digest).toContain("Disaggregated prefill");
    expect(digest).not.toContain("Dead end");
    expect(digest).toContain("· yours");
    expect(digest).not.toContain("] old");
  });
});

describe("swarm scheduler", () => {
  const base = (): SchedulerInput => ({
    now: 1_000_000,
    status: "researching",
    phase: "research",
    maxRunning: 3,
    stallCount: 0,
    agents: [
      { id: "o", role: "orchestrator", status: "idle", cycles: 3, lastCycleAt: 900_000, consecutiveErrors: 0 },
      { id: "r1", role: "researcher", status: "idle", cycles: 2, lastCycleAt: 800_000, consecutiveErrors: 0 },
      { id: "r2", role: "researcher", status: "idle", cycles: 2, lastCycleAt: 850_000, consecutiveErrors: 0 },
      { id: "c", role: "critic", status: "idle", cycles: 1, lastCycleAt: 850_000, consecutiveErrors: 0 },
    ],
    runningIds: new Set(),
    tasks: [
      { id: "t1", kind: "research", status: "pending", ownerAgentId: null, roleHint: null, blockedBy: [] },
    ],
    mentions: new Map(),
    activitySinceOrchestrator: 0,
    workerCyclesSinceOrchestrator: 0,
    freeSlots: 6,
  });

  it("starts the orchestrator on its first cycle", () => {
    const input = base();
    input.status = "planning";
    input.agents = [{ id: "o", role: "orchestrator", status: "idle", cycles: 0, lastCycleAt: null, consecutiveErrors: 0 }];
    input.tasks = [];
    expect(planSwarmCycles(input).start).toEqual(["o"]);
  });

  it("gives one claimable task to one worker, oldest first", () => {
    const plan = planSwarmCycles(base());
    expect(plan.start).toEqual(["r1"]);
  });

  it("wakes mentioned workers and respects the running cap", () => {
    const input = base();
    input.mentions = new Map([["c", 1], ["r2", 1]]);
    input.maxRunning = 2;
    const plan = planSwarmCycles(input);
    expect(plan.start).toHaveLength(2);
    expect(plan.start).toEqual(expect.arrayContaining(["r1"]));
  });

  it("wakes the orchestrator when nobody has work, and flags it as idle", () => {
    const input = base();
    input.tasks = [];
    const plan = planSwarmCycles(input);
    expect(plan.start).toEqual(["o"]);
    expect(plan.orchestratorIdleWake).toBe(true);
  });

  it("does nothing without free Cursor slots or when paused", () => {
    expect(planSwarmCycles({ ...base(), freeSlots: 0 }).start).toEqual([]);
    expect(planSwarmCycles({ ...base(), status: "paused" }).start).toEqual([]);
  });

  it("parks agents after repeated errors and backs off after one", () => {
    const input = base();
    input.agents[1] = { ...input.agents[1]!, consecutiveErrors: 3 };
    input.agents[2] = { ...input.agents[2]!, consecutiveErrors: 1, lastCycleAt: input.now - 20_000 };
    const plan = planSwarmCycles(input);
    expect(plan.start).not.toContain("r1");
    expect(plan.start).not.toContain("r2");
    expect(plan.start).toEqual(["o"]);
  });

  it("treats uncritiqued hypotheses and unverified reports as work", () => {
    const work = computeImplicitWork({
      hypotheses: [
        { critiques: 0, matches: 0, status: "proposed", updatedAt: 10 },
        { critiques: 1, matches: 0, status: "proposed", updatedAt: 20 },
        { critiques: 2, matches: 3, status: "rejected", updatedAt: 30 },
      ],
      report: { updatedAt: 5 },
      lastVerificationAt: null,
    });
    expect(work.get("critic")).toBe(1);
    expect(work.get("ranker")).toBe(1);
    expect(work.get("verifier")).toBe(1);
    expect(work.get("synthesizer")).toBeUndefined();

    const input = base();
    input.tasks = [];
    input.implicitWork = work;
    const plan = planSwarmCycles(input);
    expect(plan.start).toContain("c");
    expect(plan.orchestratorIdleWake).toBe(false);
  });

  it("recognises Cursor capacity errors", () => {
    expect(isCursorCapacityError("The run was rate-limited due to too many concurrent runs")).toBe(true);
    expect(isCursorCapacityError("Upgrade to Ultra to run more Cloud Agents")).toBe(true);
    expect(isCursorCapacityError("TypeError: x is undefined")).toBe(false);
  });
});
