"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import DashboardShell from "../../../components/DashboardShell";
import Markdown from "../../../components/Markdown";
import IssueAgentTranscript from "../../../components/issues/IssueAgentTranscript";
import { useAuth } from "../../../components/AuthProvider";
import {
  cancelIssue,
  deleteIssue,
  fetchIssue,
  fetchOrgs,
  queueIssue,
  retryIssue,
  runIssueNow,
  updateIssue,
  waitForAuthToken,
  type IssueInfo,
  type OrgInfo,
} from "../../../lib/api";
import {
  readSelectedWorkspace,
  writeSelectedWorkspace,
  type WorkspaceScope,
} from "../../../lib/workspace";
import {
  canCancelIssue,
  canQueueIssue,
  canRetryIssue,
  issueStatusLabel,
} from "../../../../shared/issues";

function apiBase(): string {
  const raw = (process.env.NEXT_PUBLIC_API_URL || "").trim().replace(/\/+$/, "");
  if (raw) return `${raw}/api`;
  return "/api";
}

function statusTone(status: IssueInfo["status"]): string {
  switch (status) {
    case "running":
      return "border-[#26405d] bg-[#17202a] text-[#8ec5ff]";
    case "queued":
      return "border-[#3c3420] bg-[#1f1b12] text-[#e6c07b]";
    case "in_review":
    case "done":
      return "border-[#1f3d2e] bg-[#142019] text-[#3ecf8e]";
    case "failed":
    case "cancelled":
      return "border-[#3c2b2b] bg-[#1a1414] text-[#f07070]";
    default:
      return "border-[#2b2b2b] bg-[#1a1a1a] text-[#a0a0a0]";
  }
}

