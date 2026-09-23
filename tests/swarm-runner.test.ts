import { beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "crypto";
import type { SdkStreamEvent } from "../server/sdkAgent.js";

process.env.CURSOR_API_KEY = process.env.CURSOR_API_KEY || "test-cursor-key";

let db: typeof import("../server/db.js");
let store: typeof import("../server/swarm/store.js");
let tools: typeof import("../server/swarm/tools.js");
let tokens: typeof import("../server/swarm/tokens.js");
let service: typeof import("../server/swarm/service.js");
let runnerMod: typeof import("../server/swarm/runner.js");

const userId = `user_runner_${randomUUID()}`;

type Script = (call: (name: string, args: unknown) => string, role: string, prompt: string) => void;

interface FakeConfig {
  metadata?: Record<string, string>;
  mcpServers?: () => Record<string, { headers?: Record<string, string> }> | undefined;
  noRepo?: boolean;
}

/** Simulates a Cursor Cloud agent: resolves its board token from mcpServers and calls tools. */
function fakeFactory(scripts: Record<string, Script>, opts: { costPerCycleCents?: number; failWith?: string } = {}) {
  const created: FakeConfig[] = [];
  const prompts: string[] = [];
  const factory = (config: unknown) => {
    const cfg = config as FakeConfig;
    created.push(cfg);
    let cycles = 0;
    return {
      getAgentId: () => `bc-${cfg.metadata?.steer_swarm_agent_id}`,
      async abortAndWait() {},
      async dispose() {},
      async getUsage() {
        return {
          usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: cycles * 1000 },
          cost: { rawCostCents: cycles * (opts.costPerCycleCents ?? 40), chargedCents: 0 },
          runs: [],
        };
      },
      async run(prompt: unknown, onEvent: (e: SdkStreamEvent) => void) {
        cycles += 1;
        prompts.push(String(prompt));
        if (opts.failWith) {
          onEvent({ kind: "error", message: opts.failWith });
          return;
        }
        const header = cfg.mcpServers?.()?.steer_swarm?.headers?.Authorization ?? "";
        const caller = tokens.resolveSwarmCaller(tokens.parseBearer(header));
        const role = cfg.metadata?.steer_swarm_role ?? "";
        const script = scripts[role];
        if (caller && script) {
          const call = (name: string, args: unknown) => {
            const swarm = store.getSwarm(caller.swarm.id)!;
            const agent = store.getSwarmAgent(caller.agent.id)!;
            return tools.runSwarmTool({ swarm, agent, now: Date.now() }, name, args);
          };
          onEvent({ kind: "tool_start", callId: `c${cycles}`, name: "mcp", detail: "steer_swarm" });
          script(call, role, String(prompt));
          onEvent({ kind: "tool_done", callId: `c${cycles}`, name: "mcp", detail: "ok" });
        }
        onEvent({ kind: "assistant_delta", text: `${role} cycle ${cycles} summary` });
        onEvent({ kind: "done", result: `${role} cycle ${cycles} summary` });
      },
    };
  };
  return { factory, created, prompts };
}

async function drain(runner: InstanceType<typeof runnerMod.SwarmRunner>): Promise<void> {
  for (let i = 0; i < 200 && runner.runningCount() > 0; i++) {
    await new Promise((r) => setTimeout(r, 10));
  }
}

/** Skip scheduler cooldowns without fake timers. */
function ageAgents(swarmId: string, ms = 10 * 60_000): void {
  for (const a of store.listSwarmAgents(swarmId)) {
    if (a.lastCycleAt) store.updateSwarmAgent(a.id, { lastCycleAt: a.lastCycleAt - ms });
  }
}

async function round(runner: InstanceType<typeof runnerMod.SwarmRunner>, swarmId: string): Promise<void> {
  await runner.tick();
  await drain(runner);
  ageAgents(swarmId);
}

beforeAll(async () => {
  db = await import("../server/db.js");
  store = await import("../server/swarm/store.js");
  tools = await import("../server/swarm/tools.js");
  tokens = await import("../server/swarm/tokens.js");
  service = await import("../server/swarm/service.js");
  runnerMod = await import("../server/swarm/runner.js");
  db.createUser(userId, `${userId}@example.com`, "Runner Owner", "x");
});

