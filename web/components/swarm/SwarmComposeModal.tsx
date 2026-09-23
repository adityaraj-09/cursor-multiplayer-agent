"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, GitBranch, Network, X } from "lucide-react";
import {
  createSwarm,
  fetchWorkspaceGithubRepos,
  type WorkspaceGithubRepo,
} from "../../lib/api";
import {
  DEFAULT_SWARM_BUDGET_USD,
  DEFAULT_SWARM_MAX_RUNNING,
  DEFAULT_SWARM_MAX_WORKERS,
  MAX_SWARM_RUNNING,
  MAX_SWARM_WORKERS,
} from "../../../shared/swarm";

const DEADLINES = [
  { hours: 6, label: "6 hours" },
  { hours: 12, label: "12 hours" },
  { hours: 24, label: "1 day" },
  { hours: 72, label: "3 days" },
  { hours: 168, label: "1 week" },
];

const EXAMPLES = [
  "Find a new method to host LLMs that beats a vLLM-like engine on cost per token. Survey KV-cache, batching, speculative decoding, and disaggregated serving; rank the ideas and design a prototype.",
  "Research how to cut our API's p99 latency in half. Compare caching, connection pooling, and async I/O approaches with evidence, then propose the top change.",
];

function Stepper({
  label,
  value,
  min,
  max,
  onChange,
  suffix,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (next: number) => void;
  suffix?: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] text-[#6e6e6e]">{label}</span>
      <div className="flex h-8 items-center rounded-md border border-[#2b2b2b] bg-[#1a1a1a]">
        <button
          type="button"
          onClick={() => onChange(Math.max(min, value - 1))}
          className="h-full w-7 text-[#6e6e6e] hover:text-[#e4e4e4]"
          aria-label={`Decrease ${label}`}
        >
          −
        </button>
        <span className="flex-1 text-center text-[12px] tabular-nums text-[#e4e4e4]">
          {value}
          {suffix}
        </span>
        <button
          type="button"
          onClick={() => onChange(Math.min(max, value + 1))}
          className="h-full w-7 text-[#6e6e6e] hover:text-[#e4e4e4]"
          aria-label={`Increase ${label}`}
        >
          +
        </button>
      </div>
    </label>
  );
}

