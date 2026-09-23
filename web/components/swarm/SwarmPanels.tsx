"use client";

import { useState } from "react";
import { ChevronRight, Download, FileText, Trophy, X } from "lucide-react";
import Markdown from "../Markdown";
import {
  downloadSwarmExport,
  fetchSwarmArtifact,
  type SwarmAgentInfo,
  type SwarmArtifactInfo,
  type SwarmHypothesisInfo,
  type SwarmLedgerInfo,
  type SwarmTaskInfo,
} from "../../lib/api";
import type { SwarmCritiqueInfo, SwarmEventInfo } from "../../../shared/swarm";
import { relativeTime } from "./swarmUi";

function Empty({ children }: { children: string }) {
  return (
    <p className="rounded-lg border border-dashed border-[#2b2b2b] px-4 py-10 text-center text-[12px] text-[#6e6e6e]">
      {children}
    </p>
  );
}

function labelFor(agents: SwarmAgentInfo[], id: string | null): string {
  if (!id) return "";
  const a = agents.find((x) => x.id === id);
  return a ? `@${a.label}` : "";
}

const TASK_COLUMNS: Array<{ key: string; label: string; statuses: SwarmTaskInfo["status"][] }> = [
  { key: "pending", label: "Pending", statuses: ["pending"] },
  { key: "claimed", label: "In progress", statuses: ["claimed"] },
  { key: "done", label: "Done", statuses: ["done"] },
  { key: "closed", label: "Failed / cancelled", statuses: ["failed", "cancelled"] },
];

