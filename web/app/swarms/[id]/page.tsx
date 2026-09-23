"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  Activity,
  BookOpen,
  Bot,
  Download,
  FileText,
  GitBranch,
  ListChecks,
  MessagesSquare,
  Pause,
  Play,
  Settings2,
  Square,
  Trophy,
} from "lucide-react";
import DashboardShell from "../../../components/DashboardShell";
import Markdown from "../../../components/Markdown";
import { useAuth } from "../../../components/AuthProvider";
import SwarmBoard from "../../../components/swarm/SwarmBoard";
import SwarmAgents from "../../../components/swarm/SwarmAgents";
import {
  SwarmActivity,
  SwarmArtifacts,
  SwarmHypotheses,
  SwarmLedger,
  SwarmTasks,
} from "../../../components/swarm/SwarmPanels";
import {
  BudgetMeter,
  ModelChip,
  PhaseStepper,
  StatusPill,
  formatUsd,
  relativeTime,
} from "../../../components/swarm/swarmUi";
import {
  deleteSwarm,
  downloadSwarmExport,
  fetchSwarm,
  swarmAction,
  updateSwarm,
  type SwarmAction,
  type SwarmSnapshot,
} from "../../../lib/api";
import { useWorkspaceScope } from "../../../lib/useWorkspaceScope";
import {
  MAX_SWARM_RUNNING,
  MAX_SWARM_WORKERS,
  canPauseSwarm,
  canResumeSwarm,
  canStartSwarm,
  canStopSwarm,
  isActiveSwarmStatus,
  isTerminalSwarmStatus,
} from "../../../../shared/swarm";

type Tab = "board" | "agents" | "tasks" | "hypotheses" | "ledger" | "artifacts" | "activity";

const PAUSE_REASONS: Record<string, string> = {
  budget: "The budget is used up. Raise it to let the swarm keep going.",
  needs_input: "The swarm needs direction. Post a directive on the board — it resumes automatically.",
  paused_by_user: "Paused. Running cycles finished; nothing new starts until you resume.",
  needs_key: "No Cursor API key for this workspace. Add a team key or your BYOK key in Settings, then resume.",
};

const STOP_REASONS: Record<string, string> = {
  deadline: "Stopped at the deadline.",
  max_cycles: "Stopped after reaching the cycle cap.",
  stopped_by_user: "Stopped manually.",
  completed: "Finished — the verifier passed the report.",
};

