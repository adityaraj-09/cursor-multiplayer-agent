"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import DashboardShell from "../../components/DashboardShell";
import { useAuth } from "../../components/AuthProvider";
import {
  fetchIssues,
  fetchIssueSettings,
  fetchOrgs,
  fetchJoinableOrgs,
  updateIssueSettings,
  type IssueInfo,
  type IssueSettingsInfo,
  type OrgInfo,
} from "../../lib/api";
import {
  readSelectedWorkspace,
  writeSelectedWorkspace,
  type WorkspaceScope,
} from "../../lib/workspace";
import {
  issueStatusLabel,
  type IssueStatus,
} from "../../../shared/issues";

const FILTERS: Array<IssueStatus | "all"> = [
  "all",
  "queued",
  "running",
  "in_review",
  "failed",
  "done",
];

function statusTone(status: IssueStatus): string {
  switch (status) {
    case "running":
      return "border-[#26405d] bg-[#17202a] text-[#8ec5ff]";
    case "queued":
      return "border-[#3c3420] bg-[#1f1b12] text-[#e6c07b]";
    case "in_review":
      return "border-[#1f3d2e] bg-[#142019] text-[#3ecf8e]";
    case "done":
      return "border-[#2b2b2b] bg-[#1a1a1a] text-[#a0a0a0]";
    case "failed":
    case "cancelled":
      return "border-[#3c2b2b] bg-[#1a1414] text-[#f07070]";
    case "needs_input":
      return "border-[#3c3420] bg-[#1f1b12] text-[#e6c07b]";
    default:
      return "border-[#2b2b2b] bg-[#1a1a1a] text-[#a0a0a0]";
  }
}