const ok = {
  is_request_satisfied: false,
  is_progress_being_made: true,
  is_in_loop: false,
  next_focus: "keep going",
  reason: "new findings",
};

const scripts: Record<string, Script> = {
  orchestrator: (call, _role, prompt) => {
    if (prompt.includes("First cycle")) {
      call("update_ledger", { facts: "vLLM uses PagedAttention.", plan: "Survey, critique, rank.", progress: ok });
      call("create_task", { title: "Survey KV cache", spec: "Objective: survey KV cache management. Output: findings with URLs.", kind: "research" });
      call("create_task", { title: "Survey scheduling", spec: "Objective: survey batching schedulers. Output: findings with URLs.", kind: "research" });
      call("spawn_worker", { role: "researcher", label: "scout", brief: "Research one angle deeply and propose hypotheses with evidence." });
      call("spawn_worker", { role: "critic", label: "critic", brief: "Critique each hypothesis for correctness, novelty, and feasibility." });
      call("board_post", { channel: "plan", kind: "directive", body: "Survey first, then critique." });
    } else {
      call("update_ledger", { progress: ok });
    }
  },
  researcher: (call) => {
    const list = call("task_list", { status: "pending" });
    const id = list.match(/(st_\S+) \[research · pending[^\]]*claimable by you/)?.[1];
    if (id) {
      call("task_claim", { task_id: id });
      call("hypothesis_propose", { title: `Idea from ${id}`, claim: "Disaggregate prefill and decode onto separate pools." });
      call("task_complete", { task_id: id, result: "Found evidence in DistServe (https://arxiv.org/abs/2401.09670)." });
    }
    call("notes_write", { notes: "Surveyed; next: compare schedulers." });
  },
  critic: (call) => {
    const list = call("hypothesis_list", {});
    for (const id of list.match(/sh_[\w-]+/g) ?? []) {
      call("hypothesis_critique", { hypothesis_id: id, verdict: "support", score: 7, critique: "Plausible and supported by published results." });
    }
    call("board_post", { channel: "findings", kind: "progress", body: "Critiqued the current hypotheses." });
  },
};