export default function SwarmDetailPage() {
  const params = useParams<{ id: string }>();
  const id = Array.isArray(params.id) ? params.id[0]! : params.id;
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [snap, setSnap] = useState<SwarmSnapshot | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("board");
  const [goalOpen, setGoalOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [approvalNote, setApprovalNote] = useState("");
  const workspace = useWorkspaceScope(snap?.swarm.orgId || undefined);

  useEffect(() => {
    if (authLoading || !user) return;
    workspace.reloadOrgs().catch(console.error);
  }, [user, authLoading, workspace.reloadOrgs]);

  const load = useCallback(async () => {
    try {
      const next = await fetchSwarm(id);
      setSnap(next);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Swarm not found");
    }
  }, [id]);

  const status = snap?.swarm.status;
  const anyRunning = snap?.agents.some((a) => a.status === "running") ?? false;
  const pollMs = !status
    ? 0
    : isActiveSwarmStatus(status) || anyRunning
      ? 4000
      : isTerminalSwarmStatus(status)
        ? 0
        : 15000;

  useEffect(() => {
    if (authLoading || !user || !id) return;
    void load();
  }, [authLoading, user, id, load]);

  useEffect(() => {
    if (!pollMs) return;
    const interval = setInterval(() => void load(), pollMs);
    return () => clearInterval(interval);
  }, [pollMs, load]);

  const act = async (action: SwarmAction, body?: { note?: string }) => {
    if (action === "stop" && !window.confirm("Stop this swarm? Running agents are cancelled and it cannot be resumed.")) return;
    setBusy(action);
    setError("");
    try {
      setSnap(await swarmAction(id, action, body));
      if (action === "approve" || action === "reject") setApprovalNote("");
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to ${action}`);
    } finally {
      setBusy(null);
    }
  };

  const patch = async (data: Parameters<typeof updateSwarm>[1]) => {
    setBusy("settings");
    setError("");
    try {
      setSnap(await updateSwarm(id, data));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update");
    } finally {
      setBusy(null);
    }
  };

  const counts = useMemo(() => {
    if (!snap) return null;
    return {
      running: snap.agents.filter((a) => a.status === "running").length,
      agents: snap.agents.filter((a) => a.status !== "retired").length,
      tasksDone: snap.tasks.filter((t) => t.status === "done").length,
      tasks: snap.tasks.filter((t) => t.status !== "cancelled").length,
      hypotheses: snap.hypotheses.filter((h) => h.status !== "rejected").length,
      critiqued: snap.hypotheses.filter((h) => h.critiques > 0).length,
      artifacts: snap.artifacts.length,
      posts: snap.posts.length,
    };
  }, [snap]);

  if (authLoading || (!snap && !error)) {
    return (
      <div className="min-h-screen bg-[#141414] flex items-center justify-center">
        <p className="text-[13px] text-[#6e6e6e]">Loading swarm…</p>
      </div>
    );
  }

  if (!user) {
    router.replace(`/login?redirect=/swarms/${id}`);
    return null;
  }

  const swarm = snap?.swarm;
  const tabs: Array<{ key: Tab; label: string; icon: typeof Bot; count?: number }> = [
    { key: "board", label: "Board", icon: MessagesSquare, count: counts?.posts },
    { key: "agents", label: "Agents", icon: Bot, count: counts?.agents },
    { key: "tasks", label: "Tasks", icon: ListChecks, count: counts?.tasks },
    { key: "hypotheses", label: "Hypotheses", icon: Trophy, count: counts?.hypotheses },
    { key: "ledger", label: "Ledger", icon: BookOpen },
    { key: "artifacts", label: "Artifacts", icon: FileText, count: counts?.artifacts },
    { key: "activity", label: "Activity", icon: Activity },
  ];

  return (
    <DashboardShell
      orgs={workspace.orgs}
      scope={workspace.scope}
      onSelectScope={(next) => {
        workspace.selectScope(next);
        router.push("/swarms");
      }}
      onNewTeam={() => undefined}
      createHref={workspace.sessionCreateHref}
      userName={user.name}
    >
      <main className="mx-auto w-full max-w-7xl px-4 sm:px-6 py-6 sm:py-8">
        <Link href="/swarms" className="text-[12px] text-[#6e6e6e] hover:text-[#e4e4e4]">
          ← Swarms
        </Link>

        {error && !snap && <p className="mt-6 text-[13px] text-[#f07070]">{error}</p>}

        {snap && swarm && counts && (
          <>
            <header className="mt-3 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusPill status={swarm.status} />
                  <h1 className="text-[22px] font-medium tracking-tight text-[#e4e4e4]">{swarm.title}</h1>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-[#6e6e6e]">
                  <span>{workspace.activeOrg?.name || (swarm.orgId ? "Team" : "Personal")}</span>
                  <ModelChip modelId={swarm.modelId} />
                  {swarm.repoUrl && (
                    <span className="inline-flex items-center gap-1">
                      <GitBranch className="h-3 w-3" strokeWidth={1.75} />
                      {swarm.repoUrl.replace("https://github.com/", "")}
                    </span>
                  )}
                  <span>{swarm.cyclesDone} cycles</span>
                  {swarm.deadlineAt && !isTerminalSwarmStatus(swarm.status) && (
                    <span title={new Date(swarm.deadlineAt).toLocaleString()}>deadline {relativeTime(swarm.deadlineAt)}</span>
                  )}
                  {swarm.creatorName && <span>by {swarm.creatorName}</span>}
                </div>
                <div className="mt-3">
                  <PhaseStepper swarm={swarm} />
                </div>
              </div>

              <div className="flex w-full flex-col gap-3 lg:w-80">
                <BudgetMeter spent={swarm.spentUsd} budget={swarm.budgetUsd} />
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={busy === "export"}
                    title="Zip of the mission, agents, transcripts, board, questions, tasks, hypotheses, ledger, artifacts, and activity"
                    onClick={() => {
                      setBusy("export");
                      setError("");
                      void downloadSwarmExport(id)
                        .catch((err) => setError(err instanceof Error ? err.message : "Export failed"))
                        .finally(() => setBusy(null));
                    }}
                    className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[#2b2b2b] px-3 text-[12px] text-[#e4e4e4] hover:border-[#3c3c3c] disabled:opacity-50"
                  >
                    <Download className="h-3.5 w-3.5" strokeWidth={1.75} />
                    {busy === "export" ? "Exporting…" : "Export"}
                  </button>
                {snap.canEdit && (
                  <>
                    {canStartSwarm(swarm.status) && (
                      <button
                        type="button"
                        disabled={Boolean(busy)}
                        onClick={() => void act("start")}
                        className="inline-flex h-8 items-center gap-1.5 rounded-md bg-[#e4e4e4] px-3 text-[12px] font-medium text-[#141414] hover:bg-white disabled:opacity-50"
                      >
                        <Play className="h-3.5 w-3.5" strokeWidth={2} /> Start
                      </button>
                    )}
                    {canResumeSwarm(swarm.status) && (
                      <button
                        type="button"
                        disabled={Boolean(busy)}
                        onClick={() => void act("resume")}
                        className="inline-flex h-8 items-center gap-1.5 rounded-md bg-[#e4e4e4] px-3 text-[12px] font-medium text-[#141414] hover:bg-white disabled:opacity-50"
                      >
                        <Play className="h-3.5 w-3.5" strokeWidth={2} /> Resume
                      </button>
                    )}
                    {canPauseSwarm(swarm.status) && (
                      <button
                        type="button"
                        disabled={Boolean(busy)}
                        onClick={() => void act("pause")}
                        className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[#2b2b2b] px-3 text-[12px] text-[#e4e4e4] hover:border-[#3c3c3c] disabled:opacity-50"
                      >
                        <Pause className="h-3.5 w-3.5" strokeWidth={2} /> Pause
                      </button>
                    )}
                    {canStopSwarm(swarm.status) && (
                      <button
                        type="button"
                        disabled={Boolean(busy)}
                        onClick={() => void act("stop")}
                        className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[#2b2b2b] px-3 text-[12px] text-[#f07070] hover:border-[#4a2626] disabled:opacity-50"
                      >
                        <Square className="h-3 w-3" strokeWidth={2} /> Stop
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setSettingsOpen((v) => !v)}
                      className="ml-auto inline-flex h-8 w-8 items-center justify-center rounded-md border border-[#2b2b2b] text-[#6e6e6e] hover:text-[#e4e4e4]"
                      aria-label="Swarm settings"
                    >
                      <Settings2 className="h-4 w-4" strokeWidth={1.75} />
                    </button>
                  </>
                )}
                </div>
              </div>
            </header>

            {error && <p className="mt-3 text-[12px] text-[#f07070]">{error}</p>}

            {settingsOpen && snap.canEdit && (
              <SettingsPanel
                snap={snap}
                busy={busy === "settings"}
                onSave={(data) => void patch(data)}
                onDelete={async () => {
                  if (!window.confirm("Delete this swarm and everything it produced?")) return;
                  try {
                    await deleteSwarm(id);
                    router.push("/swarms");
                  } catch (err) {
                    setError(err instanceof Error ? err.message : "Delete failed");
                  }
                }}
              />
            )}

            {swarm.status === "awaiting_approval" && (
              <section className="mt-5 rounded-xl border border-[#4a3d1f] bg-[#1d1810] p-4">
                <p className="text-[11px] font-medium uppercase tracking-wide text-[#e6c07b]">Build phase approval</p>
                <p className="mt-1 text-[12px] text-[#a0a0a0]">
                  Research is done. The orchestrator wants to prototype this on{" "}
                  <span className="text-[#e4e4e4]">{swarm.repoUrl?.replace("https://github.com/", "")}</span> — on
                  branches, ending in one pull request.
                </p>
                {swarm.approvalNote && (
                  <div className="mt-3 rounded-lg border border-[#2e2818] bg-[#16130c] px-3 py-2">
                    <Markdown content={swarm.approvalNote} />
                  </div>
                )}
                {snap.canEdit && (
                  <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
                    <input
                      value={approvalNote}
                      onChange={(e) => setApprovalNote(e.target.value)}
                      placeholder="Optional note for the swarm"
                      className="h-8 flex-1 rounded-md border border-[#2b2b2b] bg-[#141414] px-2.5 text-[12px] text-[#e4e4e4] outline-none focus:border-[#e6c07b]"
                    />
                    <button
                      type="button"
                      disabled={Boolean(busy)}
                      onClick={() => void act("approve", { note: approvalNote })}
                      className="h-8 rounded-md bg-[#e6c07b] px-3 text-[12px] font-medium text-[#141414] hover:bg-[#f0cc8a] disabled:opacity-50"
                    >
                      Approve build
                    </button>
                    <button
                      type="button"
                      disabled={Boolean(busy)}
                      onClick={() => void act("reject", { note: approvalNote })}
                      className="h-8 rounded-md border border-[#2b2b2b] px-3 text-[12px] text-[#e4e4e4] hover:border-[#3c3c3c] disabled:opacity-50"
                    >
                      Keep researching
                    </button>
                  </div>
                )}
              </section>
            )}

            {swarm.status === "paused" && (
              <div className="mt-5 flex flex-wrap items-center gap-3 rounded-xl border border-[#3c3420] bg-[#1c1911] px-4 py-3 text-[12px] text-[#e6c07b]">
                <span>{PAUSE_REASONS[swarm.stopReason || ""] || "Paused."}</span>
                {swarm.stopReason === "budget" && snap.canEdit && (
                  <button
                    type="button"
                    disabled={Boolean(busy)}
                    onClick={() => void patch({ budgetUsd: Math.ceil(swarm.budgetUsd * 1.5) })}
                    className="h-7 rounded-md border border-[#4a3d1f] px-2.5 text-[11px] text-[#e4e4e4] hover:border-[#6b5a2d]"
                  >
                    Raise to {formatUsd(Math.ceil(swarm.budgetUsd * 1.5))}
                  </button>
                )}
                {swarm.stopReason === "needs_input" && (
                  <button type="button" onClick={() => setTab("board")} className="text-[11px] text-[#e4e4e4] underline">
                    Open the board
                  </button>
                )}
              </div>
            )}

            {isTerminalSwarmStatus(swarm.status) && swarm.stopReason && (
              <div
                className={`mt-5 rounded-xl border px-4 py-3 text-[12px] ${
                  swarm.status === "done"
                    ? "border-[#1f3d2e] bg-[#121c16] text-[#3ecf8e]"
                    : "border-[#2b2b2b] bg-[#171717] text-[#a0a0a0]"
                }`}
              >
                {STOP_REASONS[swarm.stopReason] || `Ended: ${swarm.stopReason}`}
                {snap.artifacts.some((a) => a.kind === "report") && (
                  <button type="button" onClick={() => setTab("artifacts")} className="ml-2 underline">
                    Read the report
                  </button>
                )}
              </div>
            )}

            <section className="mt-5 rounded-xl border border-[#2b2b2b] bg-[#161616] px-4 py-3">
              <button
                type="button"
                onClick={() => setGoalOpen((v) => !v)}
                className="flex w-full items-center justify-between text-left"
              >
                <span className="text-[11px] uppercase tracking-wide text-[#6e6e6e]">Mission</span>
                <span className="text-[11px] text-[#6e6e6e]">{goalOpen ? "Collapse" : "Expand"}</span>
              </button>
              <p className={`mt-1.5 whitespace-pre-wrap text-[13px] leading-6 text-[#d0d0d0] ${goalOpen ? "" : "line-clamp-2"}`}>
                {swarm.goal}
              </p>
            </section>

            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                { label: "Agents working", value: `${counts.running} / ${counts.agents}` },
                { label: "Tasks done", value: `${counts.tasksDone} / ${counts.tasks}` },
                { label: "Hypotheses critiqued", value: `${counts.critiqued} / ${counts.hypotheses}` },
                { label: "Spend", value: `${formatUsd(swarm.spentUsd)}${swarm.tokensUsed ? ` · ${(swarm.tokensUsed / 1000).toFixed(0)}k tok` : ""}` },
              ].map((stat) => (
                <div key={stat.label} className="rounded-lg border border-[#232323] bg-[#161616] px-3 py-2.5">
                  <p className="text-[11px] text-[#6e6e6e]">{stat.label}</p>
                  <p className="mt-0.5 text-[15px] font-medium tabular-nums text-[#e4e4e4]">{stat.value}</p>
                </div>
              ))}
            </div>

            <nav className="mt-6 flex gap-1 overflow-x-auto border-b border-[#222]" aria-label="Swarm sections">
              {tabs.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setTab(t.key)}
                  className={`-mb-px inline-flex h-9 shrink-0 items-center gap-1.5 border-b-2 px-3 text-[12px] transition-colors ${
                    tab === t.key
                      ? "border-[#e4e4e4] text-[#e4e4e4]"
                      : "border-transparent text-[#6e6e6e] hover:text-[#e4e4e4]"
                  }`}
                >
                  <t.icon className="h-3.5 w-3.5" strokeWidth={1.75} />
                  {t.label}
                  {t.count !== undefined && <span className="tabular-nums text-[#555]">{t.count}</span>}
                </button>
              ))}
            </nav>

            <div className="mt-4 pb-10">
              {tab === "board" && (
                <SwarmBoard swarmId={id} posts={snap.posts} agents={snap.agents} canEdit={snap.canEdit} onPosted={() => void load()} />
              )}
              {tab === "agents" && <SwarmAgents swarmId={id} agents={snap.agents} tasks={snap.tasks} />}
              {tab === "tasks" && <SwarmTasks tasks={snap.tasks} agents={snap.agents} />}
              {tab === "hypotheses" && (
                <SwarmHypotheses hypotheses={snap.hypotheses} critiques={snap.critiques} agents={snap.agents} />
              )}
              {tab === "ledger" && <SwarmLedger ledger={snap.ledger} />}
              {tab === "artifacts" && <SwarmArtifacts swarmId={id} artifacts={snap.artifacts} agents={snap.agents} />}
              {tab === "activity" && <SwarmActivity events={snap.events} agents={snap.agents} />}
            </div>
          </>
        )}
      </main>
    </DashboardShell>
  );
}