function repoLabel(url: string): string {
  return url.replace(/^https:\/\/github\.com\//i, "");
}

export default function IssuesPage() {
  const { user, loading: authLoading } = useAuth();
  const [orgs, setOrgs] = useState<OrgInfo[]>([]);
  const [scope, setScope] = useState<WorkspaceScope>("personal");
  const [issues, setIssues] = useState<IssueInfo[]>([]);
  const [settings, setSettings] = useState<IssueSettingsInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<IssueStatus | "all">("all");
  const [creatingOrg, setCreatingOrg] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [delayMin, setDelayMin] = useState("10");
  const [autoStart, setAutoStart] = useState(true);
  const [maxConcurrent, setMaxConcurrent] = useState("2");
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [settingsError, setSettingsError] = useState("");

  useEffect(() => {
    setScope(readSelectedWorkspace());
  }, []);

  useEffect(() => {
    if (authLoading || !user) return;
    let cancelled = false;
    fetchOrgs()
      .then((list) => {
        if (!cancelled) setOrgs(list);
      })
      .catch(console.error);
    void fetchJoinableOrgs().catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [user, authLoading]);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setIssues([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    const orgId = scope === "personal" ? "personal" : scope;
    setLoading(true);
    Promise.all([
      fetchIssues({ orgId }),
      fetchIssueSettings({ orgId }),
    ])
      .then(([list, nextSettings]) => {
        if (cancelled) return;
        setIssues(list);
        setSettings(nextSettings);
        setDelayMin(String(Math.round(nextSettings.defaultPickupDelayMs / 60000)));
        setAutoStart(nextSettings.autoStart);
        setMaxConcurrent(String(nextSettings.maxConcurrent));
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
  }, [user, authLoading, scope]);

  const selectScope = (next: WorkspaceScope) => {
    setScope(next);
    writeSelectedWorkspace(next);
  };

  const filtered = useMemo(
    () =>
      filter === "all" ? issues : issues.filter((issue) => issue.status === filter),
    [issues, filter],
  );

  const counts = useMemo(() => {
    const running = issues.filter((i) => i.status === "running").length;
    const queued = issues.filter((i) => i.status === "queued").length;
    return { running, queued };
  }, [issues]);

  const createHref =
    scope === "personal"
      ? "/issues/new"
      : `/issues/new?org=${encodeURIComponent(scope)}`;
  const sessionCreateHref =
    scope === "personal"
      ? "/create"
      : `/create?org=${encodeURIComponent(scope)}`;
  const activeOrg = orgs.find((o) => o.id === scope) || null;

  const saveSettings = async () => {
    setSettingsBusy(true);
    setSettingsError("");
    try {
      const minutes = Number(delayMin);
      const next = await updateIssueSettings({
        orgId: scope === "personal" ? undefined : scope,
        defaultPickupDelayMs: Math.round(
          (Number.isFinite(minutes) ? minutes : 10) * 60_000,
        ),
        autoStart,
        maxConcurrent: Number(maxConcurrent) || 2,
      });
      setSettings(next);
      setShowSettings(false);
    } catch (err) {
      setSettingsError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSettingsBusy(false);
    }
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
      orgs={orgs}
      scope={scope}
      onSelectScope={selectScope}
      onNewTeam={() => setCreatingOrg((v) => !v)}
      creatingTeam={creatingOrg}
      createHref={sessionCreateHref}
      userName={user.name}
    >
      <main className="mx-auto w-full max-w-6xl px-4 sm:px-6 py-6 sm:py-8">
        <div className="mb-6 sm:mb-8 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
          <div>
            <p className="text-[11px] uppercase tracking-wide text-[#6e6e6e] mb-1">
              {activeOrg ? activeOrg.name : "Personal"}
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
            <button
              type="button"
              onClick={() => setShowSettings((v) => !v)}
              className="h-9 px-3 rounded-md border border-[#2b2b2b] text-[13px] text-[#a0a0a0] hover:text-[#e4e4e4]"
            >
              Pickup settings
            </button>
            <Link
              href={createHref}
              className="inline-flex h-9 px-3.5 rounded-md bg-[#e4e4e4] text-[#141414] text-[13px] font-medium hover:bg-white transition-colors items-center"
            >
              New issue
            </Link>
          </div>
        </div>

        {showSettings && (
          <div className="mb-6 rounded-lg border border-[#2b2b2b] bg-[#1a1a1a] p-4">
            <p className="text-[13px] text-[#e4e4e4] mb-1">Agent pickup</p>
            <p className="text-[11px] text-[#6e6e6e] mb-3">
              Default delay is 10 minutes. Issue runs use Cursor Cloud and never
              create a session room.
            </p>
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="text-[12px] text-[#a0a0a0]">
                Delay (minutes)
                <input
                  value={delayMin}
                  onChange={(e) => setDelayMin(e.target.value)}
                  className="mt-1 w-full h-9 px-2.5 rounded-md bg-[#252525] border border-[#2b2b2b] text-[13px] text-[#e4e4e4] outline-none focus:border-[#4d9fff]"
                />
              </label>
              <label className="text-[12px] text-[#a0a0a0]">
                Max concurrent
                <input
                  value={maxConcurrent}
                  onChange={(e) => setMaxConcurrent(e.target.value)}
                  className="mt-1 w-full h-9 px-2.5 rounded-md bg-[#252525] border border-[#2b2b2b] text-[13px] text-[#e4e4e4] outline-none focus:border-[#4d9fff]"
                />
              </label>
              <label className="flex items-center gap-2 text-[12px] text-[#a0a0a0] mt-6">
                <input
                  type="checkbox"
                  checked={autoStart}
                  onChange={(e) => setAutoStart(e.target.checked)}
                />
                Queue on create
              </label>
            </div>
            {settingsError && (
              <p className="text-[12px] text-[#f07070] mt-2">{settingsError}</p>
            )}
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                disabled={settingsBusy}
                onClick={() => void saveSettings()}
                className="h-8 px-3 rounded-md bg-[#e4e4e4] text-[#141414] text-[12px] font-medium disabled:opacity-50"
              >
                {settingsBusy ? "Saving…" : "Save"}
              </button>
              <button
                type="button"
                onClick={() => setShowSettings(false)}
                className="h-8 px-3 rounded-md text-[12px] text-[#a0a0a0]"
              >
                Cancel
              </button>
            </div>
            {settings && (
              <p className="text-[11px] text-[#6e6e6e] mt-2">
                Current default: {Math.round(settings.defaultPickupDelayMs / 60000)} min
                · {settings.maxConcurrent} at a time
              </p>
            )}
          </div>
        )}

        <div className="mb-4 flex flex-wrap gap-1.5">
          {FILTERS.map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              className={`h-7 px-2.5 rounded-md text-[12px] border ${
                filter === key
                  ? "bg-[#252525] border-[#4d9fff] text-[#e4e4e4]"
                  : "bg-[#1a1a1a] border-[#2b2b2b] text-[#6e6e6e]"
              }`}
            >
              {key === "all" ? "All" : issueStatusLabel(key)}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {[0, 1, 2].map((key) => (
              <div
                key={key}
                className="h-[148px] rounded-xl border border-[#2b2b2b] bg-[#1a1a1a] animate-pulse"
              />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="border border-dashed border-[#2b2b2b] rounded-xl py-16 px-6 text-center bg-[#171717]">
            <p className="text-[#a0a0a0] text-[14px] mb-1">No issues yet</p>
            <p className="text-[#6e6e6e] text-[13px] mb-5">
              Add a ticket with a repo. After the delay, a headless Cursor agent
              opens a PR and writes a markdown note here — not in git, and not
              in Sessions.
            </p>
            <Link
              href={createHref}
              className="inline-flex h-8 px-3.5 rounded-md bg-[#e4e4e4] text-[#141414] text-[13px] font-medium hover:bg-white transition-colors items-center"
            >
              Create issue
            </Link>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {filtered.map((issue) => (
              <Link
                key={issue.id}
                href={`/issues/${issue.id}`}
                className="rounded-xl border border-[#2b2b2b] bg-[#1a1a1a] p-4 hover:border-[#3c3c3c] transition-colors"
              >
                <div className="flex items-start justify-between gap-2 mb-2">
                  <h2 className="text-[14px] text-[#e4e4e4] font-medium leading-5 line-clamp-2">
                    {issue.title}
                  </h2>
                  <span
                    className={`shrink-0 inline-flex h-6 items-center px-2 rounded text-[11px] border ${statusTone(issue.status)}`}
                  >
                    {issueStatusLabel(issue.status)}
                  </span>
                </div>
                <p className="text-[12px] text-[#6e6e6e] truncate">
                  {repoLabel(issue.repoUrl)}
                </p>
                <p className="text-[11px] text-[#6e6e6e] mt-2">
                  {issue.status === "queued"
                    ? `Picks up ${new Date(issue.runAfter).toLocaleString()}`
                    : issue.prUrl
                      ? "Pull request ready"
                      : issue.error
                        ? issue.error
                        : issue.creatorName || "You"}
                </p>
              </Link>
            ))}
          </div>
        )}
      </main>
    </DashboardShell>
  );
}
