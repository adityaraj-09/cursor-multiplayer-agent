"use client";

import { useEffect, useMemo, useState } from "react";
import { Bot, X } from "lucide-react";
import Markdown from "../Markdown";
import {
  fetchSwarmAgentMessages,
  type SwarmAgentInfo,
  type SwarmMessageInfo,
  type SwarmTaskInfo,
} from "../../lib/api";
import { ROLE_META, formatUsd, relativeTime } from "./swarmUi";

function AgentCard({
  agent,
  task,
  onOpen,
}: {
  agent: SwarmAgentInfo;
  task?: SwarmTaskInfo;
  onOpen: () => void;
}) {
  const meta = ROLE_META[agent.role];
  const running = agent.status === "running";
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`group flex w-full flex-col rounded-xl border bg-[#171717] p-3.5 text-left transition-colors hover:border-[#3c3c3c] ${
        running ? "border-[#26405d]" : agent.status === "retired" ? "border-[#1f1f1f] opacity-60" : "border-[#2b2b2b]"
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
        <span
          className={`inline-flex h-5 items-center gap-1 rounded-full px-2 text-[10px] ${
            running
              ? "bg-[#17202a] text-[#8ec5ff]"
              : agent.status === "error"
                ? "bg-[#1a1414] text-[#f07070]"
                : "bg-[#1f1f1f] text-[#6e6e6e]"
          }`}
        >
          {running && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#4d9fff]" />}
          {running ? "working" : agent.status}
        </span>
      </div>
      <p className="mt-3 line-clamp-2 min-h-[2.5rem] text-[12px] leading-5 text-[#a0a0a0]">
        {task ? task.title : agent.brief || (agent.role === "orchestrator" ? "Plans, delegates, and keeps the ledger." : "Waiting for work")}
      </p>
      {agent.lastError && (
        <p className="mt-2 line-clamp-2 text-[11px] text-[#f07070]">{agent.lastError}</p>
      )}
      <div className="mt-3 flex items-center gap-3 text-[11px] tabular-nums text-[#6e6e6e]">
        <span>{agent.cycles} cycle{agent.cycles === 1 ? "" : "s"}</span>
        <span>{formatUsd(agent.spentUsd)}</span>
        <span className="ml-auto">{running ? `since ${relativeTime(agent.runStartedAt)}` : relativeTime(agent.lastCycleAt)}</span>
      </div>
    </button>
  );
}

function TranscriptItem({ message }: { message: SwarmMessageInfo }) {
  if (message.role === "user") {
    return (
      <details className="rounded-lg border border-[#232323] bg-[#161616] px-3 py-2">
        <summary className="cursor-pointer text-[11px] text-[#6e6e6e]">Cycle prompt from Steer</summary>
        <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap font-mono text-[11px] leading-5 text-[#8a8a8a]">
          {message.content}
        </pre>
      </details>
    );
  }
  if (message.role === "tool") {
    return (
      <div className="flex items-start gap-2 px-1 font-mono text-[11px] text-[#8a8a8a]">
        <span className={message.status === "running" ? "text-[#e6c07b]" : "text-[#555]"}>
          {message.status === "running" ? "…" : "·"}
        </span>
        <span className="text-[#6e6e6e]">{message.toolName}</span>
        <span className="min-w-0 flex-1 truncate">{message.content}</span>
      </div>
    );
  }
  if (message.role === "error") {
    return <p className="rounded-md bg-[#1a1414] px-3 py-2 text-[12px] text-[#f07070]">{message.content}</p>;
  }
  return (
    <div className="rounded-lg border border-[#232323] bg-[#161616] px-3 py-2">
      <Markdown content={message.content} />
    </div>
  );
}

export function AgentDrawer({
  swarmId,
  agent,
  onClose,
}: {
  swarmId: string;
  agent: SwarmAgentInfo;
  onClose: () => void;
}) {
  const [data, setData] = useState<{ notesMd: string; messages: SwarmMessageInfo[] } | null>(null);
  const [error, setError] = useState("");
  const running = agent.status === "running";

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      fetchSwarmAgentMessages(swarmId, agent.id)
        .then((next) => {
          if (!cancelled) {
            setData(next);
            setError("");
          }
        })
        .catch((err) => {
          if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load");
        });
    void load();
    if (!running) return () => {
      cancelled = true;
    };
    const interval = setInterval(() => void load(), 4000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [swarmId, agent.id, running]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const cycles = useMemo(() => {
    const map = new Map<number, SwarmMessageInfo[]>();
    for (const m of data?.messages ?? []) {
      map.set(m.cycle, [...(map.get(m.cycle) ?? []), m]);
    }
    return [...map.entries()].sort((a, b) => b[0] - a[0]);
  }, [data]);

  const meta = ROLE_META[agent.role];
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/40" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="flex h-full w-full max-w-2xl flex-col border-l border-[#2b2b2b] bg-[#141414] shadow-2xl animate-fade-up">
        <header className="flex items-center gap-3 border-b border-[#222] px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-[14px] font-medium text-[#e4e4e4]">@{agent.label}</p>
            <p className={`text-[11px] ${meta.color}`}>
              {meta.label} · {agent.cycles} cycles · {formatUsd(agent.spentUsd)}
              {agent.cursorAgentId ? <span className="ml-2 font-mono text-[#555]">{agent.cursorAgentId}</span> : null}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-[#6e6e6e] hover:bg-[#222] hover:text-[#e4e4e4]"
            aria-label="Close"
          >
            <X className="h-4 w-4" strokeWidth={1.75} />
          </button>
        </header>
        <div className="flex-1 space-y-5 overflow-y-auto px-4 py-4">
          {agent.brief && (
            <section>
              <p className="mb-1.5 text-[11px] uppercase tracking-wide text-[#6e6e6e]">Brief</p>
              <p className="whitespace-pre-wrap text-[12px] leading-5 text-[#a0a0a0]">{agent.brief}</p>
            </section>
          )}
          <section>
            <p className="mb-1.5 text-[11px] uppercase tracking-wide text-[#6e6e6e]">Working notes</p>
            {data?.notesMd ? (
              <div className="rounded-lg border border-[#232323] bg-[#171717] px-3 py-2">
                <Markdown content={data.notesMd} />
              </div>
            ) : (
              <p className="text-[12px] text-[#555]">No notes yet.</p>
            )}
          </section>
          {error && <p className="text-[12px] text-[#f07070]">{error}</p>}
          {!data && !error && <p className="text-[12px] text-[#6e6e6e]">Loading transcript…</p>}
          {cycles.map(([cycle, messages]) => (
            <section key={cycle} className="space-y-2">
              <p className="text-[11px] uppercase tracking-wide text-[#6e6e6e]">
                Cycle {cycle}
                <span className="ml-2 normal-case tracking-normal text-[#555]">
                  {new Date(messages[0]!.ts).toLocaleString()}
                </span>
              </p>
              {messages.map((m) => (
                <TranscriptItem key={m.id} message={m} />
              ))}
            </section>
          ))}
          {data && cycles.length === 0 && <p className="text-[12px] text-[#555]">This agent has not run a cycle yet.</p>}
        </div>
      </aside>
    </div>
  );
}

export default function SwarmAgents({
  swarmId,
  agents,
  tasks,
  readOnly = false,
}: {
  swarmId: string;
  agents: SwarmAgentInfo[];
  tasks: SwarmTaskInfo[];
  readOnly?: boolean;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const open = agents.find((a) => a.id === openId) || null;

  return (
    <div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {agents.map((agent) => (
          <AgentCard
            key={agent.id}
            agent={agent}
            task={tasks.find((t) => t.id === agent.currentTaskId)}
            onOpen={() => setOpenId(agent.id)}
          />
        ))}
      </div>
      {open && !readOnly && <AgentDrawer swarmId={swarmId} agent={open} onClose={() => setOpenId(null)} />}
    </div>
  );
}
