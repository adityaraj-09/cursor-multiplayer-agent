import { z } from "zod";
import {
  MAX_SWARM_ARTIFACT,
  MAX_SWARM_BRIEF,
  MAX_SWARM_LEDGER_FIELD,
  MAX_SWARM_NOTES,
  MAX_SWARM_POST,
  MAX_SWARM_TASK_SPEC,
  SWARM_ARTIFACT_KINDS,
  SWARM_CRITIQUE_VERDICTS,
  SWARM_HYPOTHESIS_STATUSES,
  SWARM_POST_KINDS,
  SWARM_ROLES,
  SWARM_TASK_KINDS,
  WORKER_ROLES,
  buildBoardDigest,
  evaluateDoneGate,
  extractMentions,
  isSwarmChannel,
  nextEloRatings,
  roleAllowedInPhase,
  roleNeedsRepo,
  slugifySwarmLabel,
  taskDependenciesMet,
  taskMatchesRole,
  type SwarmPostInfo,
  type SwarmRole,
} from "../../shared/swarm.js";
import { looksLikeMemoryInjection, sanitizeMemoryText } from "../../shared/roomContext.js";
import { notifyEvent } from "../notify.js";
import * as store from "./store.js";
import { swarmSignals } from "./signals.js";
import { revokeSwarmAgentToken } from "./tokens.js";

export class SwarmToolError extends Error {}

export interface SwarmToolContext {
  swarm: store.SwarmRow;
  agent: store.SwarmAgentRow;
  now: number;
}

type Shape = z.ZodRawShape;

export interface SwarmToolDef<S extends Shape = Shape> {
  name: string;
  description: string;
  roles: readonly SwarmRole[] | "all";
  input: S;
  handler: (ctx: SwarmToolContext, args: z.infer<z.ZodObject<S>>) => string;
}

function tool<S extends Shape>(def: SwarmToolDef<S>): SwarmToolDef<Shape> {
  return def as unknown as SwarmToolDef<Shape>;
}

const MAX_SPAWNS_PER_CYCLE = 3;
const ORCH: readonly SwarmRole[] = ["orchestrator"];

function clean(text: unknown, max: number): string {
  return sanitizeMemoryText(text, max);
}