describe("SwarmRunner", () => {
  it("plans, spawns, schedules workers, meters cost, and pauses at the budget", async () => {
    const swarm = service.createSwarmForUser(userId, {
      goal: "Find a better way to host LLMs than a vLLM-like engine, with evidence.",
      budgetUsd: 2,
      maxWorkers: 3,
    });
    expect(swarm.status).toBe("planning");
    const fake = fakeFactory(scripts, { costPerCycleCents: 40 });
    const runner = new runnerMod.SwarmRunner(fake.factory as never);

    await round(runner, swarm.id);
    let s = store.getSwarm(swarm.id)!;
    expect(s.status).toBe("researching");
    expect(s.cyclesDone).toBe(1);
    const agents = store.listSwarmAgents(swarm.id);
    expect(agents.map((a) => a.label).sort()).toEqual(["critic", "orchestrator", "scout"]);
    expect(fake.created[0]!.noRepo).toBe(true);
    expect(fake.created[0]!.metadata?.steer_swarm_id).toBe(swarm.id);
    expect(fake.prompts[0]).toContain("<steer_swarm_rules>");
    expect(fake.prompts[0]).toContain("First cycle");
    expect(store.getSwarmAgent(agents[0]!.id)!.cursorAgentId).toBe(`bc-${agents[0]!.id}`);

    await round(runner, swarm.id);
    const tasks = store.listSwarmTasks(swarm.id);
    expect(tasks.filter((t) => t.status === "done")).toHaveLength(1);
    expect(store.listSwarmHypotheses(swarm.id)).toHaveLength(1);
    const scout = store.listSwarmAgents(swarm.id).find((a) => a.label === "scout")!;
    expect(scout.notesMd).toContain("Surveyed");
    expect(scout.cycles).toBe(1);
    expect(store.listSwarmMessages(scout.id).some((m) => m.role === "assistant")).toBe(true);

    for (let i = 0; i < 6 && store.getSwarm(swarm.id)!.status === "researching"; i++) {
      await round(runner, swarm.id);
    }
    s = store.getSwarm(swarm.id)!;
    expect(s.spentUsd).toBeGreaterThanOrEqual(2);
    expect(s.status).toBe("paused");
    expect(s.stopReason).toBe("budget");
    expect(store.listSwarmEvents(swarm.id).some((e) => e.kind === "limit_budget")).toBe(true);
    expect(store.listSwarmEvents(swarm.id).some((e) => e.kind === "budget_warning")).toBe(true);
    expect(store.listSwarmHypotheses(swarm.id).some((h) => h.critiques > 0)).toBe(true);
  });

  it("relays output when an agent never reaches the board", async () => {
    const swarm = service.createSwarmForUser(userId, {
      goal: "Research MCP connectivity failure handling for the swarm runner.",
    });
    const fake = fakeFactory({});
    const runner = new runnerMod.SwarmRunner(fake.factory as never);
    await round(runner, swarm.id);
    const events = store.listSwarmEvents(swarm.id).map((e) => e.kind);
    expect(events).toContain("no_board_contact");
    const relayed = store.listSwarmPosts(swarm.id).find((p) => p.bodyMd.includes("Relayed by Steer"));
    expect(relayed?.bodyMd).toContain("orchestrator cycle 1 summary");
  });

  it("backs off on Cursor capacity errors without burning the agent's error budget", async () => {
    const swarm = service.createSwarmForUser(userId, {
      goal: "Research how the runner handles Cursor concurrency limits gracefully.",
    });
    const fake = fakeFactory({}, { failWith: "The run was rate-limited due to too many concurrent runs." });
    const runner = new runnerMod.SwarmRunner(fake.factory as never);
    await round(runner, swarm.id);
    const orch = store.listSwarmAgents(swarm.id)[0]!;
    expect(orch.consecutiveErrors).toBe(0);
    expect(store.listSwarmEvents(swarm.id).some((e) => e.kind === "capacity_backoff")).toBe(true);
    const before = fake.prompts.length;
    await round(runner, swarm.id);
    expect(fake.prompts.length).toBe(before);
  });

  it("pauses immediately with a clear reason when no Cursor key is configured", async () => {
    const swarm = service.createSwarmForUser(userId, {
      goal: "Research how swarms behave when the workspace has no Cursor key.",
    });
    const saved = process.env.CURSOR_API_KEY;
    delete process.env.CURSOR_API_KEY;
    try {
      const fake = fakeFactory(scripts);
      const runner = new runnerMod.SwarmRunner(fake.factory as never);
      await round(runner, swarm.id);
      const s = store.getSwarm(swarm.id)!;
      expect(s.status).toBe("paused");
      expect(s.stopReason).toBe("needs_key");
      expect(fake.prompts).toHaveLength(0);
      expect(store.listSwarmEvents(swarm.id).some((e) => e.kind === "paused_no_key")).toBe(true);
    } finally {
      process.env.CURSOR_API_KEY = saved;
    }
  });

  it("recovers agents left running by a crashed process and halts on stop", async () => {
    const swarm = service.createSwarmForUser(userId, {
      goal: "Research crash recovery semantics for long-running swarms.",
    });
    const orch = store.listSwarmAgents(swarm.id)[0]!;
    store.updateSwarmAgent(orch.id, { status: "running", runStartedAt: Date.now() - 60_000 });
    const fake = fakeFactory(scripts);
    const runner = new runnerMod.SwarmRunner(fake.factory as never);
    await round(runner, swarm.id);
    expect(store.listSwarmEvents(swarm.id).some((e) => e.kind === "recovered")).toBe(true);
    expect(store.getSwarmAgent(orch.id)!.cycles).toBe(1);

    await service.stopSwarm(swarm.id, userId);
    const stopped = store.getSwarm(swarm.id)!;
    expect(stopped.status).toBe("stopped");
    const before = fake.prompts.length;
    await round(runner, swarm.id);
    expect(fake.prompts.length).toBe(before);
    for (const a of store.listSwarmAgents(swarm.id)) expect(a.tokenHash).toBeNull();
  });
});
