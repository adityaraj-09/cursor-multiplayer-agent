"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import DashboardShell from "../../../components/DashboardShell";
import Markdown from "../../../components/Markdown";
import { useAuth } from "../../../components/AuthProvider";
import {
  cancelIssue,
  deleteIssue,
  fetchIssue,
  fetchIssueAttachmentBlob,
  fetchOrgs,
  queueIssue,
  retryIssue,
  runIssueNow,
  updateIssue,
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
  issueStatusIsActive,
  issueStatusLabel,
  type IssueAttachmentInfo,
} from "../../../../shared/issues";

function isImageAttachment(att: IssueAttachmentInfo): boolean {
  if (att.mime.toLowerCase().startsWith("image/")) return true;
  return /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(att.name);
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
    let inFlight = false;
    const load = () => {
      if (inFlight) return;
      inFlight = true;
      fetchIssue(id)
        .then((next) => {
          if (cancelled) return;
          setIssue((prev) => {
            if (
              prev &&
              prev.updatedAt === next.updatedAt &&
              prev.status === next.status &&
              prev.writeupMd === next.writeupMd &&
              prev.cursorAgentId === next.cursorAgentId &&
              prev.prUrl === next.prUrl &&
              prev.error === next.error
            ) {
              return prev;
            }
            return next;
          });
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
        })
        .finally(() => {
          inFlight = false;
        });
    };
    void load();
    if (issue && !issueStatusIsActive(issue.status)) {
      return () => {
        cancelled = true;
      };
    }
    const interval = setInterval(() => {
      void load();
    }, 3000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [id, user, authLoading, editingWriteup, issue?.status]);

  const attachmentKey = issue
    ? issue.attachments.map((att) => att.id).join(",")
    : "";

  useEffect(() => {
    if (!issue) {
      setPreviews({});
      return;
    }
    const images = issue.attachments.filter(isImageAttachment);
    if (images.length === 0) {
      setPreviews({});
      return;
    }

    let cancelled = false;
    const urls: string[] = [];
    void (async () => {
      const next: Record<string, string> = {};
      await Promise.all(
        images.map(async (att) => {
          try {
            const blob = await fetchIssueAttachmentBlob(issue.id, att.id);
            const url = URL.createObjectURL(blob);
            if (cancelled) {
              URL.revokeObjectURL(url);
              return;
            }
            urls.push(url);
            next[att.id] = url;
          } catch {
            // keep filename fallback
          }
        }),
      );
      if (!cancelled) setPreviews(next);
    })();

    return () => {
      cancelled = true;
      for (const url of urls) URL.revokeObjectURL(url);
    };
    // Only reload when the issue id or attachment set changes — not on poll ticks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [issue?.id, attachmentKey]);

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
      createHref={scope === "personal" ? "/dashboard?compose=1" : `/dashboard?compose=1&org=${scope}`}
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
                <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {issue.attachments.map((att) =>
                    previews[att.id] ? (
                      <a
                        key={att.id}
                        href={previews[att.id]}
                        target="_blank"
                        rel="noreferrer"
                        className="block overflow-hidden rounded-md border border-[#2b2b2b] bg-[#141414]"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={previews[att.id]}
                          alt={att.name}
                          className="max-h-64 w-full object-contain bg-[#141414]"
                        />
                        <p className="truncate px-2 py-1.5 text-[11px] text-[#6e6e6e]">
                          {att.name}
                        </p>
                      </a>
                    ) : (
                      <div
                        key={att.id}
                        className="rounded-md border border-[#2b2b2b] bg-[#141414] px-3 py-2"
                      >
                        <p className="text-[12px] text-[#a0a0a0] truncate">
                          {att.name}
                        </p>
                        {isImageAttachment(att) && (
                          <p className="text-[11px] text-[#6e6e6e] mt-0.5">
                            Loading preview…
                          </p>
                        )}
                      </div>
                    ),
                  )}
                </div>
              )}
            </section>

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
