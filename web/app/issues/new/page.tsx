"use client";

import { Suspense, useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import DashboardShell from "../../../components/DashboardShell";
import { useAuth } from "../../../components/AuthProvider";
import {
  createIssue,
  fetchAuthStatus,
  fetchIssueSettings,
  fetchOrgs,
  fetchRepositories,
  type OrgInfo,
} from "../../../lib/api";
import {
  readSelectedWorkspace,
  writeSelectedWorkspace,
  type WorkspaceScope,
} from "../../../lib/workspace";
import { DEFAULT_PICKUP_DELAY_MS } from "../../../../shared/issues";
import type { RepoInfo } from "../../../../shared/events";

const inputClass =
  "w-full h-10 px-2.5 rounded-md bg-[#252525] border border-[#2b2b2b] text-[13px] text-[#e4e4e4] outline-none focus:border-[#4d9fff]";

async function fileToBase64(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export default function NewIssuePage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[#141414] flex items-center justify-center">
          <p className="text-[13px] text-[#6e6e6e]">Loading…</p>
        </div>
      }
    >
      <NewIssueForm />
    </Suspense>
  );
}

function NewIssueForm() {
  const router = useRouter();
  const search = useSearchParams();
  const { user, loading: authLoading } = useAuth();
  const [orgs, setOrgs] = useState<OrgInfo[]>([]);
  const [scope, setScope] = useState<WorkspaceScope>("personal");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [repoUrl, setRepoUrl] = useState("");
  const [startingRef, setStartingRef] = useState("main");
  const [priority, setPriority] = useState("medium");
  const [delayMin, setDelayMin] = useState("10");
  const [runNow, setRunNow] = useState(false);
  const [saveDraft, setSaveDraft] = useState(false);
  const [repos, setRepos] = useState<RepoInfo[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [keyReady, setKeyReady] = useState(false);

  useEffect(() => {
    const fromQuery = search.get("org");
    const stored = readSelectedWorkspace();
    setScope(fromQuery && fromQuery !== "personal" ? fromQuery : stored);
  }, [search]);

  useEffect(() => {
    if (authLoading || !user) return;
    let cancelled = false;
    fetchOrgs()
      .then((list) => {
        if (!cancelled) setOrgs(list);
      })
      .catch(console.error);
    return () => {
      cancelled = true;
    };
  }, [user, authLoading]);

  const orgId = scope === "personal" ? undefined : scope;
  const inOrg = Boolean(orgId);
  const activeOrg = orgs.find((o) => o.id === scope) || null;

  useEffect(() => {
    if (authLoading || !user) return;
    let cancelled = false;
    fetchIssueSettings({ orgId: orgId || "personal" })
      .then((settings) => {
        if (cancelled) return;
        setDelayMin(String(Math.round(settings.defaultPickupDelayMs / 60000) || 10));
        setSaveDraft(!settings.autoStart);
      })
      .catch(console.error);
    return () => {
      cancelled = true;
    };
  }, [user, authLoading, orgId]);

  useEffect(() => {
    if (authLoading || !user) return;
    let cancelled = false;
    fetchAuthStatus({ orgId })
      .then((status) => {
        if (cancelled) return;
        const ready = inOrg
          ? Boolean(status.orgCursorKeyConfigured || status.serverKeyConfigured || status.userByokConfigured)
          : Boolean(status.serverKeyConfigured || status.userByokConfigured);
        setKeyReady(ready);
      })
      .catch(() => setKeyReady(false));
    return () => {
      cancelled = true;
    };
  }, [user, authLoading, orgId, inOrg]);

  useEffect(() => {
    if (!keyReady) {
      setRepos([]);
      return;
    }
    let cancelled = false;
    fetchRepositories({
      authMode: "server",
      orgId,
    })
      .then((list) => {
        if (!cancelled) setRepos(list);
      })
      .catch(() => {
        if (!cancelled) setRepos([]);
      });
    return () => {
      cancelled = true;
    };
  }, [keyReady, orgId]);

  const selectScope = (next: WorkspaceScope) => {
    setScope(next);
    writeSelectedWorkspace(next);
  };

  const pickupDelayMs = useMemo(() => {
    if (runNow) return 0;
    const minutes = Number(delayMin);
    if (!Number.isFinite(minutes)) return DEFAULT_PICKUP_DELAY_MS;
    return Math.round(minutes * 60_000);
  }, [delayMin, runNow]);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    if (!title.trim()) {
      setError("Title is required");
      return;
    }
    if (!repoUrl.trim()) {
      setError("Choose or paste a GitHub repo URL");
      return;
    }
    setCreating(true);
    try {
      const attachments = await Promise.all(
        files.slice(0, 8).map(async (file) => ({
          name: file.name,
          mime: file.type || undefined,
          data: await fileToBase64(file),
        })),
      );
      const issue = await createIssue({
        title: title.trim(),
        description,
        repoUrl: repoUrl.trim(),
        startingRef,
        priority,
        pickupDelayMs,
        autoStart: !saveDraft,
        orgId,
        attachments,
      });
      router.push(`/issues/${issue.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create issue");
    } finally {
      setCreating(false);
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
    router.replace("/login?redirect=/issues/new");
    return null;
  }

  return (
    <DashboardShell
      orgs={orgs}
      scope={scope}
      onSelectScope={selectScope}
      onNewTeam={() => undefined}
      createHref={orgId ? `/create?org=${encodeURIComponent(orgId)}` : "/create"}
      userName={user.name}
    >
      <main className="mx-auto w-full max-w-2xl px-4 sm:px-6 py-6 sm:py-8">
        <p className="text-[11px] uppercase tracking-wide text-[#6e6e6e] mb-1">
          {activeOrg ? activeOrg.name : "Personal"}
        </p>
        <h1 className="text-[22px] font-medium text-[#e4e4e4] tracking-tight">
          New issue
        </h1>
        <p className="text-[13px] text-[#6e6e6e] mt-1 mb-6">
          Cursor Cloud will pick this up after the delay, open a PR, and store a
          markdown writeup on this ticket. No session is created.
        </p>

        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
          <label className="block text-[12px] text-[#a0a0a0]">
            Title
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className={`${inputClass} mt-1.5`}
              placeholder="Login button ignores disabled state"
            />
          </label>

          <label className="block text-[12px] text-[#a0a0a0]">
            Description
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={6}
              className="mt-1.5 w-full px-2.5 py-2 rounded-md bg-[#252525] border border-[#2b2b2b] text-[13px] text-[#e4e4e4] outline-none focus:border-[#4d9fff] resize-y min-h-[140px]"
              placeholder="What is broken, where to look, expected vs actual."
            />
          </label>

          <div>
            <label className="block text-[12px] text-[#a0a0a0] mb-1.5">
              Repository
            </label>
            {repos.length > 0 && (
              <select
                value={repos.some((r) => r.url === repoUrl) ? repoUrl : ""}
                onChange={(e) => setRepoUrl(e.target.value)}
                className={`${inputClass} mb-2`}
              >
                <option value="">Select a connected repo…</option>
                {repos.map((repo) => (
                  <option key={repo.url} value={repo.url}>
                    {repo.url.replace("https://github.com/", "")}
                  </option>
                ))}
              </select>
            )}
            <input
              value={repoUrl}
              onChange={(e) => setRepoUrl(e.target.value)}
              className={inputClass}
              placeholder="https://github.com/acme/widget"
            />
            {!keyReady && (
              <p className="text-[11px] text-[#e6c07b] mt-1.5">
                {inOrg
                  ? "Set a team Cursor key in Team settings so the agent can run unattended."
                  : "Save a Cursor key (BYOK) or configure the server key before the agent can run."}
              </p>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-[12px] text-[#a0a0a0]">
              Base branch
              <input
                value={startingRef}
                onChange={(e) => setStartingRef(e.target.value)}
                className={`${inputClass} mt-1.5`}
              />
            </label>
            <label className="block text-[12px] text-[#a0a0a0]">
              Priority
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
                className={`${inputClass} mt-1.5`}
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </label>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-[12px] text-[#a0a0a0]">
              Pickup delay (minutes)
              <input
                value={delayMin}
                disabled={runNow}
                onChange={(e) => setDelayMin(e.target.value)}
                className={`${inputClass} mt-1.5 disabled:opacity-50`}
              />
            </label>
            <div className="flex flex-col justify-end gap-2 pb-0.5">
              <label className="flex items-center gap-2 text-[12px] text-[#a0a0a0]">
                <input
                  type="checkbox"
                  checked={runNow}
                  onChange={(e) => {
                    setRunNow(e.target.checked);
                    if (e.target.checked) setSaveDraft(false);
                  }}
                />
                Run as soon as possible
              </label>
              <label className="flex items-center gap-2 text-[12px] text-[#a0a0a0]">
                <input
                  type="checkbox"
                  checked={saveDraft}
                  onChange={(e) => {
                    setSaveDraft(e.target.checked);
                    if (e.target.checked) setRunNow(false);
                  }}
                />
                Save as draft (do not queue)
              </label>
            </div>
          </div>

          <label className="block text-[12px] text-[#a0a0a0]">
            Images / files
            <input
              type="file"
              multiple
              accept="image/*,.pdf,.txt,.md,.json"
              className="mt-1.5 block w-full text-[12px] text-[#a0a0a0] file:mr-3 file:h-8 file:px-3 file:rounded-md file:border-0 file:bg-[#252525] file:text-[#e4e4e4]"
              onChange={(e) => setFiles(Array.from(e.target.files || []))}
            />
            {files.length > 0 && (
              <p className="text-[11px] text-[#6e6e6e] mt-1">
                {files.length} file{files.length === 1 ? "" : "s"} attached
              </p>
            )}
          </label>

          {error && <p className="text-[13px] text-[#f07070]">{error}</p>}

          <div className="flex items-center gap-2 pt-1">
            <button
              type="submit"
              disabled={creating}
              className="h-9 px-3.5 rounded-md bg-[#e4e4e4] text-[#141414] text-[13px] font-medium hover:bg-white disabled:opacity-50"
            >
              {creating ? "Creating…" : saveDraft ? "Save draft" : "Create issue"}
            </button>
            <Link
              href="/issues"
              className="h-9 px-3 rounded-md text-[13px] text-[#a0a0a0] inline-flex items-center"
            >
              Cancel
            </Link>
          </div>
        </form>
      </main>
    </DashboardShell>
  );
}
