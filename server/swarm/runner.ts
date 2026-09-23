import { nanoid } from "nanoid";
import * as db from "../db.js";
import { SdkAgentSession, type SdkStreamEvent } from "../sdkAgent.js";
import { resolveIssueCursorKey } from "../issueRunner.js";
import { log, logError, logWarn } from "../logger.js";
import { notifyEvent } from "../notify.js";
import {
  SWARM_IDLE_ORCHESTRATOR_LIMIT,
  buildBoardDigest,
  evaluateSwarmLimits,
  isTerminalSwarmStatus,
  shouldWarnBudget,
  swarmAgentUsesRepo,
} from "../../shared/swarm.js";
import * as store from "./store.js";
import { SWARM_MCP_SERVER_NAME, swarmMcpUrl } from "./mcp.js";
import { SWARM_PROMPT_VERSION, buildCyclePrompt } from "./prompts.js";
import { computeImplicitWork, isCursorCapacityError, planSwarmCycles } from "./scheduler.js";
import { swarmSignals } from "./signals.js";
import { mintSwarmAgentToken, revokeSwarmAgentToken } from "./tokens.js";
import { computeDoneGate } from "./tools.js";
import { SwarmTranscriptSink } from "./transcript.js";

const TICK_MS = 5_000;
const LEASE_MS = 90_000;
const CAPACITY_PENALTY_MS = 60_000;

function envInt(name: string, fallback: number, min: number, max: number): number {
  const raw = Number(process.env[name]);
  if (!Number.isFinite(raw)) return fallback;
  return Math.min(max, Math.max(min, Math.round(raw)));
}

/** Concurrent Cursor Cloud runs Steer allows per API-key scope (Pro plans cap at 8). */
export const SWARM_ACCOUNT_SLOTS = envInt("SWARM_ACCOUNT_SLOTS", 6, 1, 64);
/** Cycle starts per minute across all swarms (Cursor API default is ~20 req/min). */
export const SWARM_STARTS_PER_MINUTE = envInt("SWARM_STARTS_PER_MINUTE", 10, 1, 120);

function scopeKey(swarm: Pick<store.SwarmRow, "orgId" | "creatorId">): string {
  return swarm.orgId ? `org:${swarm.orgId}` : `user:${swarm.creatorId}`;
}

export function resolveSwarmCursorKey(swarm: Pick<store.SwarmRow, "orgId" | "creatorId">): string {
  return resolveIssueCursorKey({ org_id: swarm.orgId, creator_id: swarm.creatorId });
}

interface RunningCycle {
  swarmId: string;
  scope: string;
  startedAt: number;
}

export interface SwarmSessionFactory {
  (config: ConstructorParameters<typeof SdkAgentSession>[0]): Pick<
    SdkAgentSession,
    "run" | "getAgentId" | "getUsage" | "abortAndWait" | "dispose"
  >;
}

type Session = ReturnType<SwarmSessionFactory>;

export class SwarmRunner {
  readonly id = `runner_${nanoid(8)}`;
  private timer: ReturnType<typeof setInterval> | null = null;
  private ticking = false;
  private pendingKick = false;
  private readonly sessions = new Map<string, Session>();
  private readonly tokens = new Map<string, string>();
  private readonly running = new Map<string, RunningCycle>();
  private readonly startTimes: number[] = [];
  private readonly penaltyUntil = new Map<string, number>();
  private readonly recovered = new Set<string>();
  private unsubscribe: (() => void) | null = null;

