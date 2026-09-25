"use client";

import { useMemo, useState } from "react";
import {
  Activity,
  BookOpen,
  Bot,
  FileText,
  ListChecks,
  MessagesSquare,
  Trophy,
} from "lucide-react";
import SwarmBoard from "../../swarm/SwarmBoard";
import {
  SwarmActivity,
  SwarmHypotheses,
  SwarmLedger,
  SwarmTasks,
} from "../../swarm/SwarmPanels";
import {
  BudgetMeter,
  ModelChip,
  PhaseStepper,
  ROLE_META,
  StatusPill,
  formatUsd,
  relativeTime,
} from "../../swarm/swarmUi";
import {
  VLLM_AGENTS,
  VLLM_ARTIFACTS,
  VLLM_CRITIQUES,
  VLLM_EVENTS,
  VLLM_HYPOTHESES,
  VLLM_LEDGER,
  VLLM_POSTS,
  VLLM_SWARM,
  VLLM_TASKS,
} from "./vllm-swarm-demo";

type Tab = "board" | "agents" | "tasks" | "hypotheses" | "ledger" | "artifacts" | "activity";

export default function SwarmShowcase() {
  const [tab, setTab] = useState<Tab>("board");
  const [goalOpen, setGoalOpen] = useState(false);
  const swarm = VLLM_SWARM;
  const counts = useMemo(
    () => ({
      posts: VLLM_POSTS.length,
      agents: VLLM_AGENTS.filter((agent) => agent.status !== "retired").length,
      tasks: VLLM_TASKS.filter((task) => task.status !== "cancelled").length,
      hypotheses: VLLM_HYPOTHESES.filter((item) => item.status !== "rejected").length,
      artifacts: VLLM_ARTIFACTS.length,
    }),
    [],
  );
  const tabs: Array<{ key: Tab; label: string; icon: typeof Bot; count?: number }> = [
    { key: "board", label: "Board", icon: MessagesSquare, count: counts.posts },
    { key: "agents", label: "Agents", icon: Bot, count: counts.agents },
    { key: "tasks", label: "Tasks", icon: ListChecks, count: counts.tasks },
    { key: "hypotheses", label: "Hypotheses", icon: Trophy, count: counts.hypotheses },
    { key: "ledger", label: "Ledger", icon: BookOpen },
    { key: "artifacts", label: "Artifacts", icon: FileText, count: counts.artifacts },
    { key: "activity", label: "Activity", icon: Activity },
  ];

  return (
    <div className="flex h-[min(760px,82vh)] min-h-0 flex-col overflow-hidden rounded-[18px] border border-[#2b2b2b] bg-[#141414] text-[#e4e4e4] shadow-[0_40px_120px_rgba(0,0,0,0.55)]">
      <header className="shrink-0 border-b border-[#2b2b2b] px-4 py-4 sm:px-5">
        <p className="text-[11px] text-[#6e6e6e]">← Swarms</p>
        <div className="mt-2 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill status={swarm.status} />
              <h3 className="text-[18px] font-medium tracking-tight text-[#e4e4e4]">{swarm.title}</h3>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-[#6e6e6e]">
              <span>Personal</span>
              <ModelChip modelId={swarm.modelId} />
              <span>{swarm.cyclesDone} cycles</span>
              <span>by {swarm.creatorName}</span>
            </div>
            <div className="mt-3">
              <PhaseStepper swarm={swarm} />
            </div>
          </div>
          <div className="w-full lg:w-72">
            <BudgetMeter spent={swarm.spentUsd} budget={swarm.budgetUsd} />
          </div>
        </div>
        <div className="mt-4 rounded-xl border border-[#1f3d2e] bg-[#121c16] px-4 py-3 text-[12px] text-[#3ecf8e]">
          Finished — the verifier passed the report.
        </div>
        <button
          type="button"
          onClick={() => setGoalOpen((open) => !open)}
          className="mt-3 w-full rounded-xl border border-[#2b2b2b] bg-[#161616] px-4 py-3 text-left"
        >
          <span className="text-[11px] uppercase tracking-wide text-[#6e6e6e]">Mission</span>
          <p className={`mt-1 text-[13px] leading-5 text-[#c8c8c8] ${goalOpen ? "" : "line-clamp-2"}`}>
            {swarm.goal}
          </p>
        </button>
      </header>

      <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-[#2b2b2b] bg-[#171717] px-3 py-1.5">
        {tabs.map(({ key, label, icon: Icon, count }) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[12px] ${
              tab === key ? "bg-[#252525] text-[#e4e4e4]" : "text-[#6e6e6e] hover:text-[#e4e4e4]"
            }`}
          >
            <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
            {label}
            {count != null && <span className="tabular-nums text-[#555]">{count}</span>}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-4 py-4 sm:px-5">
        {tab === "board" && (
          <SwarmBoard
            swarmId={swarm.id}
            posts={VLLM_POSTS}
            agents={VLLM_AGENTS}
            canEdit={false}
            onPosted={() => undefined}
          />
        )}
        {tab === "agents" && <DemoAgentGrid />}
        {tab === "tasks" && <SwarmTasks tasks={VLLM_TASKS} agents={VLLM_AGENTS} />}
        {tab === "hypotheses" && (
          <SwarmHypotheses
            hypotheses={VLLM_HYPOTHESES}
            critiques={VLLM_CRITIQUES}
            agents={VLLM_AGENTS}
          />
        )}
        {tab === "ledger" && <SwarmLedger ledger={VLLM_LEDGER} />}
        {tab === "artifacts" && <DemoArtifactList />}
        {tab === "activity" && <SwarmActivity events={VLLM_EVENTS} agents={VLLM_AGENTS} />}
      </div>
    </div>
  );
}

function DemoAgentGrid() {
  const byTask = new Map(VLLM_TASKS.map((task) => [task.ownerAgentId, task]));
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {VLLM_AGENTS.map((agent) => {
        const meta = ROLE_META[agent.role];
        const task = byTask.get(agent.id);
        return (
          <div
            key={agent.id}
            className={`flex flex-col rounded-xl border bg-[#171717] p-3.5 ${
              agent.status === "retired" ? "border-[#1f1f1f] opacity-60" : "border-[#2b2b2b]"
            }`}
          >
            <div className="flex items-center gap-2">
              <span className={`inline-flex h-7 w-7 items-center justify-center rounded-lg border ${meta.bg}`}>
                <Bot className={`h-3.5 w-3.5 ${meta.color}`} strokeWidth={1.75} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium text-[#e4e4e4]">@{agent.label}</p>
                <p className={`text-[11px] ${meta.color}`}>{meta.label}</p>
              </div>
              <span className="inline-flex h-5 items-center rounded-full bg-[#1f1f1f] px-2 text-[10px] text-[#6e6e6e]">
                {agent.status}
              </span>
            </div>
            <p className="mt-3 line-clamp-2 min-h-[2.5rem] text-[12px] leading-5 text-[#a0a0a0]">
              {task?.title ||
                agent.brief ||
                (agent.role === "orchestrator"
                  ? "Plans, delegates, and keeps the ledger."
                  : "Waiting for work")}
            </p>
            <div className="mt-3 flex items-center gap-3 text-[11px] tabular-nums text-[#6e6e6e]">
              <span>
                {agent.cycles} cycle{agent.cycles === 1 ? "" : "s"}
              </span>
              <span>{formatUsd(agent.spentUsd)}</span>
              <span className="ml-auto">{relativeTime(agent.lastCycleAt)}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function DemoArtifactList() {
  return (
    <div className="overflow-hidden rounded-xl border border-[#2b2b2b]">
      {VLLM_ARTIFACTS.map((artifact) => (
        <div
          key={artifact.id}
          className="flex items-center gap-3 border-b border-[#1f1f1f] px-4 py-3 last:border-b-0"
        >
          <FileText
            className={`h-4 w-4 ${artifact.kind === "report" ? "text-[#7ee2c4]" : "text-[#6e6e6e]"}`}
            strokeWidth={1.75}
          />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] text-[#e4e4e4]">{artifact.name}</p>
            <p className="text-[11px] text-[#6e6e6e]">
              {artifact.kind} · {(artifact.size / 1024).toFixed(1)} KB · {relativeTime(artifact.updatedAt)}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}