function SettingsPanel({
  snap,
  busy,
  onSave,
  onDelete,
}: {
  snap: SwarmSnapshot;
  busy: boolean;
  onSave: (data: Parameters<typeof updateSwarm>[1]) => void;
  onDelete: () => void;
}) {
  const s = snap.swarm;
  const [budget, setBudget] = useState(String(s.budgetUsd));
  const [extendHours, setExtendHours] = useState("");
  const [maxWorkers, setMaxWorkers] = useState(s.maxWorkers);
  const [maxRunning, setMaxRunning] = useState(s.maxRunning);
  const deletable = isTerminalSwarmStatus(s.status) || s.status === "draft" || s.status === "paused";

  return (
    <section className="mt-5 rounded-xl border border-[#2b2b2b] bg-[#161616] p-4">
      <div className="grid gap-3 sm:grid-cols-4">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-[#6e6e6e]">Budget (USD)</span>
          <input
            value={budget}
            onChange={(e) => setBudget(e.target.value.replace(/[^\d.]/g, ""))}
            className="h-8 rounded-md border border-[#2b2b2b] bg-[#1a1a1a] px-2 text-[12px] tabular-nums text-[#e4e4e4] outline-none focus:border-[#4d9fff]"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-[#6e6e6e]">New deadline (hours from now)</span>
          <input
            value={extendHours}
            onChange={(e) => setExtendHours(e.target.value.replace(/[^\d]/g, ""))}
            placeholder={s.deadlineAt ? relativeTime(s.deadlineAt) : "e.g. 24"}
            className="h-8 rounded-md border border-[#2b2b2b] bg-[#1a1a1a] px-2 text-[12px] tabular-nums text-[#e4e4e4] outline-none focus:border-[#4d9fff]"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-[#6e6e6e]">Max workers</span>
          <select
            value={maxWorkers}
            onChange={(e) => setMaxWorkers(Number(e.target.value))}
            className="h-8 rounded-md border border-[#2b2b2b] bg-[#1a1a1a] px-2 text-[12px] text-[#e4e4e4] outline-none"
          >
            {Array.from({ length: MAX_SWARM_WORKERS }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-[#6e6e6e]">Run in parallel</span>
          <select
            value={maxRunning}
            onChange={(e) => setMaxRunning(Number(e.target.value))}
            className="h-8 rounded-md border border-[#2b2b2b] bg-[#1a1a1a] px-2 text-[12px] text-[#e4e4e4] outline-none"
          >
            {Array.from({ length: MAX_SWARM_RUNNING }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            onSave({
              budgetUsd: Number(budget) || s.budgetUsd,
              maxWorkers,
              maxRunning,
              ...(extendHours ? { deadlineHours: Number(extendHours) } : {}),
            })
          }
          className="h-8 rounded-md bg-[#e4e4e4] px-3 text-[12px] font-medium text-[#141414] hover:bg-white disabled:opacity-50"
        >
          {busy ? "Saving…" : "Save"}
        </button>
        {deletable && (
          <button
            type="button"
            onClick={onDelete}
            className="ml-auto h-8 rounded-md px-3 text-[12px] text-[#6e6e6e] hover:text-[#f07070]"
          >
            Delete swarm
          </button>
        )}
      </div>
    </section>
  );
}
