"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { CircleDot } from "lucide-react";
import DashboardShell from "../../components/DashboardShell";
import CreateTeamCard from "../../components/CreateTeamCard";
import EmptyState from "../../components/EmptyState";
import IssueComposeModal from "../../components/issues/IssueComposeModal";
import { useAuth } from "../../components/AuthProvider";
import {
  fetchIssues,
  type IssueInfo,
} from "../../lib/api";
import { useWorkspaceScope } from "../../lib/useWorkspaceScope";
import IssuesGroupedList, {
  issueInfoToRow,
} from "../../components/issues/IssuesGroupedList";

export default function IssuesPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[#141414] flex items-center justify-center">
          <p className="text-[13px] text-[#6e6e6e]">Loading…</p>
        </div>
      }
    >
      <IssuesBody />
    </Suspense>
  );
}

function IssuesBody() {
  const router = useRouter();
  const search = useSearchParams();
  const { user, loading: authLoading } = useAuth();
  const workspace = useWorkspaceScope(search.get("org") || undefined);
  const [issues, setIssues] = useState<IssueInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const composeOpen = search.get("compose") === "1";

  useEffect(() => {
    if (authLoading || !user) return;
    workspace.reloadOrgs().catch(console.error);
  }, [user, authLoading, workspace.reloadOrgs]);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setIssues([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    const orgId = workspace.scope === "personal" ? "personal" : workspace.scope;
    setLoading(true);
    fetchIssues({ orgId })
      .then((list) => {
        if (!cancelled) setIssues(list);
      })
      .catch(console.error)
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    const interval = setInterval(() => {
      fetchIssues({ orgId })
        .then((list) => {
          if (!cancelled) setIssues(list);
        })
        .catch(console.error);
    }, 4000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [user, authLoading, workspace.scope]);

  const rows = useMemo(() => issues.map(issueInfoToRow), [issues]);
  const counts = useMemo(() => {
    const running = issues.filter((issue) => issue.status === "running").length;
    const queued = issues.filter((issue) => issue.status === "queued").length;
    return { running, queued };
  }, [issues]);

  const setCompose = (open: boolean) => {
    const params = new URLSearchParams(search.toString());
    if (open) params.set("compose", "1");
    else params.delete("compose");
    const qs = params.toString();
    router.replace(qs ? `/issues?${qs}` : "/issues", { scroll: false });
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
          <p className="text-[#a0a0a0] text-[14px] mb-5">
            Sign in to view issues.
          </p>
          <Link
            href="/login?redirect=/issues"
            className="inline-flex h-8 px-3.5 rounded-md bg-[#e4e4e4] text-[#141414] text-[13px] font-medium hover:bg-white transition-colors items-center"
          >
            Sign in
          </Link>
        </div>
      </div>
    );
  }

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
            <h1 className="text-[22px] font-medium text-[#e4e4e4] tracking-tight">
              Issues
            </h1>
            <p className="text-[13px] text-[#6e6e6e] mt-1">
              {loading
                ? "Loading issues…"
                : issues.length === 0
                  ? "Tickets the agent picks up in the background — they never appear in Sessions"
                  : `${issues.length} issue${issues.length === 1 ? "" : "s"}${
                      counts.running ? ` · ${counts.running} running` : ""
                    }${counts.queued ? ` · ${counts.queued} queued` : ""}`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/settings"
              className="h-9 px-3 rounded-md border border-[#2b2b2b] text-[13px] text-[#a0a0a0] hover:text-[#e4e4e4] inline-flex items-center"
            >
              Workspace settings
            </Link>
            <button
              type="button"
              onClick={() => setCompose(true)}
              className="inline-flex h-9 px-3.5 rounded-md bg-[#e4e4e4] text-[#141414] text-[13px] font-medium hover:bg-white transition-colors items-center"
            >
              New issue
            </button>
          </div>
        </div>

        {loading ? (
          <div className="rounded-lg border border-[#2b2b2b] bg-[#171717] divide-y divide-[#1f1f1f]">
            {[0, 1, 2, 3, 4].map((key) => (
              <div key={key} className="h-9 animate-pulse bg-[#1a1a1a]" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={CircleDot}
            title="No issues yet"
            description="Queue a ticket against a GitHub repo in this workspace. After the delay, a headless agent opens a PR and leaves a markdown note here — not in git, and not in Sessions."
            action={
              <button
                type="button"
                onClick={() => setCompose(true)}
                className="inline-flex h-9 px-4 rounded-md bg-[#e4e4e4] text-[#141414] text-[13px] font-medium hover:bg-white transition-colors items-center"
              >
                Create issue
              </button>
            }
          />
        ) : (
          <div className="overflow-hidden rounded-lg border border-[#2b2b2b] bg-[#141414]">
            <IssuesGroupedList items={rows} />
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
        <IssueComposeModal
          orgId={workspace.orgId}
          workspaceName={workspace.activeOrg?.name || "Personal"}
          onClose={() => setCompose(false)}
          onCreated={(issueId, createMore) => {
            void fetchIssues({
              orgId: workspace.scope === "personal" ? "personal" : workspace.scope,
            }).then(setIssues);
            if (!createMore) {
              setCompose(false);
              router.push(`/issues/${issueId}`);
            }
          }}
        />
      )}
    </DashboardShell>
  );
}