export default function IssueDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const { user, loading: authLoading } = useAuth();
  const [orgs, setOrgs] = useState<OrgInfo[]>([]);
  const [scope, setScope] = useState<WorkspaceScope>("personal");
  const [issue, setIssue] = useState<IssueInfo | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [writeupDraft, setWriteupDraft] = useState("");
  const [editingWriteup, setEditingWriteup] = useState(false);
  const [previews, setPreviews] = useState<Record<string, string>>({});

  useEffect(() => {
    setScope(readSelectedWorkspace());
  }, []);

  useEffect(() => {
    if (authLoading || !user) return;
    fetchOrgs().then(setOrgs).catch(console.error);
  }, [user, authLoading]);

  useEffect(() => {
    if (authLoading || !user || !id) return;
    let cancelled = false;
    const load = () =>
      fetchIssue(id)
        .then((next) => {
          if (cancelled) return;
          setIssue(next);
          if (next.orgId) {
            setScope(next.orgId);
            writeSelectedWorkspace(next.orgId);
          }
          if (!editingWriteup) setWriteupDraft(next.writeupMd || "");
        })
        .catch((err) => {
          if (!cancelled) {
            setError(err instanceof Error ? err.message : "Issue not found");
          }
        });
    void load();
    const interval = setInterval(() => {
      void load();
    }, 3000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [id, user, authLoading, editingWriteup]);

  useEffect(() => {
    if (!issue) return;
    let cancelled = false;
    const urls: string[] = [];
    void (async () => {
      const token = await waitForAuthToken();
      const next: Record<string, string> = {};
      for (const att of issue.attachments) {
        if (!att.mime.startsWith("image/")) continue;
        try {
          const res = await fetch(`${apiBase()}${att.url.replace(/^\/api/, "")}`, {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
          });
          if (!res.ok) continue;
          const blob = await res.blob();
          const url = URL.createObjectURL(blob);
          urls.push(url);
          next[att.id] = url;
        } catch {
          // ignore
        }
      }
      if (!cancelled) setPreviews(next);
    })();
    return () => {
      cancelled = true;
      for (const url of urls) URL.revokeObjectURL(url);
    };
  }, [issue]);

  const act = async (fn: () => Promise<IssueInfo>) => {
    setBusy(true);
    setError("");
    try {
      setIssue(await fn());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusy(false);
    }
  };

  if (authLoading || (!issue && !error)) {
    return (
      <div className="min-h-screen bg-[#141414] flex items-center justify-center">
        <p className="text-[13px] text-[#6e6e6e]">Loading issue…</p>
      </div>
    );
  }

  if (!user) {
    router.replace(`/login?redirect=/issues/${id || ""}`);
    return null;
  }

  return (
    <DashboardShell
      orgs={orgs}
      scope={scope}
      onSelectScope={(next) => {
        writeSelectedWorkspace(next);
        router.push("/issues");
      }}
      onNewTeam={() => undefined}
      createHref={scope === "personal" ? "/create" : `/create?org=${scope}`}
      userName={user.name}
    >
      <main className="mx-auto w-full max-w-3xl px-4 sm:px-6 py-6 sm:py-8">
        <Link href="/issues" className="text-[12px] text-[#6e6e6e] hover:text-[#e4e4e4]">
          ← Issues
        </Link>

        {error && !issue && (
          <p className="text-[13px] text-[#f07070] mt-6">{error}</p>
        )}

        {issue && (
          <>
            <div className="mt-3 flex items-start justify-between gap-3">
              <div>
                <h1 className="text-[22px] font-medium text-[#e4e4e4] tracking-tight">
                  {issue.title}
                </h1>
                <p className="text-[12px] text-[#6e6e6e] mt-1">
                  {issue.repoUrl.replace("https://github.com/", "")}
                  {issue.startingRef ? ` · ${issue.startingRef}` : ""}
                  {issue.priority ? ` · ${issue.priority}` : ""}
                </p>
              </div>
              <span
                className={`shrink-0 inline-flex h-6 items-center px-2 rounded text-[11px] border ${statusTone(issue.status)}`}
              >
                {issueStatusLabel(issue.status)}
              </span>
            </div>

            {error && (
              <p className="text-[13px] text-[#f07070] mt-3">{error}</p>
            )}

            <div className="mt-4 flex flex-wrap gap-2">
              {canQueueIssue(issue.status) && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void act(() => queueIssue(issue.id))}
                  className="h-8 px-3 rounded-md bg-[#e4e4e4] text-[#141414] text-[12px] font-medium disabled:opacity-50"
                >
                  Queue
                </button>
              )}
              {(issue.status === "queued" ||
                issue.status === "draft" ||
                issue.status === "failed" ||
                issue.status === "in_review") && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void act(() => runIssueNow(issue.id))}
                  className="h-8 px-3 rounded-md border border-[#2b2b2b] text-[12px] text-[#e4e4e4] disabled:opacity-50"
                >
                  Run now
                </button>
              )}
              {canCancelIssue(issue.status) && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void act(() => cancelIssue(issue.id))}
                  className="h-8 px-3 rounded-md border border-[#2b2b2b] text-[12px] text-[#f07070] disabled:opacity-50"
                >
                  Cancel
                </button>
              )}
              {canRetryIssue(issue.status) && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void act(() => retryIssue(issue.id, { pickupDelayMs: 0 }))}
                  className="h-8 px-3 rounded-md border border-[#2b2b2b] text-[12px] text-[#e4e4e4] disabled:opacity-50"
                >
                  Retry
                </button>
              )}
              {issue.status === "in_review" && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void act(() => updateIssue(issue.id, { status: "done" }))
                  }
                  className="h-8 px-3 rounded-md border border-[#2b2b2b] text-[12px] text-[#3ecf8e] disabled:opacity-50"
                >
                  Mark done
                </button>
              )}
              {issue.status !== "running" && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={async () => {
                    if (!window.confirm("Delete this issue?")) return;
                    setBusy(true);
                    try {
                      await deleteIssue(issue.id);
                      router.push("/issues");
                    } catch (err) {
                      setError(err instanceof Error ? err.message : "Delete failed");
                      setBusy(false);
                    }
                  }}
                  className="h-8 px-3 rounded-md text-[12px] text-[#6e6e6e] hover:text-[#f07070]"
                >
                  Delete
                </button>
              )}
            </div>

            {issue.status === "queued" && (
              <p className="text-[12px] text-[#e6c07b] mt-3">
                Agent pickup {new Date(issue.runAfter).toLocaleString()}
              </p>
            )}
            {issue.error && (
              <p className="text-[12px] text-[#f07070] mt-3">{issue.error}</p>
            )}

            {issue.prUrl && (
              <a
                href={issue.prUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-4 inline-flex h-9 items-center px-3 rounded-md border border-[#26405d] bg-[#17202a] text-[13px] text-[#8ec5ff] hover:underline"
              >
                Open pull request
              </a>
            )}

            <section className="mt-6 rounded-xl border border-[#2b2b2b] bg-[#1a1a1a] p-4">
              <p className="text-[12px] text-[#6e6e6e] mb-2">Description</p>
              <div className="text-[13px] text-[#d0d0d0] whitespace-pre-wrap">
                {issue.description || "No description"}
              </div>
              {issue.attachments.length > 0 && (
                <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {issue.attachments.map((att) =>
                    previews[att.id] ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        key={att.id}
                        src={previews[att.id]}
                        alt={att.name}
                        className="rounded-md border border-[#2b2b2b] max-h-40 w-full object-cover"
                      />
                    ) : (
                      <p key={att.id} className="text-[12px] text-[#a0a0a0]">
                        {att.name}
                      </p>
                    ),
                  )}
                </div>
              )}
            </section>

            <IssueAgentTranscript
              issueId={issue.id}
              cursorAgentId={issue.cursorAgentId}
              live={issue.status === "running"}
            />

            <section className="mt-4 rounded-xl border border-[#2b2b2b] bg-[#1a1a1a] p-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-[12px] text-[#6e6e6e]">Writeup</p>
                {issue.writeupMd && (
                  <button
                    type="button"
                    onClick={() => setEditingWriteup((v) => !v)}
                    className="text-[12px] text-[#8ec5ff]"
                  >
                    {editingWriteup ? "Cancel" : "Edit"}
                  </button>
                )}
              </div>
              {editingWriteup ? (
                <div>
                  <textarea
                    value={writeupDraft}
                    onChange={(e) => setWriteupDraft(e.target.value)}
                    rows={12}
                    className="w-full px-2.5 py-2 rounded-md bg-[#252525] border border-[#2b2b2b] text-[13px] text-[#e4e4e4] outline-none focus:border-[#4d9fff]"
                  />
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void act(async () => {
                        const next = await updateIssue(issue.id, {
                          writeupMd: writeupDraft,
                        });
                        setEditingWriteup(false);
                        return next;
                      })
                    }
                    className="mt-2 h-8 px-3 rounded-md bg-[#e4e4e4] text-[#141414] text-[12px] font-medium"
                  >
                    Save writeup
                  </button>
                </div>
              ) : issue.writeupMd ? (
                <div className="text-[13px] text-[#d8d8d8]">
                  <Markdown content={issue.writeupMd} />
                </div>
              ) : (
                <p className="text-[13px] text-[#6e6e6e]">
                  {issue.status === "running" || issue.status === "queued"
                    ? "The agent will save markdown here after the PR — not in the repo."
                    : "No writeup yet."}
                </p>
              )}
            </section>

            {issue.events && issue.events.length > 0 && (
              <section className="mt-4 mb-8">
                <p className="text-[12px] text-[#6e6e6e] mb-2">Activity</p>
                <ol className="space-y-2">
                  {issue.events.map((event) => (
                    <li key={event.id} className="text-[12px] text-[#a0a0a0]">
                      <span className="text-[#6e6e6e]">
                        {new Date(event.createdAt).toLocaleString()}
                      </span>
                      {" · "}
                      {event.kind}
                      {event.message ? ` — ${event.message}` : ""}
                    </li>
                  ))}
                </ol>
              </section>
            )}
          </>
        )}
      </main>
    </DashboardShell>
  );
}