  constructor(
    private readonly createSession: SwarmSessionFactory = (config) => new SdkAgentSession(config),
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    this.unsubscribe = swarmSignals.onKick(() => this.kick());
    void this.tick();
    log("swarm", "runner started", {
      runner: this.id,
      slots: SWARM_ACCOUNT_SLOTS,
      startsPerMinute: SWARM_STARTS_PER_MINUTE,
      mcpUrl: swarmMcpUrl(),
    });
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  kick(): void {
    if (this.ticking) {
      this.pendingKick = true;
      return;
    }
    setTimeout(() => void this.tick(), 50);
  }

  isRunning(agentId: string): boolean {
    return this.running.has(agentId);
  }

  runningCount(): number {
    return this.running.size;
  }

  /** Stop requested: cancel in-flight runs and revoke board access. */
  async haltSwarm(swarmId: string): Promise<void> {
    const agents = store.listSwarmAgents(swarmId);
    await Promise.all(
      agents.map(async (agent) => {
        revokeSwarmAgentToken(agent.id);
        this.tokens.delete(agent.id);
        const session = this.sessions.get(agent.id);
        if (session && this.running.has(agent.id)) {
          try {
            await session.abortAndWait();
          } catch {
            // ignore
          }
        }
        if (agent.status === "running") {
          store.updateSwarmAgent(agent.id, { status: "idle", runStartedAt: null });
        }
      }),
    );
    await this.disposeSwarmSessions(swarmId);
    store.releaseSwarmLease(swarmId, this.id);
  }

  private async disposeSwarmSessions(swarmId: string): Promise<void> {
    for (const agent of store.listSwarmAgents(swarmId)) {
      if (this.running.has(agent.id)) continue;
      const session = this.sessions.get(agent.id);
      if (!session) continue;
      this.sessions.delete(agent.id);
      try {
        await session.dispose();
      } catch {
        // ignore
      }
    }
  }

  async tick(): Promise<void> {
    if (this.ticking) {
      this.pendingKick = true;
      return;
    }
    this.ticking = true;
    try {
      const now = Date.now();
      this.reapFinishedSwarms();
      for (const swarm of store.listRunnableSwarms()) {
        try {
          this.tickSwarm(swarm, now);
        } catch (err) {
          logError("swarm", "tick failed", { swarmId: swarm.id, err });
        }
      }
    } catch (err) {
      logError("swarm", "runner tick failed", { err });
    } finally {
      this.ticking = false;
      if (this.pendingKick) {
        this.pendingKick = false;
        setTimeout(() => void this.tick(), 50);
      }
    }
  }

  /** Swarms that finished/paused elsewhere: drop cached sessions for idle agents. */
  private reapFinishedSwarms(): void {
    const swarmIds = new Set<string>();
    for (const cycle of this.running.values()) swarmIds.add(cycle.swarmId);
    for (const agentId of this.sessions.keys()) {
      const agent = store.getSwarmAgent(agentId);
      if (agent) swarmIds.add(agent.swarmId);
    }
    for (const swarmId of swarmIds) {
      const swarm = store.getSwarm(swarmId);
      if (!swarm || isTerminalSwarmStatus(swarm.status)) {
        void this.haltSwarm(swarmId);
      }
    }
  }

  private freeSlotsFor(swarm: store.SwarmRow, now: number): number {
    const scope = scopeKey(swarm);
    if ((this.penaltyUntil.get(scope) ?? 0) > now) return 0;
    let used = 0;
    for (const cycle of this.running.values()) if (cycle.scope === scope) used += 1;
    try {
      used += db.countRunningIssues({ orgId: swarm.orgId, creatorId: swarm.creatorId });
    } catch {
      // issue table unavailable — ignore
    }
    return Math.max(0, SWARM_ACCOUNT_SLOTS - used);
  }

  private startBudget(now: number): number {
    while (this.startTimes.length && now - this.startTimes[0]! > 60_000) this.startTimes.shift();
    return Math.max(0, SWARM_STARTS_PER_MINUTE - this.startTimes.length);
  }

  private tickSwarm(swarm: store.SwarmRow, now: number): void {
    if (!store.claimSwarmLease(swarm.id, this.id, now, now + LEASE_MS)) return;
    if (!this.recovered.has(swarm.id)) {
      this.recovered.add(swarm.id);
      const reset = store.resetRunningSwarmAgents(swarm.id);
      if (reset) {
        store.insertSwarmEvent({
          swarmId: swarm.id,
          kind: "recovered",
          message: `Recovered ${reset} agent(s) interrupted by a restart`,
        });
      }
    }

    this.maybeWarnBudget(swarm);
    this.mountAttachedRepo(swarm);
    const verdict = evaluateSwarmLimits(swarm, now);
    if (verdict.action !== "continue") {
      this.applyLimit(swarm, verdict);
      return;
    }

    const agents = store.listSwarmAgents(swarm.id);
    const orchestrator = agents.find((a) => a.role === "orchestrator");
    const orchSince = orchestrator?.lastCycleAt ?? 0;
    const mentions = new Map<string, number>();
    for (const agent of agents) {
      if (agent.status === "retired") continue;
      mentions.set(
        agent.id,
        store.countSwarmMentionsSince(swarm.id, agent.id, agent.label, agent.lastCycleAt ?? 0),
      );
    }
    const workerCyclesSinceOrchestrator = agents.filter(
      (a) => a.role !== "orchestrator" && (a.lastCycleAt ?? 0) > orchSince,
    ).length;
    const runningIds = new Set(agents.filter((a) => this.running.has(a.id)).map((a) => a.id));
    const freeSlots = Math.min(this.freeSlotsFor(swarm, now), this.startBudget(now));
    const report = store
      .listSwarmArtifacts(swarm.id)
      .filter((a) => a.kind === "report")
      .sort((a, b) => b.updatedAt - a.updatedAt)[0];
    const implicitWork = computeImplicitWork({
      hypotheses: store.listSwarmHypotheses(swarm.id),
      report: report ?? null,
      lastVerificationAt: store.latestSwarmEvent(swarm.id, "verification")?.createdAt ?? null,
    });

    const plan = planSwarmCycles({
      now,
      status: swarm.status,
      phase: swarm.phase,
      maxRunning: swarm.maxRunning,
      stallCount: swarm.stallCount,
      agents,
      runningIds,
      tasks: store.listSwarmTasks(swarm.id),
      mentions,
      activitySinceOrchestrator: orchestrator
        ? store.countSwarmPostsSince(swarm.id, orchSince, orchestrator.id)
        : 0,
      workerCyclesSinceOrchestrator,
      freeSlots,
      implicitWork,
    });

    if (plan.orchestratorIdleWake) {
      if (swarm.idleOrchestratorCycles >= SWARM_IDLE_ORCHESTRATOR_LIMIT) {
        this.pauseForInput(
          swarm,
          `The orchestrator went ${swarm.idleOrchestratorCycles} cycles without creating work.`,
        );
        return;
      }
    }

    for (const agentId of plan.start) {
      const agent = agents.find((a) => a.id === agentId);
      if (agent) this.startCycle(swarm, agent, plan.orchestratorIdleWake && agent.role === "orchestrator");
    }
  }

  private maybeWarnBudget(swarm: store.SwarmRow): void {
    if (swarm.budgetWarned || !shouldWarnBudget(swarm.spentUsd, swarm.budgetUsd)) return;
    store.updateSwarm(swarm.id, { budgetWarned: true });
    const text = `$${swarm.spentUsd.toFixed(2)} of $${swarm.budgetUsd.toFixed(2)} spent`;
    store.insertSwarmEvent({ swarmId: swarm.id, kind: "budget_warning", message: text });
    notifyEvent({
      kind: "swarm_update",
      title: `Swarm at 80% of budget: ${swarm.title}`,
      text: `${text}.`,
      orgId: swarm.orgId ?? undefined,
      meta: { swarmId: swarm.id },
    });
  }

  private applyLimit(
    swarm: store.SwarmRow,
    verdict: Exclude<ReturnType<typeof evaluateSwarmLimits>, { action: "continue" }>,
  ): void {
    const messages: Record<string, string> = {
      budget: `Paused: budget of $${swarm.budgetUsd.toFixed(2)} reached. Raise the budget to continue.`,
      deadline: "Stopped: deadline reached.",
      max_cycles: `Stopped: ${swarm.maxCycles} cycles reached.`,
    };
    const message = messages[verdict.reason]!;
    if (verdict.action === "pause") {
      store.updateSwarm(swarm.id, { status: "paused", stopReason: verdict.reason });
    } else {
      store.updateSwarm(swarm.id, {
        status: "stopped",
        stopReason: verdict.reason,
        finishedAt: Date.now(),
      });
    }
    store.insertSwarmEvent({ swarmId: swarm.id, kind: `limit_${verdict.reason}`, message });
    notifyEvent({
      kind: "swarm_update",
      title: `Swarm ${verdict.action === "pause" ? "paused" : "stopped"}: ${swarm.title}`,
      text: message,
      orgId: swarm.orgId ?? undefined,
      meta: { swarmId: swarm.id },
    });
    log("swarm", "limit reached", { swarmId: swarm.id, reason: verdict.reason });
    if (verdict.action === "stop") void this.haltSwarm(swarm.id);
  }

  private pauseForInput(swarm: store.SwarmRow, why: string): void {
    store.updateSwarm(swarm.id, { status: "paused", stopReason: "needs_input", idleOrchestratorCycles: 0 });
    store.insertSwarmPost({
      swarmId: swarm.id,
      authorLabel: "Steer",
      authorRole: "system",
      channel: "questions",
      kind: "question",
      bodyMd: `**Swarm paused — needs direction.** ${why} Post a directive and resume, or stop the swarm.`,
    });
    store.insertSwarmEvent({ swarmId: swarm.id, kind: "paused_idle", message: why });
    notifyEvent({
      kind: "swarm_update",
      title: `Swarm needs direction: ${swarm.title}`,
      text: why,
      orgId: swarm.orgId ?? undefined,
      meta: { swarmId: swarm.id },
    });
  }

  /** Existing research agents were created with noRepo; remount so they can read the picked repo. */
  private mountAttachedRepo(swarm: store.SwarmRow): void {
    if (!swarm.repoUrl) return;
    for (const agent of store.listSwarmAgents(swarm.id)) {
      if (agent.status === "retired" || agent.hasRepo || !swarmAgentUsesRepo(swarm, agent.role)) continue;
      const hadCursorAgent = Boolean(agent.cursorAgentId);
      store.updateSwarmAgent(agent.id, {
        hasRepo: true,
        cursorAgentId: hadCursorAgent ? null : agent.cursorAgentId,
      });
      const cached = this.sessions.get(agent.id);
      if (cached) {
        this.sessions.delete(agent.id);
        void cached.dispose();
      }
      store.insertSwarmEvent({
        swarmId: swarm.id,
        agentId: agent.id,
        kind: "repo_mounted",
        message: `Mounted ${swarm.repoUrl} for @${agent.label}${hadCursorAgent ? " (replaced the no-repo Cursor run)" : ""}`,
      });
    }
  }

  private sessionFor(swarm: store.SwarmRow, agent: store.SwarmAgentRow, apiKey: string): Session {
    const cached = this.sessions.get(agent.id);
    if (cached) return cached;
    const session = this.createSession({
      runtime: "cloud",
      apiKey,
      model: { id: swarm.modelId || "auto" },
      name: `swarm ${swarm.title.slice(0, 40)} · ${agent.label}`,
      agentId: agent.cursorAgentId,
      noRepo: !agent.hasRepo,
      repoUrl: agent.hasRepo ? swarm.repoUrl ?? undefined : undefined,
      startingRef: swarm.startingRef,
      autoCreatePR: agent.role === "integrator",
      mode: "agent",
      metadata: {
        steer_swarm_id: swarm.id,
        steer_swarm_agent_id: agent.id,
        steer_swarm_role: agent.role,
      },
      mcpServers: () => {
        const token = this.tokens.get(agent.id);
        if (!token) return undefined;
        return {
          [SWARM_MCP_SERVER_NAME]: {
            type: "http",
            url: swarmMcpUrl(),
            headers: { Authorization: `Bearer ${token}` },
          },
        };
      },
    });
    this.sessions.set(agent.id, session);
    return session;
  }

  private startCycle(swarm: store.SwarmRow, agent: store.SwarmAgentRow, idleWake: boolean): void {
    const now = Date.now();
    this.running.set(agent.id, { swarmId: swarm.id, scope: scopeKey(swarm), startedAt: now });
    this.startTimes.push(now);
    store.updateSwarmAgent(agent.id, { status: "running", runStartedAt: now });
    void this.runCycle(swarm.id, agent.id, idleWake)
      .catch((err) => logError("swarm", "cycle crashed", { swarmId: swarm.id, agentId: agent.id, err }))
      .finally(() => {
        this.running.delete(agent.id);
        this.kick();
      });
  }

  private async runCycle(swarmId: string, agentId: string, idleWake: boolean): Promise<void> {
    const swarm = store.getSwarm(swarmId);
    const agent = store.getSwarmAgent(agentId);
    if (!swarm || !agent) return;
    const cycle = agent.cycles + 1;
    const startedAt = agent.runStartedAt ?? Date.now();
    const sink = new SwarmTranscriptSink(swarm.id, agent.id, cycle);
    const before = this.orchestratorFootprint(swarm.id, agent.id);

    let apiKey: string;
    try {
      apiKey = resolveSwarmCursorKey(swarm);
    } catch (err) {
      sink.close();
      const message = err instanceof Error ? err.message : "No Cursor API key";
      store.updateSwarmAgent(agent.id, { status: "idle", runStartedAt: null, lastError: message });
      store.updateSwarm(swarm.id, { status: "paused", stopReason: "needs_key" });
      store.insertSwarmEvent({ swarmId: swarm.id, agentId: agent.id, kind: "paused_no_key", message });
      notifyEvent({
        kind: "swarm_update",
        title: `Swarm paused — no Cursor key: ${swarm.title}`,
        text: message,
        orgId: swarm.orgId ?? undefined,
        meta: { swarmId: swarm.id },
      });
      return;
    }

    try {
      this.tokens.set(agent.id, mintSwarmAgentToken(agent.id));
      const agents = store.listSwarmAgents(swarm.id);
      const tasks = store.listSwarmTasks(swarm.id);
      const prompt = buildCyclePrompt({
        swarm,
        agent,
        agents,
        tasks,
        ledger: store.getSwarmLedger(swarm.id),
        digest: buildBoardDigest({
          agentId: agent.id,
          agentLabel: agent.label,
          since: agent.lastCycleAt ?? 0,
          posts: store.listSwarmPosts(swarm.id, { limit: 300 }),
          tasks,
          hypotheses: store.listSwarmHypotheses(swarm.id),
          agents,
        }),
        gateMissing: agent.role === "orchestrator" ? computeDoneGate(swarm).missing : [],
        now: Date.now(),
      });
      sink.user(prompt);
      store.insertSwarmEvent({
        swarmId: swarm.id,
        agentId: agent.id,
        kind: "cycle_started",
        message: `@${agent.label} cycle ${cycle}`,
        meta: { promptVersion: SWARM_PROMPT_VERSION },
      });

      const session = this.sessionFor(swarm, agent, apiKey);
      await session.run(prompt, (event: SdkStreamEvent) => sink.handle(event));
      sink.close();

      const cursorAgentId = session.getAgentId();
      const usage = await session.getUsage();
      const costUsd = usage?.cost
        ? Math.max(usage.cost.rawCostCents, usage.cost.chargedCents) / 100
        : agent.spentUsd;
      const latest = store.getSwarmAgent(agent.id) ?? agent;
      const branch = sink.git?.branches?.[0]?.branch?.trim() || latest.branch;
      const failed = Boolean(sink.error);
      store.updateSwarmAgent(agent.id, {
        status: latest.status === "retired" ? "retired" : "idle",
        cursorAgentId: cursorAgentId ?? latest.cursorAgentId,
        cycles: cycle,
        lastCycleAt: Date.now(),
        runStartedAt: null,
        spentUsd: costUsd,
        tokensUsed: usage?.usage.totalTokens ?? latest.tokensUsed,
        branch: branch ?? null,
        consecutiveErrors: failed ? latest.consecutiveErrors + 1 : 0,
        lastError: failed ? sink.error : null,
      });
      store.incrementSwarmCounters(swarm.id, { cyclesDone: 1 });
      const spend = store.recomputeSwarmSpend(swarm.id);
      const afterSpend = store.getSwarm(swarm.id);
      if (afterSpend) this.maybeWarnBudget(afterSpend);

      if (failed) {
        this.handleCycleError(swarm, latest, sink.error!);
      } else {
        this.afterSuccessfulCycle(swarm, latest, startedAt, sink.finalText, before, idleWake);
      }
      store.insertSwarmEvent({
        swarmId: swarm.id,
        agentId: agent.id,
        kind: failed ? "cycle_failed" : "cycle_finished",
        message: `@${agent.label} cycle ${cycle} · ${Math.round((Date.now() - startedAt) / 1000)}s · $${spend.spentUsd.toFixed(2)} total`,
      });
    } catch (err) {
      sink.close();
      const message = err instanceof Error ? err.message : String(err);
      const latest = store.getSwarmAgent(agent.id) ?? agent;
      store.updateSwarmAgent(agent.id, {
        status: latest.status === "retired" ? "retired" : "idle",
        runStartedAt: null,
        lastCycleAt: Date.now(),
        consecutiveErrors: latest.consecutiveErrors + 1,
        lastError: message.slice(0, 2000),
      });
      this.handleCycleError(swarm, latest, message);
      store.insertSwarmEvent({
        swarmId: swarm.id,
        agentId: agent.id,
        kind: "cycle_failed",
        message: `@${agent.label}: ${message.slice(0, 300)}`,
      });
    }
  }

  private orchestratorFootprint(swarmId: string, agentId: string): number {
    const tasks = store.listSwarmTasks(swarmId).filter((t) => t.status !== "cancelled").length;
    const agents = store.listSwarmAgents(swarmId).length;
    const posts = store.countSwarmPostsSince(swarmId, 0) - store.countSwarmPostsSince(swarmId, 0, agentId);
    return tasks + agents + posts;
  }

  private afterSuccessfulCycle(
    swarm: store.SwarmRow,
    agent: store.SwarmAgentRow,
    startedAt: number,
    finalText: string,
    footprintBefore: number,
    idleWake: boolean,
  ): void {
    const fresh = store.getSwarmAgent(agent.id) ?? agent;
    const touchedBoard = (fresh.lastBoardCallAt ?? 0) >= startedAt;
    if (!touchedBoard) {
      store.insertSwarmEvent({
        swarmId: swarm.id,
        agentId: agent.id,
        kind: "no_board_contact",
        message: `@${agent.label} finished without calling the swarm board — check MCP connectivity (${swarmMcpUrl()})`,
      });
      if (finalText.trim()) {
        store.insertSwarmPost({
          swarmId: swarm.id,
          authorAgentId: agent.id,
          authorLabel: agent.label,
          authorRole: agent.role,
          channel: "findings",
          kind: "progress",
          bodyMd: `_(Relayed by Steer — this agent could not reach the board.)_\n\n${finalText.trim().slice(0, 4000)}`,
        });
      }
      logWarn("swarm", "no board contact", { swarmId: swarm.id, agentId: agent.id });
    }

    if (agent.role === "orchestrator") {
      const current = store.getSwarm(swarm.id);
      if (current?.status === "planning") {
        store.updateSwarm(swarm.id, { status: "researching" });
      }
      const changed = this.orchestratorFootprint(swarm.id, agent.id) !== footprintBefore;
      if (idleWake && !changed) {
        store.incrementSwarmCounters(swarm.id, { idleOrchestratorCycles: 1 });
      } else if (changed && current && current.idleOrchestratorCycles > 0) {
        store.updateSwarm(swarm.id, { idleOrchestratorCycles: 0 });
      }
    }
  }

  private handleCycleError(swarm: store.SwarmRow, agent: store.SwarmAgentRow, message: string): void {
    if (isCursorCapacityError(message)) {
      this.penaltyUntil.set(scopeKey(swarm), Date.now() + CAPACITY_PENALTY_MS);
      store.insertSwarmEvent({
        swarmId: swarm.id,
        agentId: agent.id,
        kind: "capacity_backoff",
        message: "Cursor reported a concurrency/rate limit — backing off for 60s",
      });
      store.updateSwarmAgent(agent.id, { consecutiveErrors: 0 });
      return;
    }
    const latest = store.getSwarmAgent(agent.id);
    if (latest && latest.consecutiveErrors >= 3) {
      store.insertSwarmEvent({
        swarmId: swarm.id,
        agentId: agent.id,
        kind: "agent_error",
        message: `@${agent.label} failed 3 cycles in a row and is parked: ${message.slice(0, 300)}`,
      });
      store.updateSwarmAgent(agent.id, { status: "error" });
      if (agent.role === "orchestrator") {
        this.pauseForInput(swarm, `The orchestrator keeps failing: ${message.slice(0, 300)}`);
      }
    }
    logWarn("swarm", "cycle error", { swarmId: swarm.id, agentId: agent.id, err: message });
  }
}

export const swarmRunner = new SwarmRunner();
