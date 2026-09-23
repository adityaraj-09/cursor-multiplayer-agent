import type {
  SwarmArtifactKind,
  SwarmCritiqueInfo,
  SwarmHypothesisInfo,
  SwarmMessageInfo,
  SwarmPostInfo,
  SwarmTaskInfo,
} from "../../shared/swarm.js";
import { buildZip, type ZipFile } from "./zipArchive.js";
import * as store from "./store.js";

export type SwarmExportScope = "full" | "artifacts";

const EXPORT_POSTS = 5000;
const EXPORT_CRITIQUES = 5000;
const EXPORT_EVENTS = 5000;
const EXPORT_MESSAGES = 8000;
const EXPORT_REVISIONS = 1000;
const EXPORT_MATCHES = 5000;

function slug(raw: string, fallback = "item"): string {
  const clean = raw
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 64);
  return clean || fallback;
}

function stamp(ts: number | null | undefined): string {
  if (!ts) return "—";
  return new Date(ts).toISOString();
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function agentLabel(agents: store.SwarmAgentRow[], id: string | null | undefined): string {
  if (!id) return "—";
  const agent = agents.find((a) => a.id === id);
  return agent ? `@${agent.label}` : id;
}

function uniquePath(used: Set<string>, path: string): string {
  if (!used.has(path)) {
    used.add(path);
    return path;
  }
  const dot = path.lastIndexOf(".");
  const slash = path.lastIndexOf("/");
  const ext = dot > slash ? path.slice(dot) : "";
  const stem = ext ? path.slice(0, dot) : path;
  let n = 2;
  let next = `${stem}-${n}${ext}`;
  while (used.has(next)) {
    n += 1;
    next = `${stem}-${n}${ext}`;
  }
  used.add(next);
  return next;
}

function artifactRelPath(kind: SwarmArtifactKind, name: string, id: string): string {
  const parts = name
    .split(/[/\\]+/)
    .map((part) => part.trim())
    .filter((part) => part && part !== "." && part !== "..")
    .map((part) => slug(part, "file"));
  const file = parts.length ? parts.join("/") : slug(id, "artifact");
  return `artifacts/${slug(kind, "other")}/${file}`;
}

function postMarkdown(post: SwarmPostInfo, agents: store.SwarmAgentRow[]): string {
  const refs = post.refs.length ? `\n\nRefs: ${post.refs.join(", ")}` : "";
  const mentions = post.mentions.length
    ? `\n\nMentions: ${post.mentions.map((id) => agentLabel(agents, id)).join(", ")}`
    : "";
  return [
    `## ${stamp(post.createdAt)} · ${post.kind} · ${post.channel}`,
    `**${post.authorLabel}** (${post.authorRole}) · \`${post.id}\``,
    "",
    post.bodyMd,
    refs,
    mentions,
    "",
  ].join("\n");
}

function taskMarkdown(task: SwarmTaskInfo, agents: store.SwarmAgentRow[]): string {
  return [
    `# ${task.title}`,
    "",
    `- id: \`${task.id}\``,
    `- kind: ${task.kind}`,
    `- status: ${task.status}`,
    `- owner: ${agentLabel(agents, task.ownerAgentId)}`,
    `- role hint: ${task.roleHint || "—"}`,
    `- priority: ${task.priority}`,
    `- attempts: ${task.attempts}`,
    `- blocked by: ${task.blockedBy.length ? task.blockedBy.join(", ") : "—"}`,
    `- created: ${stamp(task.createdAt)}`,
    `- updated: ${stamp(task.updatedAt)}`,
    `- completed: ${stamp(task.completedAt)}`,
    "",
    "## Spec",
    "",
    task.spec || "_empty_",
    "",
    "## Result",
    "",
    task.resultMd || "_none_",
    "",
  ].join("\n");
}

function hypothesisMarkdown(
  hypothesis: SwarmHypothesisInfo,
  critiques: SwarmCritiqueInfo[],
  agents: store.SwarmAgentRow[],
): string {
  const notes = critiques
    .filter((c) => c.hypothesisId === hypothesis.id)
    .sort((a, b) => a.createdAt - b.createdAt)
    .map(
      (c) =>
        `### ${stamp(c.createdAt)} · ${c.verdict} · score ${c.score}\n${agentLabel(agents, c.authorAgentId)} · \`${c.id}\`\n\n${c.bodyMd}`,
    )
    .join("\n\n");
  return [
    `# ${hypothesis.title}`,
    "",
    `- id: \`${hypothesis.id}\``,
    `- status: ${hypothesis.status}`,
    `- elo: ${hypothesis.elo}`,
    `- record: ${hypothesis.wins} wins / ${hypothesis.matches} matches`,
    `- critiques: ${hypothesis.critiques}`,
    `- author: ${agentLabel(agents, hypothesis.authorAgentId)}`,
    `- parents: ${hypothesis.parentIds.length ? hypothesis.parentIds.join(", ") : "—"}`,
    `- created: ${stamp(hypothesis.createdAt)}`,
    `- updated: ${stamp(hypothesis.updatedAt)}`,
    "",
    "## Claim",
    "",
    hypothesis.claimMd || "_empty_",
    "",
    "## Evidence",
    "",
    hypothesis.evidenceMd || "_empty_",
    "",
    "## Critiques",
    "",
    notes || "_none yet_",
    "",
  ].join("\n");
}

function cycleMarkdown(cycle: number, messages: SwarmMessageInfo[]): string {
  const body = messages
    .map((m) => {
      const tool = m.toolName ? ` · ${m.toolName}` : "";
      const status = m.status ? ` · ${m.status}` : "";
      return `### ${stamp(m.ts)} · ${m.role}${tool}${status}\n\n${m.content || "_empty_"}\n`;
    })
    .join("\n");
  return [`# Cycle ${cycle}`, "", body || "_no messages_", ""].join("\n");
}

function artifactFiles(swarmId: string, root: string, used: Set<string>): ZipFile[] {
  const files: ZipFile[] = [];
  const artifacts = store.listSwarmArtifactContents(swarmId);
  const manifest = artifacts.map((a) => ({
    id: a.id,
    kind: a.kind,
    name: a.name,
    size: a.size,
    agentId: a.agentId,
    createdAt: stamp(a.createdAt),
    updatedAt: stamp(a.updatedAt),
    path: "",
  }));
  for (const artifact of artifacts) {
    const rel = uniquePath(used, `${root}/${artifactRelPath(artifact.kind, artifact.name, artifact.id)}`);
    const row = manifest.find((m) => m.id === artifact.id);
    if (row) row.path = rel.slice(root.length + 1);
    files.push({ path: rel, data: artifact.content });
  }
  files.push({
    path: uniquePath(used, `${root}/artifacts/manifest.json`),
    data: json(manifest),
  });
  return files;
}

export function swarmExportFilename(title: string, scope: SwarmExportScope): string {
  const base = slug(title, "swarm");
  return scope === "artifacts" ? `${base}-artifacts.zip` : `${base}-export.zip`;
}

export function buildSwarmExport(
  swarm: store.SwarmRow,
  scope: SwarmExportScope,
  when = new Date(),
): { filename: string; body: Buffer } {
  const root = slug(swarm.title, "swarm");
  const used = new Set<string>();
  const put = (path: string, data: string): ZipFile => ({
    path: uniquePath(used, `${root}/${path}`),
    data,
  });
  const files: ZipFile[] = [];

  if (scope === "artifacts") {
    files.push(
      put(
        "README.md",
        [
          `# ${swarm.title} — artifacts`,
          "",
          `Exported ${when.toISOString()} from swarm \`${swarm.id}\`.`,
          "",
          "Files are grouped by kind under `artifacts/`. `artifacts/manifest.json` maps each file back to its id, author, and timestamps.",
          "",
        ].join("\n"),
      ),
    );
    files.push(...artifactFiles(swarm.id, root, used));
    return { filename: swarmExportFilename(swarm.title, scope), body: buildZip(files, when) };
  }

  const agents = store.listSwarmAgents(swarm.id);
  const tasks = store.listSwarmTasks(swarm.id);
  const posts = store.listSwarmPosts(swarm.id, { limit: EXPORT_POSTS });
  const hypotheses = store.listSwarmHypotheses(swarm.id);
  const critiques = store.listSwarmCritiques(swarm.id, EXPORT_CRITIQUES);
  const matches = store.listSwarmMatches(swarm.id, EXPORT_MATCHES);
  const ledger = store.getSwarmLedger(swarm.id);
  const revisions = store.listSwarmLedgerRevisions(swarm.id, EXPORT_REVISIONS);
  const events = store.listSwarmEvents(swarm.id, EXPORT_EVENTS).slice().reverse();
  const questions = posts.filter((p) => p.channel === "questions");

  const publicAgents = agents.map((a) => ({
    id: a.id,
    label: a.label,
    role: a.role,
    status: a.status,
    brief: a.brief,
    hasRepo: a.hasRepo,
    branch: a.branch,
    currentTaskId: a.currentTaskId,
    cycles: a.cycles,
    spentUsd: a.spentUsd,
    tokensUsed: a.tokensUsed,
    lastCycleAt: a.lastCycleAt,
    lastError: a.lastError,
    cursorAgentId: a.cursorAgentId,
    createdAt: a.createdAt,
  }));

  files.push(
    put(
      "README.md",
      [
        `# ${swarm.title}`,
        "",
        `Exported ${when.toISOString()}.`,
        "",
        "This archive is the swarm's working record, grouped so you can read it or hand it to another tool.",
        "",
        "| Folder | Contents |",
        "| --- | --- |",
        "| `mission.md` | Goal, status, model, budget, repo |",
        "| `agents/` | One folder per agent: profile, private notes, and a file per cycle |",
        "| `board/` | Message board, with `questions.md` split out of the rest |",
        "| `tasks/` | Task graph, one file per task, grouped by status |",
        "| `hypotheses/` | Leaderboard, one file per idea (claim, evidence, critiques), and tournament matches |",
        "| `ledger/` | Current plan plus every saved revision |",
        "| `artifacts/` | Reports, notes, and data, grouped by kind |",
        "| `activity/` | Runner event log |",
        "| `data/` | The same records as JSON |",
        "",
        `Questions on the board: ${questions.length}. Hypotheses: ${hypotheses.length}. Artifacts: see \`artifacts/manifest.json\`.`,
        "",
      ].join("\n"),
    ),
  );

  files.push(
    put(
      "mission.md",
      [
        `# ${swarm.title}`,
        "",
        swarm.goal,
        "",
        `- id: \`${swarm.id}\``,
        `- status: ${swarm.status}${swarm.stopReason ? ` (${swarm.stopReason})` : ""}`,
        `- phase: ${swarm.phase}`,
        `- model: ${swarm.modelId}`,
        `- repo: ${swarm.repoUrl ? `${swarm.repoUrl} @ ${swarm.startingRef}` : "none"}`,
        `- budget: $${swarm.spentUsd.toFixed(2)} of $${swarm.budgetUsd.toFixed(2)}`,
        `- tokens: ${swarm.tokensUsed}`,
        `- cycles: ${swarm.cyclesDone} / ${swarm.maxCycles}`,
        `- workers: max ${swarm.maxWorkers}, parallel ${swarm.maxRunning}`,
        `- deadline: ${stamp(swarm.deadlineAt)}`,
        `- created: ${stamp(swarm.createdAt)}`,
        `- started: ${stamp(swarm.startedAt)}`,
        `- finished: ${stamp(swarm.finishedAt)}`,
        swarm.approvalNote ? `\n## Build approval\n\n${swarm.approvalNote}\n` : "",
      ].join("\n"),
    ),
  );

  files.push(
    put(
      "agents/index.md",
      [
        "# Agents",
        "",
        ...agents.map(
          (a) =>
            `- [@${a.label}](./${slug(a.label, "agent")}/profile.md) — ${a.role} · ${a.status} · ${a.cycles} cycles · $${a.spentUsd.toFixed(2)}`,
        ),
        "",
      ].join("\n"),
    ),
  );

  for (const agent of agents) {
    const dir = `agents/${slug(agent.label, "agent")}`;
    const messages = store.listSwarmMessages(agent.id, EXPORT_MESSAGES);
    const byCycle = new Map<number, SwarmMessageInfo[]>();
    for (const message of messages) {
      const list = byCycle.get(message.cycle) ?? [];
      list.push(message);
      byCycle.set(message.cycle, list);
    }
    const cycles = [...byCycle.keys()].sort((a, b) => a - b);
    files.push(
      put(
        `${dir}/profile.md`,
        [
          `# @${agent.label}`,
          "",
          `- id: \`${agent.id}\``,
          `- role: ${agent.role}`,
          `- status: ${agent.status}`,
          `- cycles: ${agent.cycles}`,
          `- spend: $${agent.spentUsd.toFixed(2)}`,
          `- tokens: ${agent.tokensUsed}`,
          `- repo checkout: ${agent.hasRepo ? "yes" : "no"}`,
          `- branch: ${agent.branch || "—"}`,
          `- current task: ${agent.currentTaskId || "—"}`,
          `- cursor agent: ${agent.cursorAgentId || "—"}`,
          `- last cycle: ${stamp(agent.lastCycleAt)}`,
          `- last error: ${agent.lastError || "—"}`,
          "",
          "## Brief",
          "",
          agent.brief || "_none_",
          "",
          "## Transcript",
          "",
          cycles.length
            ? cycles
                .map((cycle) => {
                  const count = byCycle.get(cycle)!.length;
                  const file = `cycles/${String(cycle).padStart(3, "0")}.md`;
                  return `- [Cycle ${cycle}](./${file}) — ${count} message${count === 1 ? "" : "s"}`;
                })
                .join("\n")
            : "_no transcript yet_",
          "",
        ].join("\n"),
      ),
    );
    files.push(put(`${dir}/notes.md`, agent.notesMd || "_no private notes_\n"));
    for (const cycle of cycles) {
      const file = `${dir}/cycles/${String(cycle).padStart(3, "0")}.md`;
      files.push(put(file, cycleMarkdown(cycle, byCycle.get(cycle)!)));
    }
  }

  const channels = ["plan", "findings", "questions", "decisions"] as const;
  files.push(
    put(
      "board/all.md",
      ["# Board", "", ...posts.map((p) => postMarkdown(p, agents))].join("\n"),
    ),
  );
  for (const channel of channels) {
    const slice = posts.filter((p) => p.channel === channel);
    files.push(
      put(
        `board/${channel}.md`,
        [`# #${channel}`, "", slice.length ? slice.map((p) => postMarkdown(p, agents)).join("\n") : "_empty_\n"].join(
          "\n",
        ),
      ),
    );
  }
  const taskChannels = new Map<string, SwarmPostInfo[]>();
  for (const post of posts) {
    if (!post.channel.startsWith("task:")) continue;
    const list = taskChannels.get(post.channel) ?? [];
    list.push(post);
    taskChannels.set(post.channel, list);
  }
  for (const [channel, slice] of taskChannels) {
    const id = channel.slice("task:".length);
    files.push(put(`board/task-threads/${slug(id, "task")}.md`, [`# ${channel}`, "", ...slice.map((p) => postMarkdown(p, agents))].join("\n")));
  }

  files.push(
    put(
      "tasks/index.md",
      [
        "# Tasks",
        "",
        ...tasks.map(
          (t) =>
            `- [${t.status}](./${t.status}/${slug(t.id, "task")}-${slug(t.title, "task")}.md) · ${t.kind} · ${t.title}`,
        ),
        "",
      ].join("\n"),
    ),
  );
  for (const task of tasks) {
    files.push(
      put(`tasks/${task.status}/${slug(task.id, "task")}-${slug(task.title, "task")}.md`, taskMarkdown(task, agents)),
    );
  }

  const ranked = [...hypotheses].sort((a, b) => b.elo - a.elo);
  files.push(
    put(
      "hypotheses/leaderboard.md",
      [
        "# Hypothesis leaderboard",
        "",
        "| Elo | Status | Title | Critiques | Matches |",
        "| --- | --- | --- | --- | --- |",
        ...ranked.map(
          (h) =>
            `| ${h.elo} | ${h.status} | [${h.title.replace(/\|/g, "/")}](./${h.status}/${slug(h.id, "h")}-${slug(h.title, "idea")}.md) | ${h.critiques} | ${h.matches} |`,
        ),
        "",
      ].join("\n"),
    ),
  );
  for (const hypothesis of hypotheses) {
    files.push(
      put(
        `hypotheses/${hypothesis.status}/${slug(hypothesis.id, "h")}-${slug(hypothesis.title, "idea")}.md`,
        hypothesisMarkdown(hypothesis, critiques, agents),
      ),
    );
  }
  files.push(
    put(
      "hypotheses/matches.md",
      [
        "# Tournament matches",
        "",
        ...matches.map((m) => {
          const title = (id: string) => hypotheses.find((h) => h.id === id)?.title || id;
          const winnerId = m.winner === "a" ? m.hypothesisA : m.winner === "b" ? m.hypothesisB : "";
          return [
            `## ${stamp(m.createdAt)} · ${winnerId ? `${title(winnerId)} wins` : "draw"}`,
            "",
            `- A: ${title(m.hypothesisA)} (\`${m.hypothesisA}\`)`,
            `- B: ${title(m.hypothesisB)} (\`${m.hypothesisB}\`)`,
            `- judge: ${agentLabel(agents, m.judgeAgentId)}`,
            "",
            m.rationale || "_no rationale_",
            "",
          ].join("\n");
        }),
        matches.length ? "" : "_no matches_\n",
      ].join("\n"),
    ),
  );

  if (ledger) {
    files.push(
      put(
        "ledger/current.md",
        [
          `# Ledger revision ${ledger.revision}`,
          "",
          `Updated ${stamp(ledger.updatedAt)} by ${agentLabel(agents, ledger.updatedBy)}.`,
          "",
          "## Plan",
          "",
          ledger.planMd || "_empty_",
          "",
          "## Verified facts",
          "",
          ledger.factsMd || "_empty_",
          "",
          "## Educated guesses",
          "",
          ledger.guessesMd || "_empty_",
          "",
          "## Open questions",
          "",
          ledger.openQuestionsMd || "_empty_",
          "",
          "## Progress",
          "",
          ledger.progress ? json(ledger.progress) : "_none_",
          "",
        ].join("\n"),
      ),
    );
  }
  for (const revision of [...revisions].sort((a, b) => a.revision - b.revision)) {
    files.push(
      put(
        `ledger/revisions/${String(revision.revision).padStart(4, "0")}.md`,
        [
          `# Revision ${revision.revision}`,
          "",
          `## Plan\n\n${revision.planMd || "_empty_"}`,
          "",
          `## Facts\n\n${revision.factsMd || "_empty_"}`,
          "",
          `## Guesses\n\n${revision.guessesMd || "_empty_"}`,
          "",
          `## Open questions\n\n${revision.openQuestionsMd || "_empty_"}`,
          "",
        ].join("\n"),
      ),
    );
  }

  files.push(...artifactFiles(swarm.id, root, used));

  files.push(
    put(
      "activity/events.md",
      [
        "# Activity",
        "",
        ...events.map(
          (e) => `- ${stamp(e.createdAt)} · \`${e.kind}\` · ${agentLabel(agents, e.agentId)} · ${e.message || ""}`,
        ),
        "",
      ].join("\n"),
    ),
  );

  files.push(put("data/swarm.json", json(swarm)));
  files.push(put("data/agents.json", json(publicAgents)));
  files.push(put("data/posts.json", json(posts)));
  files.push(put("data/tasks.json", json(tasks)));
  files.push(put("data/hypotheses.json", json(hypotheses)));
  files.push(put("data/critiques.json", json(critiques)));
  files.push(put("data/matches.json", json(matches)));
  files.push(put("data/ledger.json", json({ current: ledger, revisions })));
  files.push(put("data/events.json", json(events)));

  return { filename: swarmExportFilename(swarm.title, scope), body: buildZip(files, when) };
}