export default function SwarmComposeModal({
  orgId,
  workspaceName,
  onClose,
  onCreated,
}: {
  orgId?: string;
  workspaceName: string;
  onClose: () => void;
  onCreated: (swarmId: string) => void;
}) {
  const goalRef = useRef<HTMLTextAreaElement>(null);
  const [title, setTitle] = useState("");
  const [goal, setGoal] = useState("");
  const [repos, setRepos] = useState<WorkspaceGithubRepo[]>([]);
  const [repoUrl, setRepoUrl] = useState("");
  const [startingRef, setStartingRef] = useState("main");
  const [repoOpen, setRepoOpen] = useState(false);
  const [budget, setBudget] = useState(String(DEFAULT_SWARM_BUDGET_USD));
  const [deadlineHours, setDeadlineHours] = useState(24);
  const [maxWorkers, setMaxWorkers] = useState(DEFAULT_SWARM_MAX_WORKERS);
  const [maxRunning, setMaxRunning] = useState(DEFAULT_SWARM_MAX_RUNNING);
  const [startNow, setStartNow] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    goalRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    fetchWorkspaceGithubRepos({ orgId })
      .then((list) => {
        if (!cancelled) setRepos(list);
      })
      .catch(() => {
        if (!cancelled) setRepos([]);
      });
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  const selectedRepo = repos.find((r) => r.url === repoUrl) || null;
  const budgetNumber = Number(budget);
  const canSubmit = goal.trim().length >= 20 && Number.isFinite(budgetNumber) && budgetNumber >= 1 && !busy;

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError("");
    try {
      const snap = await createSwarm({
        goal: goal.trim(),
        title: title.trim() || undefined,
        orgId: orgId || null,
        repoUrl: repoUrl || undefined,
        startingRef: repoUrl ? startingRef : undefined,
        budgetUsd: budgetNumber,
        deadlineHours,
        maxWorkers,
        maxRunning: Math.min(maxRunning, maxWorkers + 1),
        autoStart: startNow,
      });
      onCreated(snap.swarm.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create swarm");
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 px-4 pt-[8vh] pb-8 backdrop-blur-[2px]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="New swarm"
        className="w-full max-w-2xl overflow-hidden rounded-xl border border-[#2b2b2b] bg-[#161616] shadow-2xl animate-fade-up"
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === "Enter") void submit();
        }}
      >
        <div className="flex items-center gap-2 border-b border-[#222] px-4 py-3">
          <span className="inline-flex h-5 items-center gap-1 rounded bg-[#222] px-1.5 text-[10px] font-medium uppercase tracking-wide text-[#a0a0a0]">
            {workspaceName}
          </span>
          <span className="text-[12px] text-[#6e6e6e]">›</span>
          <span className="inline-flex items-center gap-1.5 text-[12px] text-[#e4e4e4]">
            <Network className="h-3.5 w-3.5 text-[#8ec5ff]" strokeWidth={1.75} />
            New swarm
          </span>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto inline-flex h-7 w-7 items-center justify-center rounded-md text-[#6e6e6e] hover:bg-[#222] hover:text-[#e4e4e4]"
            aria-label="Close"
          >
            <X className="h-4 w-4" strokeWidth={1.75} />
          </button>
        </div>

        <div className="px-4 pt-4">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Swarm title (optional)"
            maxLength={160}
            className="w-full bg-transparent text-[18px] font-medium text-[#e4e4e4] placeholder:text-[#4a4a4a] outline-none"
          />
          <textarea
            ref={goalRef}
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            rows={7}
            placeholder="What should the swarm figure out? Describe the goal, constraints, and what a great answer looks like. The orchestrator plans the work, spins up researchers, critics, and rankers, and keeps going until the finish gates pass or the budget runs out."
            className="mt-2 w-full resize-none bg-transparent text-[13px] leading-6 text-[#d0d0d0] placeholder:text-[#4a4a4a] outline-none"
          />
          {!goal && (
            <div className="mb-3 flex flex-wrap gap-2">
              {EXAMPLES.map((example) => (
                <button
                  key={example}
                  type="button"
                  onClick={() => setGoal(example)}
                  className="max-w-full truncate rounded-full border border-[#2b2b2b] px-2.5 py-1 text-left text-[11px] text-[#a0a0a0] hover:border-[#3c3c3c] hover:text-[#e4e4e4]"
                >
                  {example.slice(0, 72)}…
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="border-t border-[#222] px-4 py-3">
          <div className="relative mb-3">
            <button
              type="button"
              onClick={() => setRepoOpen((v) => !v)}
              className="inline-flex h-7 max-w-full items-center gap-1.5 rounded-md border border-[#2b2b2b] bg-[#1a1a1a] px-2 text-[12px] text-[#d0d0d0] hover:border-[#3c3c3c]"
            >
              <GitBranch className="h-3.5 w-3.5 text-[#6e6e6e]" strokeWidth={1.75} />
              <span className="truncate">{selectedRepo ? selectedRepo.fullName : "Research only (no repository)"}</span>
              <ChevronDown className="h-3 w-3 text-[#6e6e6e]" strokeWidth={1.75} />
            </button>
            <span className="ml-2 text-[11px] text-[#6e6e6e]">
              {selectedRepo
                ? "After research, the swarm can ask you to approve a build phase on this repo."
                : "Pick a repo if you want the swarm to prototype code after research."}
            </span>
            {repoOpen && (
              <div className="absolute left-0 top-8 z-10 max-h-64 w-80 overflow-y-auto rounded-lg border border-[#2b2b2b] bg-[#1a1a1a] p-1 shadow-xl">
                <button
                  type="button"
                  onClick={() => {
                    setRepoUrl("");
                    setRepoOpen(false);
                  }}
                  className="block w-full rounded-md px-2 py-1.5 text-left text-[12px] text-[#d0d0d0] hover:bg-[#252525]"
                >
                  Research only (no repository)
                </button>
                {repos.map((repo) => (
                  <button
                    key={repo.url}
                    type="button"
                    onClick={() => {
                      setRepoUrl(repo.url);
                      setStartingRef(repo.defaultBranch || "main");
                      setRepoOpen(false);
                    }}
                    className="block w-full truncate rounded-md px-2 py-1.5 text-left text-[12px] text-[#d0d0d0] hover:bg-[#252525]"
                  >
                    {repo.fullName}
                    {repo.private ? <span className="ml-1 text-[10px] text-[#6e6e6e]">private</span> : null}
                  </button>
                ))}
                {repos.length === 0 && (
                  <p className="px-2 py-1.5 text-[11px] text-[#6e6e6e]">Connect GitHub in Settings to list repositories.</p>
                )}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-[#6e6e6e]">Budget (USD)</span>
              <div className="flex h-8 items-center rounded-md border border-[#2b2b2b] bg-[#1a1a1a] px-2 focus-within:border-[#4d9fff]">
                <span className="text-[12px] text-[#6e6e6e]">$</span>
                <input
                  value={budget}
                  onChange={(e) => setBudget(e.target.value.replace(/[^\d.]/g, ""))}
                  inputMode="decimal"
                  className="w-full bg-transparent pl-1 text-[12px] tabular-nums text-[#e4e4e4] outline-none"
                />
              </div>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-[#6e6e6e]">Keep going for</span>
              <select
                value={deadlineHours}
                onChange={(e) => setDeadlineHours(Number(e.target.value))}
                className="h-8 rounded-md border border-[#2b2b2b] bg-[#1a1a1a] px-2 text-[12px] text-[#e4e4e4] outline-none focus:border-[#4d9fff]"
              >
                {DEADLINES.map((d) => (
                  <option key={d.hours} value={d.hours}>
                    {d.label}
                  </option>
                ))}
              </select>
            </label>
            <Stepper label="Max workers" value={maxWorkers} min={1} max={MAX_SWARM_WORKERS} onChange={setMaxWorkers} />
            <Stepper label="Run in parallel" value={maxRunning} min={1} max={MAX_SWARM_RUNNING} onChange={setMaxRunning} />
          </div>
          <p className="mt-2 text-[11px] leading-5 text-[#6e6e6e]">
            Runs on Cursor Cloud with this workspace&apos;s key. Multi-agent research uses roughly 15× the tokens of a single chat — the swarm pauses itself at the budget and stops at the deadline.
          </p>
        </div>

        {error && <p className="px-4 pb-2 text-[12px] text-[#f07070]">{error}</p>}

        <div className="flex items-center justify-between gap-3 border-t border-[#222] px-4 py-3">
          <label className="inline-flex cursor-pointer items-center gap-2 text-[12px] text-[#a0a0a0]">
            <input
              type="checkbox"
              checked={startNow}
              onChange={(e) => setStartNow(e.target.checked)}
              className="h-3.5 w-3.5 accent-[#4d9fff]"
            />
            Start immediately
          </label>
          <div className="flex items-center gap-2">
            <span className="hidden text-[11px] text-[#555] sm:inline">⌘↵</span>
            <button
              type="button"
              disabled={!canSubmit}
              onClick={() => void submit()}
              className="inline-flex h-8 items-center rounded-md bg-[#e4e4e4] px-3.5 text-[12px] font-medium text-[#141414] hover:bg-white disabled:opacity-40"
            >
              {busy ? "Creating…" : startNow ? "Launch swarm" : "Create draft"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