export function SwarmTasks({ tasks, agents }: { tasks: SwarmTaskInfo[]; agents: SwarmAgentInfo[] }) {
  const [open, setOpen] = useState<string | null>(null);
  if (!tasks.length) return <Empty>No tasks yet. The orchestrator creates the task graph on its first cycle.</Empty>;
  const byId = new Map(tasks.map((t) => [t.id, t]));
  return (
    <div className="grid gap-3 lg:grid-cols-4">
      {TASK_COLUMNS.map((col) => {
        const items = tasks.filter((t) => col.statuses.includes(t.status));
        return (
          <section key={col.key} className="rounded-xl border border-[#232323] bg-[#161616] p-2">
            <h3 className="mb-2 flex items-center justify-between px-1.5 pt-1 text-[11px] font-medium uppercase tracking-wide text-[#6e6e6e]">
              {col.label}
              <span className="tabular-nums text-[#4a4a4a]">{items.length}</span>
            </h3>
            <div className="space-y-2">
              {items.map((task) => {
                const blocked = task.status === "pending" && task.blockedBy.some((id) => byId.get(id)?.status !== "done");
                const expanded = open === task.id;
                return (
                  <button
                    key={task.id}
                    type="button"
                    onClick={() => setOpen(expanded ? null : task.id)}
                    className="block w-full rounded-lg border border-[#262626] bg-[#1a1a1a] p-2.5 text-left hover:border-[#3c3c3c]"
                  >
                    <div className="flex items-center gap-1.5 text-[10px] text-[#6e6e6e]">
                      <span className="rounded bg-[#222] px-1.5 py-0.5 uppercase tracking-wide">{task.kind}</span>
                      <span>P{task.priority}</span>
                      {blocked && <span className="text-[#e6c07b]">blocked</span>}
                      <span className="ml-auto">{labelFor(agents, task.ownerAgentId) || task.roleHint || ""}</span>
                    </div>
                    <p className="mt-1.5 text-[12px] leading-5 text-[#e4e4e4]">{task.title}</p>
                    {expanded && (
                      <div className="mt-2 space-y-2 border-t border-[#262626] pt-2">
                        <p className="whitespace-pre-wrap text-[11px] leading-5 text-[#a0a0a0]">{task.spec}</p>
                        {task.resultMd && (
                          <div className="rounded-md bg-[#141414] px-2 py-1.5">
                            <Markdown content={task.resultMd} />
                          </div>
                        )}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}

const VERDICT_TONE: Record<string, string> = {
  support: "text-[#3ecf8e]",
  refute: "text-[#f07070]",
  needs_evidence: "text-[#e6c07b]",
};

export function SwarmHypotheses({
  hypotheses,
  critiques,
  agents,
}: {
  hypotheses: SwarmHypothesisInfo[];
  critiques: SwarmCritiqueInfo[];
  agents: SwarmAgentInfo[];
}) {
  const [open, setOpen] = useState<string | null>(null);
  if (!hypotheses.length) {
    return <Empty>No hypotheses yet. Researchers propose them; critics review them; the ranker runs an Elo tournament.</Empty>;
  }
  const sorted = [...hypotheses].sort((a, b) => {
    if ((a.status === "rejected") !== (b.status === "rejected")) return a.status === "rejected" ? 1 : -1;
    return b.elo - a.elo;
  });
  return (
    <div className="overflow-hidden rounded-xl border border-[#2b2b2b]">
      {sorted.map((h, i) => {
        const expanded = open === h.id;
        const mine = critiques.filter((c) => c.hypothesisId === h.id);
        const parents = h.parentIds.map((id) => hypotheses.find((x) => x.id === id)?.title).filter(Boolean);
        return (
          <div key={h.id} className="border-b border-[#1f1f1f] last:border-b-0">
            <button
              type="button"
              onClick={() => setOpen(expanded ? null : h.id)}
              className={`flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-[#1a1a1a] ${h.status === "rejected" ? "opacity-50" : ""}`}
            >
              <span className="w-6 text-right text-[12px] tabular-nums text-[#555]">{i + 1}</span>
              {i === 0 && h.status !== "rejected" ? (
                <Trophy className="h-4 w-4 shrink-0 text-[#f0c674]" strokeWidth={1.75} />
              ) : (
                <ChevronRight
                  className={`h-4 w-4 shrink-0 text-[#4a4a4a] transition-transform ${expanded ? "rotate-90" : ""}`}
                  strokeWidth={1.75}
                />
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] text-[#e4e4e4]">{h.title}</p>
                <p className="text-[11px] text-[#6e6e6e]">
                  {labelFor(agents, h.authorAgentId)} · {h.critiques} critique{h.critiques === 1 ? "" : "s"} · {h.wins}/{h.matches} wins
                  {h.status !== "proposed" && <span className={h.status === "promoted" ? " text-[#3ecf8e]" : " text-[#f07070]"}> · {h.status}</span>}
                </p>
              </div>
              <span className="rounded-md bg-[#1f1f1f] px-2 py-1 text-[12px] font-medium tabular-nums text-[#e4e4e4]">
                {Math.round(h.elo)}
              </span>
            </button>
            {expanded && (
              <div className="space-y-3 bg-[#161616] px-4 pb-4 pl-[4.25rem] pt-1">
                {parents.length > 0 && (
                  <p className="text-[11px] text-[#6e6e6e]">Evolved from: {parents.join(" · ")}</p>
                )}
                <div>
                  <p className="mb-1 text-[11px] uppercase tracking-wide text-[#6e6e6e]">Claim</p>
                  <Markdown content={h.claimMd} />
                </div>
                {h.evidenceMd && (
                  <div>
                    <p className="mb-1 text-[11px] uppercase tracking-wide text-[#6e6e6e]">Evidence</p>
                    <Markdown content={h.evidenceMd} />
                  </div>
                )}
                {mine.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-[11px] uppercase tracking-wide text-[#6e6e6e]">Critiques</p>
                    {mine.map((c) => (
                      <div key={c.id} className="rounded-md border border-[#232323] bg-[#141414] px-3 py-2">
                        <p className="mb-1 text-[11px]">
                          <span className={VERDICT_TONE[c.verdict]}>{c.verdict.replace("_", " ")}</span>
                          <span className="text-[#6e6e6e]"> · {c.score}/10 · {labelFor(agents, c.authorAgentId)}</span>
                        </p>
                        <Markdown content={c.bodyMd} />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function SwarmLedger({ ledger }: { ledger: SwarmLedgerInfo | null }) {
  if (!ledger || ledger.revision === 0) {
    return <Empty>The orchestrator writes its task ledger — facts, guesses, plan, open questions — on its first cycle.</Empty>;
  }
  const sections = [
    { title: "Plan", body: ledger.planMd },
    { title: "Verified facts", body: ledger.factsMd },
    { title: "Educated guesses", body: ledger.guessesMd },
    { title: "Open questions", body: ledger.openQuestionsMd },
  ];
  const p = ledger.progress;
  return (
    <div className="space-y-3">
      {p && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[#2b2b2b] bg-[#161616] px-4 py-3 text-[12px]">
          <span className="text-[11px] uppercase tracking-wide text-[#6e6e6e]">Latest progress check</span>
          <span className={p.isProgressBeingMade ? "text-[#3ecf8e]" : "text-[#f07070]"}>
            {p.isProgressBeingMade ? "progressing" : "stalled"}
          </span>
          {p.isInLoop && <span className="text-[#e6c07b]">looping</span>}
          {p.isRequestSatisfied && <span className="text-[#3ecf8e]">goal satisfied</span>}
          <span className="basis-full text-[#a0a0a0]">
            <span className="text-[#6e6e6e]">Next: </span>
            {p.nextFocus}
          </span>
          {p.reason && <span className="basis-full text-[11px] text-[#6e6e6e]">{p.reason}</span>}
        </div>
      )}
      <div className="grid gap-3 lg:grid-cols-2">
        {sections.map((s) => (
          <section key={s.title} className="rounded-xl border border-[#2b2b2b] bg-[#161616] px-4 py-3">
            <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wide text-[#6e6e6e]">{s.title}</h3>
            {s.body ? <Markdown content={s.body} /> : <p className="text-[12px] text-[#555]">—</p>}
          </section>
        ))}
      </div>
      <p className="text-right text-[11px] text-[#555]">
        Revision {ledger.revision} · updated {relativeTime(ledger.updatedAt)}
      </p>
    </div>
  );
}

export function SwarmArtifacts({
  swarmId,
  artifacts,
  agents,
}: {
  swarmId: string;
  artifacts: SwarmArtifactInfo[];
  agents: SwarmAgentInfo[];
}) {
  const [viewing, setViewing] = useState<(SwarmArtifactInfo & { content: string }) | null>(null);
  const [error, setError] = useState("");
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [downloadingAll, setDownloadingAll] = useState(false);
  if (!artifacts.length) return <Empty>No artifacts yet. The synthesizer saves report.md here; workers save surveys, notes, and data.</Empty>;

  const open = async (id: string) => {
    setError("");
    try {
      setViewing(await fetchSwarmArtifact(swarmId, id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    }
  };

  const saveText = (name: string, content: string) => {
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name.split("/").pop() || "artifact.md";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const downloadOne = async (id: string) => {
    setError("");
    setDownloadingId(id);
    try {
      const artifact = await fetchSwarmArtifact(swarmId, id);
      saveText(artifact.name, artifact.content);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to download");
    } finally {
      setDownloadingId(null);
    }
  };

  const downloadAll = async () => {
    setError("");
    setDownloadingAll(true);
    try {
      await downloadSwarmExport(swarmId, "artifacts");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to download artifacts");
    } finally {
      setDownloadingAll(false);
    }
  };

  const sorted = [...artifacts].sort((a, b) => (a.kind === "report" ? -1 : b.kind === "report" ? 1 : b.updatedAt - a.updatedAt));
  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-[11px] text-[#6e6e6e]">
          {artifacts.length} file{artifacts.length === 1 ? "" : "s"}
        </p>
        <button
          type="button"
          disabled={downloadingAll}
          onClick={() => void downloadAll()}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[#2b2b2b] px-2.5 text-[12px] text-[#e4e4e4] hover:border-[#3c3c3c] disabled:opacity-50"
        >
          <Download className="h-3.5 w-3.5" strokeWidth={1.75} />
          {downloadingAll ? "Preparing…" : "Download all"}
        </button>
      </div>
      {error && <p className="mb-2 text-[12px] text-[#f07070]">{error}</p>}
      <div className="overflow-hidden rounded-xl border border-[#2b2b2b]">
        {sorted.map((a) => (
          <div
            key={a.id}
            className="flex items-center gap-2 border-b border-[#1f1f1f] last:border-b-0 hover:bg-[#1a1a1a]"
          >
            <button
              type="button"
              onClick={() => void open(a.id)}
              className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left"
            >
              <FileText className={`h-4 w-4 ${a.kind === "report" ? "text-[#7ee2c4]" : "text-[#6e6e6e]"}`} strokeWidth={1.75} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] text-[#e4e4e4]">{a.name}</p>
                <p className="text-[11px] text-[#6e6e6e]">
                  {a.kind} · {(a.size / 1024).toFixed(1)} KB · {labelFor(agents, a.agentId)} · {relativeTime(a.updatedAt)}
                </p>
              </div>
            </button>
            <button
              type="button"
              disabled={downloadingId === a.id}
              onClick={() => void downloadOne(a.id)}
              className="mr-2 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[#6e6e6e] hover:bg-[#222] hover:text-[#e4e4e4] disabled:opacity-50"
              aria-label={`Download ${a.name}`}
              title={`Download ${a.name}`}
            >
              <Download className="h-3.5 w-3.5" strokeWidth={1.75} />
            </button>
          </div>
        ))}
      </div>
      {viewing && (
        <div className="fixed inset-0 z-40 flex items-start justify-center bg-black/60 px-4 pt-[6vh] pb-8" onMouseDown={(e) => e.target === e.currentTarget && setViewing(null)}>
          <div className="flex max-h-[86vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-[#2b2b2b] bg-[#141414] shadow-2xl">
            <header className="flex items-center gap-2 border-b border-[#222] px-4 py-3">
              <p className="min-w-0 flex-1 truncate text-[13px] font-medium text-[#e4e4e4]">{viewing.name}</p>
              <button
                type="button"
                onClick={() => saveText(viewing.name, viewing.content)}
                className="inline-flex h-7 items-center gap-1.5 rounded-md border border-[#2b2b2b] px-2.5 text-[11px] text-[#a0a0a0] hover:text-[#e4e4e4]"
              >
                <Download className="h-3.5 w-3.5" strokeWidth={1.75} />
                Download
              </button>
              <button
                type="button"
                onClick={() => setViewing(null)}
                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[#6e6e6e] hover:bg-[#222] hover:text-[#e4e4e4]"
                aria-label="Close"
              >
                <X className="h-4 w-4" strokeWidth={1.75} />
              </button>
            </header>
            <div className="overflow-y-auto px-5 py-4">
              {/\.(md|markdown|txt)$/i.test(viewing.name) || viewing.kind === "report" ? (
                <Markdown content={viewing.content} />
              ) : (
                <pre className="whitespace-pre-wrap font-mono text-[12px] leading-5 text-[#d0d0d0]">{viewing.content}</pre>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const EVENT_TONE: Record<string, string> = {
  cycle_failed: "text-[#f07070]",
  agent_error: "text-[#f07070]",
  no_board_contact: "text-[#e6c07b]",
  capacity_backoff: "text-[#e6c07b]",
  stall: "text-[#e6c07b]",
  budget_warning: "text-[#e6c07b]",
  limit_budget: "text-[#f07070]",
  limit_deadline: "text-[#f07070]",
  limit_max_cycles: "text-[#f07070]",
  done: "text-[#3ecf8e]",
  build_approved: "text-[#3ecf8e]",
  verification: "text-[#7ee2c4]",
  agent_spawned: "text-[#8ec5ff]",
};

export function SwarmActivity({ events, agents }: { events: SwarmEventInfo[]; agents: SwarmAgentInfo[] }) {
  if (!events.length) return <Empty>No activity yet.</Empty>;
  return (
    <ol className="space-y-1.5">
      {events.map((e) => (
        <li key={e.id} className="flex gap-3 text-[12px]">
          <span className="w-20 shrink-0 text-right text-[11px] tabular-nums text-[#555]" title={new Date(e.createdAt).toLocaleString()}>
            {relativeTime(e.createdAt)}
          </span>
          <span className={`w-36 shrink-0 truncate font-mono text-[11px] ${EVENT_TONE[e.kind] ?? "text-[#6e6e6e]"}`}>{e.kind}</span>
          <span className="min-w-0 flex-1 text-[#a0a0a0]">
            {e.agentId && !e.message.includes("@") ? <span className="text-[#6e6e6e]">{labelFor(agents, e.agentId)} </span> : null}
            {e.message}
          </span>
        </li>
      ))}
    </ol>
  );
}