function requireText(text: unknown, max: number, field: string): string {
  const out = clean(text, max);
  if (!out) throw new SwarmToolError(`${field} is required`);
  return out;
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function authorOf(ctx: SwarmToolContext) {
  return {
    authorAgentId: ctx.agent.id,
    authorLabel: ctx.agent.label,
    authorRole: ctx.agent.role,
  } as const;
}

function resolveMentions(swarmId: string, labels: string[]): string[] {
  if (!labels.length) return [];
  const agents = store.listSwarmAgents(swarmId);
  const wanted = new Set(labels.map((l) => l.replace(/^@/, "").toLowerCase()));
  const ids = agents
    .filter(
      (a) =>
        a.status !== "retired" &&
        (wanted.has(a.label.toLowerCase()) || wanted.has(a.id.toLowerCase()) || wanted.has(a.role)),
    )
    .map((a) => a.id);
  return [...new Set(ids)];
}

function formatPost(p: SwarmPostInfo, max = 1500): string {
  const when = new Date(p.createdAt).toISOString();
  const refs = p.refs.length ? ` refs=${p.refs.join(",")}` : "";
  return `- ${p.id} · ${when} · #${p.channel} · ${p.kind} · ${p.authorLabel} (${p.authorRole})${refs}\n  ${clip(p.bodyMd, max).replace(/\n/g, "\n  ")}`;
}

function post(
  ctx: SwarmToolContext,
  input: {
    channel: string;
    kind: SwarmPostInfo["kind"];
    body: string;
    refs?: string[];
    mentions?: string[];
  },
): SwarmPostInfo {
  const created = store.insertSwarmPost({
    swarmId: ctx.swarm.id,
    ...authorOf(ctx),
    channel: input.channel,
    kind: input.kind,
    bodyMd: input.body,
    refs: input.refs,
    mentions: input.mentions,
  });
  if (input.mentions?.length) swarmSignals.kick(ctx.swarm.id);
  return created;
}

function openBuildTasks(swarmId: string): number {
  return store
    .listSwarmTasks(swarmId)
    .filter((t) => (t.kind === "build" || t.kind === "integrate") && (t.status === "pending" || t.status === "claimed"))
    .length;
}

function latestReport(swarmId: string) {
  return store
    .listSwarmArtifacts(swarmId)
    .filter((a) => a.kind === "report")
    .sort((a, b) => b.updatedAt - a.updatedAt)[0];
}

export function computeDoneGate(swarm: store.SwarmRow) {
  const report = latestReport(swarm.id);
  const verification = store.latestSwarmEvent(swarm.id, "verification");
  const latestVerificationPassed =
    verification && report && verification.createdAt >= report.updatedAt
      ? verification.meta?.passed === true
      : null;
  const critiqued = store.listSwarmHypotheses(swarm.id).filter((h) => h.critiques > 0).length;
  return evaluateDoneGate({
    phase: swarm.phase,
    hasReport: Boolean(report),
    critiquedHypotheses: critiqued,
    latestVerificationPassed,
    openBuildTasks: openBuildTasks(swarm.id),
  });
}

export const SWARM_TOOLS: SwarmToolDef[] = [
  tool({
    name: "team_list",
    description: "List the swarm's agents (label, role, status, current task). Use labels for @mentions.",
    roles: "all",
    input: {},
    handler: (ctx) => {
      const agents = store.listSwarmAgents(ctx.swarm.id).filter((a) => a.status !== "retired");
      return agents
        .map(
          (a) =>
            `- @${a.label} (${a.id}) — ${a.role} · ${a.status}${a.currentTaskId ? ` · task ${a.currentTaskId}` : ""}${a.id === ctx.agent.id ? " · you" : ""}`,
        )
        .join("\n");
    },
  }),
  tool({
    name: "board_digest",
    description:
      "Compact summary of the board for you: directives, decisions, posts addressed to you, new findings, leaderboard, open tasks.",
    roles: "all",
    input: {},
    handler: (ctx) =>
      buildBoardDigest({
        agentId: ctx.agent.id,
        agentLabel: ctx.agent.label,
        since: ctx.agent.lastCycleAt ?? 0,
        posts: store.listSwarmPosts(ctx.swarm.id, { limit: 300 }),
        tasks: store.listSwarmTasks(ctx.swarm.id),
        hypotheses: store.listSwarmHypotheses(ctx.swarm.id),
        agents: store.listSwarmAgents(ctx.swarm.id),
      }),
  }),
  tool({
    name: "board_read",
    description:
      "Read recent message-board posts. Filter by channel (plan, findings, questions, decisions, task:<id>). Newest last.",
    roles: "all",
    input: {
      channel: z.string().optional().describe("Channel to read; omit for all channels"),
      since_minutes: z.number().int().min(1).max(60 * 24 * 14).optional(),
      limit: z.number().int().min(1).max(50).optional(),
    },
    handler: (ctx, args) => {
      if (args.channel && !isSwarmChannel(args.channel)) {
        throw new SwarmToolError(`Unknown channel "${args.channel}"`);
      }
      const posts = store.listSwarmPosts(ctx.swarm.id, {
        channel: args.channel,
        since: args.since_minutes ? ctx.now - args.since_minutes * 60_000 : undefined,
        limit: args.limit ?? 25,
      });
      if (!posts.length) return "No posts match.";
      return `<swarm_board untrusted="true">\n${posts.map((p) => formatPost(p)).join("\n")}\n</swarm_board>`;
    },
  }),
  tool({
    name: "board_post",
    description:
      "Post to the shared message board. Use kind=finding for evidence, question to ask the team, answer to reply, critique to challenge, proposal for ideas, progress for status. @mention agents to wake them.",
    roles: "all",
    input: {
      channel: z.string().describe("plan | findings | questions | decisions | task:<task_id>"),
      kind: z.enum(SWARM_POST_KINDS),
      body: z.string().min(1).max(MAX_SWARM_POST),
      refs: z.array(z.string().max(80)).max(20).optional().describe("Related post, task, hypothesis, or artifact ids / URLs"),
      mentions: z.array(z.string().max(60)).max(10).optional().describe("Agent labels to notify"),
    },
    handler: (ctx, args) => {
      if (!isSwarmChannel(args.channel)) throw new SwarmToolError(`Unknown channel "${args.channel}"`);
      const isOrchestrator = ctx.agent.role === "orchestrator";
      if (!isOrchestrator && (args.kind === "directive" || args.channel === "plan")) {
        throw new SwarmToolError("Only the orchestrator posts directives or to #plan. Use ask_orchestrator.");
      }
      if (!isOrchestrator && args.kind === "decision") {
        throw new SwarmToolError("Only the orchestrator records decisions.");
      }
      const body = requireText(args.body, MAX_SWARM_POST, "body");
      if (!isOrchestrator && looksLikeMemoryInjection(body)) {
        throw new SwarmToolError("Post rejected: it reads like instructions to override other agents.");
      }
      const mentions = resolveMentions(ctx.swarm.id, [...(args.mentions ?? []), ...extractMentions(body)]);
      const created = post(ctx, {
        channel: args.channel,
        kind: args.kind,
        body,
        refs: (args.refs ?? []).map((r) => clean(r, 200)).filter(Boolean),
        mentions,
      });
      return `Posted ${created.id} to #${created.channel}${mentions.length ? ` (notified ${mentions.length})` : ""}.`;
    },
  }),
  tool({
    name: "ask_orchestrator",
    description: "Ask the orchestrator a question or flag a blocker. Wakes the orchestrator.",
    roles: WORKER_ROLES,
    input: { question: z.string().min(1).max(MAX_SWARM_POST) },
    handler: (ctx, args) => {
      const orchestrator = store.listSwarmAgents(ctx.swarm.id).find((a) => a.role === "orchestrator");
      const created = post(ctx, {
        channel: "questions",
        kind: "question",
        body: requireText(args.question, MAX_SWARM_POST, "question"),
        mentions: orchestrator ? [orchestrator.id] : [],
      });
      return `Asked the orchestrator (${created.id}).`;
    },
  }),
  tool({
    name: "request_human",
    description:
      "Escalate to the humans who own this swarm (Slack/notification). Orchestrator may set blocking=true to pause the swarm until they answer.",
    roles: "all",
    input: {
      question: z.string().min(1).max(MAX_SWARM_POST),
      blocking: z.boolean().optional(),
    },
    handler: (ctx, args) => {
      const body = requireText(args.question, MAX_SWARM_POST, "question");
      const blocking = Boolean(args.blocking) && ctx.agent.role === "orchestrator";
      post(ctx, { channel: "questions", kind: "question", body: `**Human input requested:** ${body}` });
      store.insertSwarmEvent({
        swarmId: ctx.swarm.id,
        agentId: ctx.agent.id,
        kind: "human_requested",
        message: clip(body, 500),
        meta: { blocking },
      });
      if (blocking) {
        store.updateSwarm(ctx.swarm.id, { status: "paused", stopReason: "needs_input" });
      }
      notifyEvent({
        kind: "swarm_update",
        title: `Swarm needs input: ${ctx.swarm.title}`,
        text: clip(body, 900),
        orgId: ctx.swarm.orgId ?? undefined,
        meta: { swarmId: ctx.swarm.id, blocking },
      });
      return blocking ? "Humans notified. The swarm is paused until they respond." : "Humans notified.";
    },
  }),
  tool({
    name: "task_list",
    description: "List tasks. Claim a pending task that matches your role before working on it.",
    roles: "all",
    input: {
      status: z.enum(["pending", "claimed", "done", "failed", "cancelled", "open"]).optional(),
      mine: z.boolean().optional(),
    },
    handler: (ctx, args) => {
      const tasks = store.listSwarmTasks(ctx.swarm.id);
      const byId = new Map(tasks.map((t) => [t.id, t]));
      const filtered = tasks.filter((t) => {
        if (args.mine && t.ownerAgentId !== ctx.agent.id) return false;
        if (args.status === "open") return t.status === "pending" || t.status === "claimed";
        if (args.status) return t.status === args.status;
        return true;
      });
      if (!filtered.length) return "No tasks match.";
      return filtered
        .slice(0, 40)
        .map((t) => {
          const ready = t.status === "pending" && taskDependenciesMet(t, byId);
          const forYou = t.status === "pending" && ready && taskMatchesRole(t, ctx.agent.role);
          return `- ${t.id} [${t.kind} · ${t.status}${t.roleHint ? ` · for ${t.roleHint}` : ""}${t.blockedBy.length ? ` · blocked_by ${t.blockedBy.join(",")}` : ""}${forYou ? " · claimable by you" : ""}] p${t.priority} ${t.title}\n  ${clip(t.spec.replace(/\n/g, " "), 400)}`;
        })
        .join("\n");
    },
  }),
  tool({
    name: "task_claim",
    description: "Claim a pending task for your role. You may hold one claimed task at a time.",
    roles: WORKER_ROLES,
    input: { task_id: z.string().min(3).max(60) },
    handler: (ctx, args) => {
      const task = store.getSwarmTask(args.task_id);
      if (!task || task.swarmId !== ctx.swarm.id) throw new SwarmToolError("Task not found");
      if (task.status !== "pending") throw new SwarmToolError(`Task is ${task.status}`);
      if (!taskMatchesRole(task, ctx.agent.role)) {
        throw new SwarmToolError(`Task is for ${task.roleHint || task.kind}, not ${ctx.agent.role}`);
      }
      const all = store.listSwarmTasks(ctx.swarm.id);
      if (!taskDependenciesMet(task, new Map(all.map((t) => [t.id, t])))) {
        throw new SwarmToolError(`Blocked by ${task.blockedBy.join(", ")}`);
      }
      const held = all.find((t) => t.ownerAgentId === ctx.agent.id && t.status === "claimed");
      if (held) throw new SwarmToolError(`You already hold ${held.id}; complete it first`);
      const claimed = store.claimSwarmTask(task.id, ctx.agent.id);
      if (!claimed) throw new SwarmToolError("Another agent claimed it first");
      store.updateSwarmAgent(ctx.agent.id, { currentTaskId: claimed.id });
      return `Claimed ${claimed.id}: ${claimed.title}\n\nSpec:\n${claimed.spec}`;
    },
  }),
  tool({
    name: "task_complete",
    description:
      "Finish your claimed task with a self-contained result (what you found/built, evidence, links). Use status=failed with the reason if blocked.",
    roles: WORKER_ROLES,
    input: {
      task_id: z.string().min(3).max(60),
      result: z.string().min(1).max(MAX_SWARM_POST),
      status: z.enum(["done", "failed"]).optional(),
    },
    handler: (ctx, args) => {
      const task = store.getSwarmTask(args.task_id);
      if (!task || task.swarmId !== ctx.swarm.id) throw new SwarmToolError("Task not found");
      if (task.ownerAgentId !== ctx.agent.id || task.status !== "claimed") {
        throw new SwarmToolError("You do not hold this task");
      }
      const status = args.status ?? "done";
      const result = requireText(args.result, MAX_SWARM_POST, "result");
      store.updateSwarmTask(task.id, { status, resultMd: result, completedAt: ctx.now });
      store.updateSwarmAgent(ctx.agent.id, { currentTaskId: null });
      post(ctx, {
        channel: `task:${task.id}`,
        kind: status === "done" ? "finding" : "progress",
        body: `**${status === "done" ? "Completed" : "Failed"}: ${task.title}**\n\n${result}`,
        refs: [task.id],
      });
      swarmSignals.kick(ctx.swarm.id);
      return `Task ${task.id} marked ${status}.`;
    },
  }),
  tool({
    name: "notes_write",
    description:
      "Replace your private working notes. They are shown to you at the start of every cycle — keep what you learned, what you tried, and what to do next.",
    roles: "all",
    input: { notes: z.string().max(MAX_SWARM_NOTES) },
    handler: (ctx, args) => {
      store.updateSwarmAgent(ctx.agent.id, { notesMd: clean(args.notes, MAX_SWARM_NOTES) });
      return "Notes saved.";
    },
  }),
  tool({
    name: "ledger_read",
    description: "Read the orchestrator's task ledger: verified facts, educated guesses, plan, open questions, latest progress check.",
    roles: "all",
    input: {},
    handler: (ctx) => {
      const ledger = store.getSwarmLedger(ctx.swarm.id);
      if (!ledger) return "The ledger is empty — the orchestrator has not planned yet.";
      return [
        `Revision ${ledger.revision}`,
        `## Facts\n${ledger.factsMd || "_none_"}`,
        `## Educated guesses\n${ledger.guessesMd || "_none_"}`,
        `## Plan\n${ledger.planMd || "_none_"}`,
        `## Open questions\n${ledger.openQuestionsMd || "_none_"}`,
        ledger.progress ? `## Latest progress check\n${JSON.stringify(ledger.progress)}` : "",
      ]
        .filter(Boolean)
        .join("\n\n");
    },
  }),
  tool({
    name: "artifact_put",
    description:
      "Save a durable text artifact (markdown, CSV, JSON, code excerpt). Same name overwrites. The synthesizer's final report must use kind=report.",
    roles: "all",
    input: {
      name: z.string().min(1).max(120).describe("File-like name, e.g. report.md or survey/paged-attention.md"),
      kind: z.enum(SWARM_ARTIFACT_KINDS),
      content: z.string().min(1).max(MAX_SWARM_ARTIFACT),
    },
    handler: (ctx, args) => {
      const name = requireText(args.name, 120, "name").replace(/[^\w./-]+/g, "-");
      if (args.kind === "report" && !["synthesizer", "orchestrator"].includes(ctx.agent.role)) {
        throw new SwarmToolError("Only the synthesizer or orchestrator writes report artifacts");
      }
      const saved = store.upsertSwarmArtifact({
        swarmId: ctx.swarm.id,
        agentId: ctx.agent.id,
        kind: args.kind,
        name,
        content: clean(args.content, MAX_SWARM_ARTIFACT),
      });
      store.insertSwarmEvent({
        swarmId: ctx.swarm.id,
        agentId: ctx.agent.id,
        kind: "artifact_saved",
        message: `${saved.kind}: ${saved.name}`,
      });
      return `Saved artifact ${saved.id} (${saved.name}, ${saved.size} bytes).`;
    },
  }),
  tool({
    name: "artifact_list",
    description: "List saved artifacts.",
    roles: "all",
    input: {},
    handler: (ctx) => {
      const items = store.listSwarmArtifacts(ctx.swarm.id);
      if (!items.length) return "No artifacts yet.";
      return items.map((a) => `- ${a.name} (${a.kind}, ${a.size} bytes, ${a.id})`).join("\n");
    },
  }),
  tool({
    name: "artifact_get",
    description: "Read an artifact by name or id.",
    roles: "all",
    input: { name: z.string().min(1).max(120) },
    handler: (ctx, args) => {
      const a = store.getSwarmArtifactContent(ctx.swarm.id, args.name);
      if (!a) throw new SwarmToolError("Artifact not found");
      return `# ${a.name} (${a.kind})\n\n${clip(a.content, 60_000)}`;
    },
  }),
  tool({
    name: "hypothesis_list",
    description: "Hypothesis leaderboard ordered by Elo, with critique counts and ids.",
    roles: "all",
    input: {
      include_rejected: z.boolean().optional(),
      detail: z.boolean().optional().describe("Include claims and evidence"),
    },
    handler: (ctx, args) => {
      const items = store
        .listSwarmHypotheses(ctx.swarm.id)
        .filter((h) => args.include_rejected || h.status !== "rejected");
      if (!items.length) return "No hypotheses yet.";
      return items
        .slice(0, 40)
        .map((h, i) => {
          const head = `${i + 1}. ${h.id} · Elo ${Math.round(h.elo)} · ${h.wins}/${h.matches} wins · ${h.critiques} critiques · ${h.status}\n   ${h.title}`;
          return args.detail
            ? `${head}\n   Claim: ${clip(h.claimMd, 800)}\n   Evidence: ${clip(h.evidenceMd, 800)}`
            : head;
        })
        .join("\n");
    },
  }),
  tool({
    name: "hypothesis_propose",
    description:
      "Propose a hypothesis / candidate approach with evidence. Set parent_ids when you refine or combine existing hypotheses (evolution).",
    roles: ["researcher", "synthesizer", "orchestrator"],
    input: {
      title: z.string().min(3).max(200),
      claim: z.string().min(10).max(MAX_SWARM_POST),
      evidence: z.string().max(MAX_SWARM_POST).optional(),
      parent_ids: z.array(z.string().max(60)).max(5).optional(),
    },
    handler: (ctx, args) => {
      const parents = (args.parent_ids ?? []).filter((id) => {
        const h = store.getSwarmHypothesis(id);
        return h && h.swarmId === ctx.swarm.id;
      });
      const h = store.createSwarmHypothesis({
        swarmId: ctx.swarm.id,
        title: requireText(args.title, 200, "title"),
        claimMd: requireText(args.claim, MAX_SWARM_POST, "claim"),
        evidenceMd: clean(args.evidence ?? "", MAX_SWARM_POST),
        parentIds: parents,
        authorAgentId: ctx.agent.id,
      });
      post(ctx, {
        channel: "findings",
        kind: "proposal",
        body: `**Hypothesis ${h.id}: ${h.title}**\n\n${clip(h.claimMd, 1200)}`,
        refs: [h.id, ...parents],
      });
      return `Recorded hypothesis ${h.id} (Elo ${h.elo}).`;
    },
  }),
  tool({
    name: "hypothesis_critique",
    description:
      "Peer-review a hypothesis: correctness, novelty, feasibility, and whether the evidence holds. Score 1–10.",
    roles: ["critic", "verifier"],
    input: {
      hypothesis_id: z.string().min(3).max(60),
      verdict: z.enum(SWARM_CRITIQUE_VERDICTS),
      score: z.number().int().min(1).max(10),
      critique: z.string().min(10).max(MAX_SWARM_POST),
    },
    handler: (ctx, args) => {
      const h = store.getSwarmHypothesis(args.hypothesis_id);
      if (!h || h.swarmId !== ctx.swarm.id) throw new SwarmToolError("Hypothesis not found");
      const critique = store.insertSwarmCritique({
        swarmId: ctx.swarm.id,
        hypothesisId: h.id,
        authorAgentId: ctx.agent.id,
        verdict: args.verdict,
        score: args.score,
        bodyMd: requireText(args.critique, MAX_SWARM_POST, "critique"),
      });
      post(ctx, {
        channel: "findings",
        kind: "critique",
        body: `**Critique of ${h.id} (${args.verdict}, ${args.score}/10):** ${clip(critique.bodyMd, 1200)}`,
        refs: [h.id],
        mentions: h.authorAgentId ? [h.authorAgentId] : [],
      });
      return `Critique ${critique.id} recorded.`;
    },
  }),
  tool({
    name: "record_match",
    description:
      "Tournament judgment between two hypotheses after a head-to-head debate. Updates Elo ratings.",
    roles: ["ranker"],
    input: {
      hypothesis_a: z.string().min(3).max(60),
      hypothesis_b: z.string().min(3).max(60),
      winner: z.enum(["a", "b", "draw"]),
      rationale: z.string().min(10).max(MAX_SWARM_POST),
    },
    handler: (ctx, args) => {
      if (args.hypothesis_a === args.hypothesis_b) throw new SwarmToolError("Pick two different hypotheses");
      const a = store.getSwarmHypothesis(args.hypothesis_a);
      const b = store.getSwarmHypothesis(args.hypothesis_b);
      if (!a || !b || a.swarmId !== ctx.swarm.id || b.swarmId !== ctx.swarm.id) {
        throw new SwarmToolError("Hypothesis not found");
      }
      if (store.countSwarmMatchesBetween(ctx.swarm.id, a.id, b.id) >= 3) {
        throw new SwarmToolError("This pair has already been judged 3 times — pick a fresher pairing");
      }
      const next = nextEloRatings(a.elo, b.elo, args.winner);
      store.insertSwarmMatch({
        swarmId: ctx.swarm.id,
        hypothesisA: a.id,
        hypothesisB: b.id,
        winner: args.winner,
        rationale: clean(args.rationale, MAX_SWARM_POST),
        judgeAgentId: ctx.agent.id,
      });
      store.updateSwarmHypothesis(a.id, {
        elo: next.a,
        matches: a.matches + 1,
        wins: a.wins + (args.winner === "a" ? 1 : 0),
      });
      store.updateSwarmHypothesis(b.id, {
        elo: next.b,
        matches: b.matches + 1,
        wins: b.wins + (args.winner === "b" ? 1 : 0),
      });
      return `Match recorded. ${a.id}: ${Math.round(a.elo)}→${Math.round(next.a)}, ${b.id}: ${Math.round(b.elo)}→${Math.round(next.b)}.`;
    },
  }),
  tool({
    name: "verify_result",
    description:
      "Independent verification of the latest report (and, in build phase, the integration branch). passed=true only if claims are supported and nothing required is missing.",
    roles: ["verifier"],
    input: {
      target: z.string().min(1).max(200),
      passed: z.boolean(),
      notes: z.string().min(10).max(MAX_SWARM_POST),
    },
    handler: (ctx, args) => {
      const notes = requireText(args.notes, MAX_SWARM_POST, "notes");
      store.insertSwarmEvent({
        swarmId: ctx.swarm.id,
        agentId: ctx.agent.id,
        kind: "verification",
        message: `${args.passed ? "PASS" : "FAIL"} · ${clip(args.target, 120)}`,
        meta: { passed: args.passed, target: args.target },
      });
      const orchestrator = store.listSwarmAgents(ctx.swarm.id).find((a) => a.role === "orchestrator");
      post(ctx, {
        channel: "decisions",
        kind: "critique",
        body: `**Verification ${args.passed ? "passed" : "failed"}** for ${args.target}\n\n${notes}`,
        mentions: orchestrator ? [orchestrator.id] : [],
      });
      return `Verification recorded (${args.passed ? "pass" : "fail"}).`;
    },
  }),
  tool({
    name: "create_task",
    description:
      "Create a task on the shared task graph. Give each task an objective, expected output format, source hints, and clear boundaries.",
    roles: ORCH,
    input: {
      title: z.string().min(3).max(200),
      spec: z.string().min(10).max(MAX_SWARM_TASK_SPEC),
      kind: z.enum(SWARM_TASK_KINDS),
      role_hint: z.enum(SWARM_ROLES).optional(),
      blocked_by: z.array(z.string().max(60)).max(10).optional(),
      priority: z.number().int().min(0).max(5).optional().describe("0 = most urgent"),
    },
    handler: (ctx, args) => {
      if ((args.kind === "build" || args.kind === "integrate") && ctx.swarm.phase !== "build") {
        throw new SwarmToolError("Build tasks are only allowed after the research report is approved");
      }
      const existing = new Set(store.listSwarmTasks(ctx.swarm.id).map((t) => t.id));
      const blockedBy = (args.blocked_by ?? []).filter((id) => existing.has(id));
      const task = store.createSwarmTask({
        swarmId: ctx.swarm.id,
        title: requireText(args.title, 200, "title"),
        spec: requireText(args.spec, MAX_SWARM_TASK_SPEC, "spec"),
        kind: args.kind,
        roleHint: args.role_hint && args.role_hint !== "orchestrator" ? args.role_hint : null,
        blockedBy,
        priority: args.priority ?? 2,
        createdBy: ctx.agent.id,
      });
      swarmSignals.kick(ctx.swarm.id);
      return `Created ${task.id} (${task.kind}${task.roleHint ? ` for ${task.roleHint}` : ""}).`;
    },
  }),
  tool({
    name: "update_task",
    description: "Reprioritise, respec, cancel, or reopen a task.",
    roles: ORCH,
    input: {
      task_id: z.string().min(3).max(60),
      status: z.enum(["pending", "cancelled"]).optional(),
      priority: z.number().int().min(0).max(5).optional(),
      spec: z.string().max(MAX_SWARM_TASK_SPEC).optional(),
    },
    handler: (ctx, args) => {
      const task = store.getSwarmTask(args.task_id);
      if (!task || task.swarmId !== ctx.swarm.id) throw new SwarmToolError("Task not found");
      const patch: Parameters<typeof store.updateSwarmTask>[1] = {};
      if (args.status === "cancelled") patch.status = "cancelled";
      if (args.status === "pending") {
        patch.status = "pending";
        patch.ownerAgentId = null;
      }
      if (args.priority !== undefined) patch.priority = args.priority;
      if (args.spec) patch.spec = clean(args.spec, MAX_SWARM_TASK_SPEC);
      store.updateSwarmTask(task.id, patch);
      if (task.ownerAgentId && patch.status) {
        store.updateSwarmAgent(task.ownerAgentId, { currentTaskId: null });
      }
      return `Updated ${task.id}.`;
    },
  }),
  tool({
    name: "spawn_worker",
    description:
      "Request a new worker. The runner enforces the worker cap and phase rules. The brief must state the objective, output format, sources, and boundaries.",
    roles: ORCH,
    input: {
      role: z.enum(SWARM_ROLES),
      label: z.string().min(2).max(32).describe("Short handle for @mentions, e.g. kernels-scout"),
      brief: z.string().min(40).max(MAX_SWARM_BRIEF),
    },
    handler: (ctx, args) => {
      if (args.role === "orchestrator") throw new SwarmToolError("There is exactly one orchestrator");
      if (!roleAllowedInPhase(args.role, ctx.swarm.phase)) {
        throw new SwarmToolError(`${args.role} is only available in the build phase`);
      }
      if (roleNeedsRepo(args.role) && !ctx.swarm.repoUrl) {
        throw new SwarmToolError("This swarm has no repository; code roles cannot be spawned");
      }
      const agents = store.listSwarmAgents(ctx.swarm.id);
      const liveWorkers = agents.filter((a) => a.role !== "orchestrator" && a.status !== "retired");
      if (liveWorkers.length >= ctx.swarm.maxWorkers) {
        throw new SwarmToolError(
          `Worker cap reached (${ctx.swarm.maxWorkers}). Retire a worker or reuse an existing one.`,
        );
      }
      const cycleStart = ctx.agent.runStartedAt ?? ctx.now;
      const spawnedThisCycle = agents.filter(
        (a) => a.spawnedBy === ctx.agent.id && a.createdAt >= cycleStart,
      ).length;
      if (spawnedThisCycle >= MAX_SPAWNS_PER_CYCLE) {
        throw new SwarmToolError(`At most ${MAX_SPAWNS_PER_CYCLE} spawns per cycle`);
      }
      const base = slugifySwarmLabel(args.label, args.role);
      const taken = new Set(agents.map((a) => a.label.toLowerCase()));
      let label = base;
      for (let i = 2; taken.has(label); i++) label = `${base}-${i}`;
      const agent = store.createSwarmAgent({
        swarmId: ctx.swarm.id,
        role: args.role,
        label,
        brief: requireText(args.brief, MAX_SWARM_BRIEF, "brief"),
        hasRepo: roleNeedsRepo(args.role),
        spawnedBy: ctx.agent.id,
      });
      store.insertSwarmEvent({
        swarmId: ctx.swarm.id,
        agentId: agent.id,
        kind: "agent_spawned",
        message: `@${agent.label} (${agent.role})`,
      });
      swarmSignals.kick(ctx.swarm.id);
      return `Spawned @${agent.label} (${agent.id}, ${agent.role}). It starts on its next scheduled cycle.`;
    },
  }),
  tool({
    name: "retire_worker",
    description: "Retire a worker that is done or on a dead end. Its claimed tasks return to the pool.",
    roles: ORCH,
    input: {
      agent_id: z.string().min(3).max(60).describe("Agent id or label"),
      reason: z.string().min(3).max(1000),
    },
    handler: (ctx, args) => {
      const target = store
        .listSwarmAgents(ctx.swarm.id)
        .find((a) => a.id === args.agent_id || a.label.toLowerCase() === args.agent_id.replace(/^@/, "").toLowerCase());
      if (!target) throw new SwarmToolError("Agent not found");
      if (target.role === "orchestrator") throw new SwarmToolError("The orchestrator cannot be retired");
      if (target.status === "retired") return `@${target.label} is already retired.`;
      store.updateSwarmAgent(target.id, { status: "retired", currentTaskId: null });
      store.releaseSwarmTasksFor(target.id);
      revokeSwarmAgentToken(target.id);
      store.insertSwarmEvent({
        swarmId: ctx.swarm.id,
        agentId: target.id,
        kind: "agent_retired",
        message: clip(clean(args.reason, 1000), 300),
      });
      return `Retired @${target.label}.`;
    },
  }),
  tool({
    name: "update_ledger",
    description:
      "Update the task ledger (facts, guesses, plan, open questions) and record this round's progress check. Every orchestrator cycle must call this with `progress`.",
    roles: ORCH,
    input: {
      facts: z.string().max(MAX_SWARM_LEDGER_FIELD).optional(),
      guesses: z.string().max(MAX_SWARM_LEDGER_FIELD).optional(),
      plan: z.string().max(MAX_SWARM_LEDGER_FIELD).optional(),
      open_questions: z.string().max(MAX_SWARM_LEDGER_FIELD).optional(),
      progress: z
        .object({
          is_request_satisfied: z.boolean(),
          is_progress_being_made: z.boolean(),
          is_in_loop: z.boolean(),
          next_focus: z.string().max(1000),
          reason: z.string().max(2000),
        })
        .optional(),
    },
    handler: (ctx, args) => {
      const progress = args.progress
        ? {
            isRequestSatisfied: args.progress.is_request_satisfied,
            isProgressBeingMade: args.progress.is_progress_being_made,
            isInLoop: args.progress.is_in_loop,
            nextFocus: clean(args.progress.next_focus, 1000),
            reason: clean(args.progress.reason, 2000),
          }
        : undefined;
      const ledger = store.saveSwarmLedger(
        ctx.swarm.id,
        {
          factsMd: args.facts !== undefined ? clean(args.facts, MAX_SWARM_LEDGER_FIELD) : undefined,
          guessesMd: args.guesses !== undefined ? clean(args.guesses, MAX_SWARM_LEDGER_FIELD) : undefined,
          planMd: args.plan !== undefined ? clean(args.plan, MAX_SWARM_LEDGER_FIELD) : undefined,
          openQuestionsMd:
            args.open_questions !== undefined ? clean(args.open_questions, MAX_SWARM_LEDGER_FIELD) : undefined,
          progress,
        },
        ctx.agent.id,
      );
      if (progress) {
        const stalled = !progress.isProgressBeingMade || progress.isInLoop;
        const stallCount = stalled ? ctx.swarm.stallCount + 1 : 0;
        store.updateSwarm(ctx.swarm.id, { stallCount });
        if (stalled) {
          store.insertSwarmEvent({
            swarmId: ctx.swarm.id,
            agentId: ctx.agent.id,
            kind: "stall",
            message: `Stall ${stallCount}: ${clip(progress.reason, 200)}`,
          });
        }
      }
      return `Ledger revision ${ledger.revision} saved.`;
    },
  }),
  tool({
    name: "set_hypothesis_status",
    description: "Promote a hypothesis for deeper work, or reject a dead end.",
    roles: ORCH,
    input: {
      hypothesis_id: z.string().min(3).max(60),
      status: z.enum(SWARM_HYPOTHESIS_STATUSES),
      reason: z.string().max(1000).optional(),
    },
    handler: (ctx, args) => {
      const h = store.getSwarmHypothesis(args.hypothesis_id);
      if (!h || h.swarmId !== ctx.swarm.id) throw new SwarmToolError("Hypothesis not found");
      store.updateSwarmHypothesis(h.id, { status: args.status });
      post(ctx, {
        channel: "decisions",
        kind: "decision",
        body: `Hypothesis ${h.id} → **${args.status}**${args.reason ? `: ${clean(args.reason, 1000)}` : ""}`,
        refs: [h.id],
      });
      return `Hypothesis ${h.id} is now ${args.status}.`;
    },
  }),
  tool({
    name: "request_phase_change",
    description:
      "After the research report exists, ask the humans to approve moving to the build phase (code on branches + PR). Pauses scheduling until they decide.",
    roles: ORCH,
    input: {
      summary: z.string().min(40).max(MAX_SWARM_POST).describe("What will be built, why, and the plan"),
    },
    handler: (ctx, args) => {
      if (ctx.swarm.phase === "build") throw new SwarmToolError("Already in the build phase");
      if (!ctx.swarm.repoUrl) {
        throw new SwarmToolError("This swarm has no repository. Finish with declare_done instead.");
      }
      if (!latestReport(ctx.swarm.id)) {
        throw new SwarmToolError("Write a `report` artifact (synthesizer) before requesting the build phase");
      }
      const summary = requireText(args.summary, MAX_SWARM_POST, "summary");
      store.updateSwarm(ctx.swarm.id, { status: "awaiting_approval", approvalNote: summary });
      post(ctx, { channel: "decisions", kind: "decision", body: `**Requesting build approval**\n\n${summary}` });
      store.insertSwarmEvent({
        swarmId: ctx.swarm.id,
        agentId: ctx.agent.id,
        kind: "approval_requested",
        message: clip(summary, 300),
      });
      notifyEvent({
        kind: "swarm_update",
        title: `Swarm ready for build approval: ${ctx.swarm.title}`,
        text: clip(summary, 900),
        orgId: ctx.swarm.orgId ?? undefined,
        meta: { swarmId: ctx.swarm.id },
      });
      return "Approval requested. Scheduling pauses until a human approves or sends it back.";
    },
  }),
  tool({
    name: "declare_done",
    description:
      "Finish the swarm. Rejected unless a report exists, enough hypotheses were critiqued, the verifier passed the latest report, and (build phase) no build tasks are open.",
    roles: ORCH,
    input: { summary: z.string().min(40).max(MAX_SWARM_POST) },
    handler: (ctx, args) => {
      const gate = computeDoneGate(ctx.swarm);
      if (!gate.ok) {
        throw new SwarmToolError(`Not done yet. Missing: ${gate.missing.join("; ")}. Keep working.`);
      }
      const summary = requireText(args.summary, MAX_SWARM_POST, "summary");
      store.updateSwarm(ctx.swarm.id, {
        status: "done",
        stopReason: "completed",
        finishedAt: ctx.now,
      });
      post(ctx, { channel: "decisions", kind: "decision", body: `**Swarm complete**\n\n${summary}` });
      store.insertSwarmEvent({
        swarmId: ctx.swarm.id,
        agentId: ctx.agent.id,
        kind: "done",
        message: clip(summary, 300),
      });
      notifyEvent({
        kind: "swarm_update",
        title: `Swarm finished: ${ctx.swarm.title}`,
        text: clip(summary, 900),
        orgId: ctx.swarm.orgId ?? undefined,
        meta: { swarmId: ctx.swarm.id },
      });
      swarmSignals.kick(ctx.swarm.id);
      return "Swarm marked done.";
    },
  }),
];

export function toolsForRole(role: SwarmRole): SwarmToolDef[] {
  return SWARM_TOOLS.filter((t) => t.roles === "all" || t.roles.includes(role));
}

export function findSwarmTool(name: string): SwarmToolDef | undefined {
  return SWARM_TOOLS.find((t) => t.name === name);
}

/**
 * Validate + execute one tool call on behalf of an agent. Used by the MCP
 * endpoint and directly by tests.
 */
export function runSwarmTool(
  ctx: SwarmToolContext,
  name: string,
  rawArgs: unknown,
): string {
  const def = findSwarmTool(name);
  if (!def) throw new SwarmToolError(`Unknown tool ${name}`);
  if (def.roles !== "all" && !def.roles.includes(ctx.agent.role)) {
    throw new SwarmToolError(`${ctx.agent.role} cannot call ${name}`);
  }
  const parsed = z.object(def.input).safeParse(rawArgs ?? {});
  if (!parsed.success) {
    throw new SwarmToolError(
      `Invalid arguments: ${parsed.error.issues.map((i) => `${i.path.join(".") || "input"} ${i.message}`).join("; ")}`,
    );
  }
  store.touchSwarmAgentBoardCall(ctx.agent.id, ctx.now);
  return def.handler(ctx, parsed.data as never);
}
