"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Network, Users } from "lucide-react";
import DashboardShell from "../../components/DashboardShell";
import CreateTeamCard from "../../components/CreateTeamCard";
import EmptyState from "../../components/EmptyState";
import SwarmComposeModal from "../../components/swarm/SwarmComposeModal";
import { BudgetMeter, ModelChip, StatusPill, relativeTime } from "../../components/swarm/swarmUi";
import { useAuth } from "../../components/AuthProvider";
import { fetchSwarms, type SwarmInfo } from "../../lib/api";
import { useWorkspaceScope } from "../../lib/useWorkspaceScope";
import { isActiveSwarmStatus, isTerminalSwarmStatus } from "../../../shared/swarm";

export default function SwarmsPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[#141414] flex items-center justify-center">
          <p className="text-[13px] text-[#6e6e6e]">Loading…</p>
        </div>
      }
    >
      <SwarmsBody />
    </Suspense>
  );
}

const GROUPS: Array<{ key: string; label: string; match: (s: SwarmInfo) => boolean }> = [
  {
    key: "attention",
    label: "Needs you",
    match: (s) => s.status === "awaiting_approval" || (s.status === "paused" && s.stopReason === "needs_input"),
  },
  { key: "active", label: "Running", match: (s) => isActiveSwarmStatus(s.status) },
  {
    key: "idle",
    label: "Paused & drafts",
    match: (s) => s.status === "draft" || (s.status === "paused" && s.stopReason !== "needs_input"),
  },
  { key: "finished", label: "Finished", match: (s) => isTerminalSwarmStatus(s.status) },
];

function SwarmRow({ swarm }: { swarm: SwarmInfo }) {
  return (
    <Link
      href={`/swarms/${swarm.id}`}
      className="group flex flex-col gap-2 border-b border-[#1f1f1f] px-4 py-3 last:border-b-0 hover:bg-[#1a1a1a] sm:flex-row sm:items-center sm:gap-4"
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <StatusPill status={swarm.status} />
          <p className="truncate text-[13px] font-medium text-[#e4e4e4] group-hover:text-white">{swarm.title}</p>
          <ModelChip modelId={swarm.modelId} className="shrink-0" />
        </div>
        <p className="mt-1 line-clamp-1 text-[12px] text-[#6e6e6e]">{swarm.goal}</p>
      </div>
      <div className="flex shrink-0 items-center gap-5 text-[11px] text-[#a0a0a0]">
        <span className="inline-flex items-center gap-1.5 tabular-nums" title="Agents running / total">
          <Users className="h-3.5 w-3.5 text-[#6e6e6e]" strokeWidth={1.75} />
          {swarm.runningAgents ?? 0}/{swarm.totalAgents ?? 0}
        </span>
        <span className="tabular-nums text-[#6e6e6e]" title="Cycles">
          {swarm.cyclesDone} cycles
        </span>
        <BudgetMeter spent={swarm.spentUsd} budget={swarm.budgetUsd} compact />
        <span className="w-16 text-right text-[#6e6e6e]">{relativeTime(swarm.updatedAt)}</span>
      </div>
    </Link>
  );
}

