"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  createRoom,
  fetchAuthStatus,
  fetchCursorSessions,
  fetchOnlineWorkers,
  fetchRepositories,
  pickLocalFolder,
  setServerKey,
} from "../../lib/api";
import type {
  AgentRuntime,
  AuthMode,
  CursorChatSession,
  RepoInfo,
} from "../../../shared/events";

function authLabel(mode: AuthMode): string {
  if (mode === "cli") return "Local login";
  if (mode === "byok") return "Bring your own";
  return "Server key";
}

export default function CreateSession() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [runtime, setRuntime] = useState<AgentRuntime>("local");
  const [authMode, setAuthMode] = useState<AuthMode>("cli");
  const [apiKey, setApiKey] = useState("");
  const [serverKeyInput, setServerKeyInput] = useState("");
  const [repoPath, setRepoPath] = useState("");
  const [repoUrl, setRepoUrl] = useState("");
  const [startingRef, setStartingRef] = useState("main");
  const [autoCreatePR, setAutoCreatePR] = useState(true);
  const [repos, setRepos] = useState<RepoInfo[]>([]);
  const [serverKeyConfigured, setServerKeyConfigured] = useState(false);
  const [serverKeyHint, setServerKeyHint] = useState<string | null>(null);
  const [serverKeySource, setServerKeySource] = useState<
    "env" | "stored" | "none"
  >("none");
  const [byokAvailable, setByokAvailable] = useState(false);
  const [savingServerKey, setSavingServerKey] = useState(false);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [pickingFolder, setPickingFolder] = useState(false);
  const [workerOnline, setWorkerOnline] = useState(false);
  const [cursorSessions, setCursorSessions] = useState<CursorChatSession[]>([]);
  const [cursorSessionId, setCursorSessionId] = useState("");
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [sessionError, setSessionError] = useState("");

  const refreshAuth = () =>
    fetchAuthStatus()
      .then((s) => {
        setServerKeyConfigured(s.serverKeyConfigured);
        setServerKeyHint(s.serverKeyHint);
        setServerKeySource(s.serverKeySource);
        setByokAvailable(s.byokAvailable);
      })
      .catch(() => {});

  useEffect(() => {
    void refreshAuth();
  }, []);

  useEffect(() => {
    let cancelled = false;
    const check = () => {
      fetchOnlineWorkers()
        .then((workers) => {
          if (!cancelled) setWorkerOnline(workers.length > 0);
        })
        .catch(() => {
          if (!cancelled) setWorkerOnline(false);
        });
    };
    check();
    const interval = setInterval(check, 4000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const handlePickFolder = async () => {
    setPickingFolder(true);
    setError("");
    try {
      const path = await pickLocalFolder();
      setRepoPath(path);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to pick folder");
    } finally {
      setPickingFolder(false);
    }
  };

  const selectRuntime = (r: AgentRuntime) => {
    setRuntime(r);
    setRepos([]);
    if (r === "local") setAuthMode("cli");
    else if (authMode === "cli") setAuthMode("server");
  };

  const handlePickupServerKey = async () => {
    if (!serverKeyInput.trim()) {
      setError("Paste a Cursor API key to save as the server key");
      return;
    }
    setSavingServerKey(true);
    setError("");
    try {
      const result = await setServerKey(serverKeyInput.trim());
      setServerKeyConfigured(result.serverKeyConfigured);
      setServerKeyHint(result.serverKeyHint);
      setServerKeySource(result.serverKeySource);
      setServerKeyInput("");
      setAuthMode("server");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save server key");
    } finally {
      setSavingServerKey(false);
    }
  };

  // Only cloud needs a repo catalog — models default to "auto" (change in-room).
  useEffect(() => {
    let cancelled = false;
    if (runtime !== "cloud") {
      setRepos([]);
      return;
    }
    if (authMode === "server" && !serverKeyConfigured) {
      setRepos([]);
      return;
    }
    if (authMode === "byok" && !apiKey.trim()) {
      setRepos([]);
      return;
    }

    const t = setTimeout(() => {
      fetchRepositories({
        authMode,
        apiKey: authMode === "byok" ? apiKey.trim() : undefined,
      })
        .then((r) => {
          if (!cancelled) setRepos(r);
        })
        .catch((err) => {
          if (!cancelled) {
            setRepos([]);
            setError(
              err instanceof Error ? err.message : "Failed to load repositories",
            );
          }
        });
    }, authMode === "byok" ? 400 : 0);

    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [authMode, apiKey, runtime, serverKeyConfigured]);

  useEffect(() => {
    let cancelled = false;
    const isLocalCli = runtime === "local" && authMode === "cli";
    if (!isLocalCli || !repoPath.trim() || !workerOnline) {
      setCursorSessions([]);
      setCursorSessionId("");
      setSessionError("");
      setLoadingSessions(false);
      return;
    }

    setLoadingSessions(true);
    setSessionError("");
    fetchCursorSessions(repoPath.trim())
      .then((sessions) => {
        if (cancelled) return;
        setCursorSessions(sessions);
        // Default to latest Cursor chat for this repo
        setCursorSessionId(sessions.length > 0 ? sessions[0].id : "");
      })
      .catch((err) => {
        if (cancelled) return;
        setCursorSessions([]);
        setCursorSessionId("");
        setSessionError(
          err instanceof Error ? err.message : "Failed to load chat sessions",
        );
      })
      .finally(() => {
        if (!cancelled) setLoadingSessions(false);
      });

    return () => {
      cancelled = true;
    };
  }, [runtime, authMode, repoPath, workerOnline]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError("Session name is required");
      return;
    }
    if (authMode === "byok" && !apiKey.trim()) {
      setError("Paste your Cursor API key for BYOK");
      return;
    }
    if (authMode === "server" && !serverKeyConfigured) {
      setError("Server key is not configured");
      return;
    }
    if (runtime === "cloud" && !repoUrl.trim()) {
      setError("Choose or paste a GitHub repo URL");
      return;
    }
    if (runtime === "local" && !repoPath.trim()) {
      setError("Select a local repository folder");
      return;
    }

    setCreating(true);
    setError("");

    try {
      const room = await createRoom({
        name: name.trim(),
        runtime,
        authMode,
        modelId: "auto",
        repoPath: runtime === "local" ? repoPath.trim() || undefined : undefined,
        repoUrl: runtime === "cloud" ? repoUrl.trim() : undefined,
        startingRef:
          runtime === "cloud" ? startingRef.trim() || "main" : undefined,
        autoCreatePR: runtime === "cloud" ? autoCreatePR : undefined,
        apiKey: authMode === "byok" ? apiKey.trim() : undefined,
        cursorSessionId:
          runtime === "local" && authMode === "cli" && cursorSessionId
            ? cursorSessionId
            : undefined,
      });
      router.push(`/room/${room.id}`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to create session");
      setCreating(false);
    }
  };

  const inputClass =
    "w-full h-10 px-3 bg-[#252525] border border-[#2b2b2b] rounded-md text-[16px] sm:text-[13px] text-[#e4e4e4] placeholder:text-[#6e6e6e] outline-none focus:border-[#4d9fff] transition-colors";

  const authOptions: AuthMode[] =
    runtime === "local" ? ["cli", "server", "byok"] : ["server", "byok"];

  return (
    <div className="min-h-screen bg-[#141414]">
      <header className="border-b border-[#2b2b2b]">
        <div className="max-w-xl mx-auto px-4 sm:px-6 h-14 flex items-center gap-3">
          <Link
            href="/"
            className="flex items-center gap-2 shrink-0 hover:opacity-80 transition-opacity"
            aria-label="Steer home"
          >
            <div className="w-5 h-5 rounded-[4px] bg-[#e4e4e4] flex items-center justify-center">
              <span className="text-[#141414] text-[9px] font-semibold">S</span>
            </div>
            <span className="text-[13px] text-[#a0a0a0] hidden sm:inline">
              Steer
            </span>
          </Link>
          <span className="text-[#2b2b2b]">/</span>
          <span className="text-[13px] text-[#e4e4e4]">New session</span>
        </div>
      </header>

      <main className="max-w-xl mx-auto px-4 sm:px-6 py-8 sm:py-10">
        <h1 className="text-[22px] font-medium tracking-tight mb-1">
          Create session
        </h1>
        <p className="text-[13px] text-[#6e6e6e] mb-8">
          Local sessions use your Cursor CLI login — no API key. Cloud needs a
          server key or BYOK.
        </p>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-[12px] text-[#a0a0a0] mb-1.5">
              Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Fix login bugs"
              className={inputClass}
              autoFocus
            />
          </div>

          <fieldset>
            <legend className="block text-[12px] text-[#a0a0a0] mb-1.5">
              Runtime
            </legend>
            <div className="flex gap-2">
              {(["local", "cloud"] as const).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => selectRuntime(r)}
                  className={`h-9 px-3 rounded-md text-[13px] border transition-colors ${
                    runtime === r
                      ? "bg-[#252525] border-[#4d9fff] text-[#e4e4e4]"
                      : "bg-[#1a1a1a] border-[#2b2b2b] text-[#6e6e6e]"
                  }`}
                >
                  {r === "local" ? "Local" : "Cloud"}
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend className="block text-[12px] text-[#a0a0a0] mb-1.5">
              Auth
            </legend>
            <div className="flex flex-wrap gap-2 mb-2">
              {authOptions.map((mode) => (
                <button
                  key={mode}
                  type="button"
                  disabled={mode === "byok" && !byokAvailable}
                  onClick={() => {
                    setAuthMode(mode);
                  }}
                  className={`h-9 px-3 rounded-md text-[13px] border transition-colors disabled:opacity-40 ${
                    authMode === mode
                      ? "bg-[#252525] border-[#4d9fff] text-[#e4e4e4]"
                      : "bg-[#1a1a1a] border-[#2b2b2b] text-[#6e6e6e]"
                  }`}
                >
                  {authLabel(mode)}
                </button>
              ))}
            </div>
            {authMode === "cli" && (
              <p className="text-[11px] text-[#6e6e6e]">
                Uses the Cursor account already logged in on this machine (
                <code className="text-[#a0a0a0]">cursor agent</code>). No API
                key required.
              </p>
            )}
            {authMode === "server" && (
              <div className="space-y-2">
                {serverKeyConfigured ? (
                  <p className="text-[11px] text-[#6e6e6e]">
                    Using server key {serverKeyHint}{" "}
                    {serverKeySource === "env"
                      ? "(from CURSOR_API_KEY)"
                      : "(picked up & encrypted in DB)"}
                  </p>
                ) : (
                  <p className="text-[11px] text-[#6e6e6e]">
                    No server key yet — paste one below to pick it up (stored
                    encrypted), or set CURSOR_API_KEY in .env.
                  </p>
                )}
                <div className="flex gap-2">
                  <input
                    type="password"
                    value={serverKeyInput}
                    onChange={(e) => setServerKeyInput(e.target.value)}
                    placeholder={
                      serverKeyConfigured
                        ? "Replace server key…"
                        : "cursor_… (server key)"
                    }
                    className={`${inputClass} font-mono flex-1`}
                    autoComplete="off"
                  />
                  <button
                    type="button"
                    onClick={() => void handlePickupServerKey()}
                    disabled={savingServerKey || !serverKeyInput.trim()}
                    className="h-10 px-3 rounded-md bg-[#252525] border border-[#2b2b2b] text-[13px] text-[#e4e4e4] hover:border-[#3c3c3c] disabled:opacity-40 shrink-0"
                  >
                    {savingServerKey ? "Saving…" : "Save"}
                  </button>
                </div>
              </div>
            )}
            {authMode === "byok" && (
              <>
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="cursor_…"
                  className={`${inputClass} font-mono`}
                  autoComplete="off"
                />
                <p className="text-[11px] text-[#6e6e6e] mt-1.5">
                  Room-scoped key, encrypted at rest. Joiners share this room’s
                  agent; usage bills this key.
                </p>
              </>
            )}
          </fieldset>

          {runtime === "local" ? (
            <div>
              <label className="block text-[12px] text-[#a0a0a0] mb-1.5">
                Repository folder
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={repoPath}
                  onChange={(e) => setRepoPath(e.target.value)}
                  placeholder="Select a folder on your machine…"
                  readOnly
                  className={`${inputClass} font-mono flex-1 cursor-default`}
                />
                <button
                  type="button"
                  onClick={() => void handlePickFolder()}
                  disabled={pickingFolder || !workerOnline}
                  className="h-10 px-3 rounded-md bg-[#252525] border border-[#2b2b2b] text-[13px] text-[#e4e4e4] hover:border-[#3c3c3c] disabled:opacity-40 shrink-0"
                >
                  {pickingFolder ? "Opening…" : "Browse…"}
                </button>
              </div>
              <p className="text-[11px] text-[#6e6e6e] mt-1.5">
                {workerOnline
                  ? "Opens a folder picker on the machine running `steer start`."
                  : "Start your CLI worker first (`steer start`), then browse."}
              </p>

              {authMode === "cli" && repoPath.trim() && workerOnline && (
                <div className="mt-4">
                  <label className="block text-[12px] text-[#a0a0a0] mb-1.5">
                    Cursor chat session
                  </label>
                  {loadingSessions ? (
                    <p className="text-[12px] text-[#6e6e6e]">
                      Loading chat sessions…
                    </p>
                  ) : sessionError ? (
                    <p className="text-[12px] text-[#f07070]">{sessionError}</p>
                  ) : (
                    <select
                      value={cursorSessionId}
                      onChange={(e) => setCursorSessionId(e.target.value)}
                      className={inputClass}
                    >
                      <option value="">New Cursor chat</option>
                      {cursorSessions.map((s, index) => (
                        <option key={s.id} value={s.id}>
                          {formatCursorSessionLabel(s, index)}
                        </option>
                      ))}
                    </select>
                  )}
                  <p className="text-[11px] text-[#6e6e6e] mt-1.5">
                    {cursorSessions.length > 0
                      ? "Latest chat is selected by default — resume where you left off in Cursor."
                      : "No prior Cursor chats for this folder — a new chat starts on first message."}
                  </p>
                </div>
              )}
            </div>
          ) : (
            <>
              <div>
                <label className="block text-[12px] text-[#a0a0a0] mb-1.5">
                  GitHub repository
                </label>
                {repos.length > 0 && (
                  <select
                    value={repos.some((r) => r.url === repoUrl) ? repoUrl : ""}
                    onChange={(e) => setRepoUrl(e.target.value)}
                    className={`${inputClass} mb-2`}
                  >
                    <option value="">Select connected repo…</option>
                    {repos.map((r) => (
                      <option key={r.url} value={r.url}>
                        {r.url.replace("https://github.com/", "")}
                      </option>
                    ))}
                  </select>
                )}
                <input
                  type="url"
                  value={repoUrl}
                  onChange={(e) => setRepoUrl(e.target.value)}
                  placeholder="https://github.com/org/repo"
                  className={`${inputClass} font-mono`}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[12px] text-[#a0a0a0] mb-1.5">
                    Starting ref
                  </label>
                  <input
                    type="text"
                    value={startingRef}
                    onChange={(e) => setStartingRef(e.target.value)}
                    placeholder="main"
                    className={`${inputClass} font-mono`}
                  />
                </div>
                <label className="flex items-end gap-2 pb-2 text-[13px] text-[#a0a0a0] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={autoCreatePR}
                    onChange={(e) => setAutoCreatePR(e.target.checked)}
                    className="rounded"
                  />
                  Auto-create PR
                </label>
              </div>
            </>
          )}

          {error && (
            <div className="px-3 py-2.5 rounded-md bg-[rgba(240,112,112,0.1)] border border-[rgba(240,112,112,0.25)] text-[#f07070] text-[13px]">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={creating}
            className="h-9 px-4 rounded-md bg-[#e4e4e4] text-[#141414] text-[13px] font-medium hover:bg-white disabled:opacity-40 transition-colors"
          >
            {creating ? "Starting…" : "Create session"}
          </button>
        </form>
      </main>
    </div>
  );
}

function formatCursorSessionLabel(
  session: CursorChatSession,
  index: number,
): string {
  const when = new Date(session.updatedAt).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  const shortId = session.id.slice(0, 8);
  const prefix = index === 0 ? "Latest · " : "";
  const empty = session.hasConversation ? "" : " · empty";
  return `${prefix}${when} · ${shortId}${empty}`;
}