function SwarmsBody() {
  const router = useRouter();
  const search = useSearchParams();
  const { user, loading: authLoading } = useAuth();
  const workspace = useWorkspaceScope(search.get("org") || undefined);
  const [swarms, setSwarms] = useState<SwarmInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const composeOpen = search.get("compose") === "1";

  useEffect(() => {
    if (authLoading || !user) return;
    workspace.reloadOrgs().catch(console.error);
  }, [user, authLoading, workspace.reloadOrgs]);

  const anyLive = swarms.some((s) => isActiveSwarmStatus(s.status));

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setSwarms([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    const orgId = workspace.scope === "personal" ? "personal" : workspace.scope;
    const load = () =>
      fetchSwarms({ orgId })
        .then((list) => {
          if (!cancelled) {
            setSwarms(list);
            setError("");
          }
        })
        .catch((err) => {
          if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load swarms");
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    setLoading(true);
    void load();
    const interval = setInterval(() => void load(), anyLive ? 5000 : 20000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [user, authLoading, workspace.scope, anyLive]);

  const groups = useMemo(
    () =>
      GROUPS.map((group) => ({ ...group, items: swarms.filter(group.match) })).filter(
        (group) => group.items.length > 0,
      ),
    [swarms],
  );

  const setCompose = (open: boolean) => {
    const params = new URLSearchParams(search.toString());
    if (open) params.set("compose", "1");
    else params.delete("compose");
    const qs = params.toString();
    router.replace(qs ? `/swarms?${qs}` : "/swarms", { scroll: false });
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-[#141414] flex items-center justify-center">
        <p className="text-[13px] text-[#6e6e6e]">Loading…</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-[#141414] flex items-center justify-center px-4">
        <div className="text-center">
          <p className="text-[#a0a0a0] text-[14px] mb-5">Sign in to view swarms.</p>
          <Link
            href="/login?redirect=/swarms"
            className="inline-flex h-8 px-3.5 rounded-md bg-[#e4e4e4] text-[#141414] text-[13px] font-medium hover:bg-white transition-colors items-center"
          >
            Sign in
          </Link>
        </div>
      </div>
    );
  }

  const live = swarms.filter((s) => isActiveSwarmStatus(s.status)).length;
  const runningAgents = swarms.reduce((sum, s) => sum + (s.runningAgents ?? 0), 0);

  return (
    <DashboardShell
      orgs={workspace.orgs}
      scope={workspace.scope}
      onSelectScope={workspace.selectScope}
      onNewTeam={() => workspace.setCreatingOrg((v) => !v)}
      creatingTeam={workspace.creatingOrg}
      createHref={workspace.sessionCreateHref}
      userName={user.name}
    >
      <main className="mx-auto w-full max-w-7xl px-4 sm:px-6 py-6 sm:py-8">
        <div className="mb-6 sm:mb-8 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
          <div>
            <p className="text-[11px] uppercase tracking-wide text-[#6e6e6e] mb-1">
              {workspace.activeOrg ? workspace.activeOrg.name : "Personal"}
            </p>
            <h1 className="text-[22px] font-medium text-[#e4e4e4] tracking-tight">Swarms</h1>
            <p className="text-[13px] text-[#6e6e6e] mt-1">
              {loading
                ? "Loading swarms…"
                : swarms.length === 0
                  ? "Teams of agents that research a hard problem for hours — and build it once you approve"
                  : `${swarms.length} swarm${swarms.length === 1 ? "" : "s"}${live ? ` · ${live} running · ${runningAgents} agent${runningAgents === 1 ? "" : "s"} active` : ""}`}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setCompose(true)}
            className="inline-flex h-9 px-3.5 rounded-md bg-[#e4e4e4] text-[#141414] text-[13px] font-medium hover:bg-white transition-colors items-center self-start sm:self-auto"
          >
            New swarm
          </button>
        </div>

        {error && <p className="mb-4 text-[12px] text-[#f07070]">{error}</p>}

        {loading && swarms.length === 0 ? (
          <div className="rounded-lg border border-[#2b2b2b] bg-[#171717] divide-y divide-[#1f1f1f]">
            {[0, 1, 2].map((key) => (
              <div key={key} className="h-16 animate-pulse bg-[#1a1a1a]" />
            ))}
          </div>
        ) : swarms.length === 0 ? (
          <EmptyState
            icon={Network}
            title="No swarms yet"
            description="Give a swarm a hard, open-ended goal. An orchestrator plans the work, spins up researchers, critics, and a ranker who talk on a shared message board, and keeps iterating until the report is verified — or the budget or deadline says stop."
            action={
              <button
                type="button"
                onClick={() => setCompose(true)}
                className="inline-flex h-9 px-4 rounded-md bg-[#e4e4e4] text-[#141414] text-[13px] font-medium hover:bg-white transition-colors items-center"
              >
                Launch a swarm
              </button>
            }
          />
        ) : (
          <div className="space-y-6">
            {groups.map((group) => (
              <section key={group.key}>
                <h2 className="mb-2 px-1 text-[11px] font-medium uppercase tracking-wide text-[#6e6e6e]">
                  {group.label} <span className="text-[#4a4a4a]">{group.items.length}</span>
                </h2>
                <div className="overflow-hidden rounded-lg border border-[#2b2b2b] bg-[#141414]">
                  {group.items.map((swarm) => (
                    <SwarmRow key={swarm.id} swarm={swarm} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </main>

      {workspace.creatingOrg && (
        <CreateTeamCard
          name={workspace.newOrgName}
          onNameChange={workspace.setNewOrgName}
          onCreate={() => void workspace.handleCreateOrg()}
          onCancel={() => workspace.setCreatingOrg(false)}
          busy={workspace.busyOrg}
          error={workspace.orgError}
        />
      )}

      {composeOpen && (
        <SwarmComposeModal
          orgId={workspace.orgId}
          workspaceName={workspace.activeOrg?.name || "Personal"}
          onClose={() => setCompose(false)}
          onCreated={(swarmId) => {
            setCompose(false);
            router.push(`/swarms/${swarmId}`);
          }}
        />
      )}
    </DashboardShell>
  );
}
