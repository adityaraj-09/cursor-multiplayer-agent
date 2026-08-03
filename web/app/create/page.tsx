"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  clearAnthropicByokKey,
  clearByokKey,
  createRoom,
  fetchAuthStatus,
  fetchOnlineWorkers,
  fetchOrgs,
  fetchRepositories,
  pickLocalFolder,
  setServerKey,
  type OrgInfo,
} from "../../lib/api";
import type {
  AgentRuntime,
  AuthMode,
  RepoInfo,
} from "../../../shared/events";
import {
  CLAUDE_MODELS,
  DEFAULT_CLAUDE_MODEL,
  isClaudeModelId,
} from "../../../shared/claudeModels";
import {
  readSelectedWorkspace,
  writeSelectedWorkspace,
  type WorkspaceScope,
} from "../../lib/workspace";

type AgentBackendKind = "cursor" | "claude-code";

function authLabel(mode: AuthMode, inOrg: boolean): string {
  if (mode === "cli") return "Local login";
  if (mode === "byok") return "Bring your own";
  return inOrg ? "Team key" : "Server key";
}

export default function CreateSession() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [backend, setBackend] = useState<AgentBackendKind>("cursor");
  const [runtime, setRuntime] = useState<AgentRuntime>("local");
  const [controlMode, setControlMode] = useState<"open" | "driver" | "host">(
    "driver",
  );
  const [authMode, setAuthMode] = useState<AuthMode>("cli");
  const [apiKey, setApiKey] = useState("");
  const [anthropicApiKey, setAnthropicApiKey] = useState("");
  const [modelId, setModelId] = useState("auto");
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
  const [orgCursorKeyConfigured, setOrgCursorKeyConfigured] = useState(false);
  const [orgCursorKeyHint, setOrgCursorKeyHint] = useState<string | null>(null);
  const [orgAnthropicKeyConfigured, setOrgAnthropicKeyConfigured] =
    useState(false);
  const [orgAnthropicKeyHint, setOrgAnthropicKeyHint] = useState<string | null>(
    null,
  );
  const [byokAvailable, setByokAvailable] = useState(false);
  const [userByokConfigured, setUserByokConfigured] = useState(false);
  const [userByokHint, setUserByokHint] = useState<string | null>(null);
  const [anthropicConfigured, setAnthropicConfigured] = useState(false);
  const [anthropicHint, setAnthropicHint] = useState<string | null>(null);
  const [e2bConfigured, setE2bConfigured] = useState(false);
  const [canManageServerKey, setCanManageServerKey] = useState(false);
  const [savingServerKey, setSavingServerKey] = useState(false);
  const [clearingByok, setClearingByok] = useState(false);
  const [clearingAnthropic, setClearingAnthropic] = useState(false);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [pickingFolder, setPickingFolder] = useState(false);
  const [workerOnline, setWorkerOnline] = useState(false);
  const [orgs, setOrgs] = useState<OrgInfo[]>([]);
  const [workspace, setWorkspace] = useState<WorkspaceScope>("personal");

  const isClaude = backend === "claude-code";
  const isClaudeCloud = isClaude && runtime === "cloud";
  const isClaudeLocal = isClaude && runtime === "local";
  const inOrg = workspace !== "personal";
  const activeOrg = orgs.find((o) => o.id === workspace) || null;
  const teamKeyReady = inOrg
    ? orgCursorKeyConfigured || serverKeyConfigured
    : serverKeyConfigured;
  const teamAnthropicReady = inOrg
    ? orgAnthropicKeyConfigured || anthropicConfigured
    : anthropicConfigured;

  const refreshAuth = (orgId?: string | null) =>
    fetchAuthStatus({ orgId: orgId && orgId !== "personal" ? orgId : null })
      .then((s) => {
        setServerKeyConfigured(s.serverKeyConfigured);
        setServerKeyHint(s.serverKeyHint);
        setServerKeySource(s.serverKeySource);
        setOrgCursorKeyConfigured(Boolean(s.orgCursorKeyConfigured));
        setOrgCursorKeyHint(s.orgCursorKeyHint ?? null);
        setOrgAnthropicKeyConfigured(Boolean(s.orgAnthropicKeyConfigured));
        setOrgAnthropicKeyHint(s.orgAnthropicKeyHint ?? null);
        setByokAvailable(s.byokAvailable);
        setUserByokConfigured(Boolean(s.userByokConfigured));
        setUserByokHint(s.userByokHint ?? null);
        setAnthropicConfigured(Boolean(s.userAnthropicByokConfigured));
        setAnthropicHint(s.userAnthropicByokHint ?? null);
        setE2bConfigured(Boolean(s.e2bConfigured));
        setCanManageServerKey(Boolean(s.canManageServerKey));
      })
      .catch(() => {});

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const fromQuery = params.get("org")?.trim();
    const initial =
      fromQuery && fromQuery !== "personal"
        ? fromQuery
        : readSelectedWorkspace();
    setWorkspace(initial);
    writeSelectedWorkspace(initial);
    void fetchOrgs()
      .then((list) => {
        setOrgs(list);
        if (
          initial !== "personal" &&
          !list.some((o) => o.id === initial)
        ) {
          setWorkspace("personal");
          writeSelectedWorkspace("personal");
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    void refreshAuth(workspace);
  }, [workspace]);

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

  const selectBackend = (next: AgentBackendKind) => {
    setBackend(next);
    setError("");
    if (next === "claude-code") {
      setModelId(DEFAULT_CLAUDE_MODEL);
      if (runtime === "local") setAuthMode("cli");
    } else if (modelId !== "auto" && isClaudeModelId(modelId)) {
      setModelId("auto");
    }
  };

  const selectRuntime = (r: AgentRuntime) => {
    setRuntime(r);
    setControlMode(r === "local" ? "driver" : "open");
    setRepos([]);
    setError("");
    if (backend === "claude-code") {
      if (r === "local") setAuthMode("cli");
      return;
    }
    if (r === "local") setAuthMode("cli");
    else if (authMode === "cli") {
      setAuthMode(userByokConfigured ? "byok" : "server");
    }
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

  const handleClearByok = async () => {
    if (
      !window.confirm(
        "Remove your saved Cursor API key? You’ll need to paste it again for the next BYOK session.",
      )
    ) {
      return;
    }
    setClearingByok(true);
    setError("");
    try {
      await clearByokKey();
      setUserByokConfigured(false);
      setUserByokHint(null);
      setApiKey("");
      setRepos([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to clear BYOK key");
    } finally {
      setClearingByok(false);
    }
  };

  const handleClearAnthropic = async () => {
    if (
      !window.confirm(
        "Remove your saved Anthropic API key? You’ll need it again for Claude Code cloud.",
      )
    ) {
      return;
    }
    setClearingAnthropic(true);
    setError("");
    try {
      await clearAnthropicByokKey();
      setAnthropicConfigured(false);
      setAnthropicHint(null);
      setAnthropicApiKey("");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to clear Anthropic key",
      );
    } finally {
      setClearingAnthropic(false);
    }
  };

  // Cursor cloud only — Claude cloud uses a pasted GitHub URL (no Cursor repo catalog).
  useEffect(() => {
    let cancelled = false;
    if (runtime !== "cloud" || backend === "claude-code") {
      setRepos([]);
      return;
    }
    if (authMode === "server" && !teamKeyReady) {
      setRepos([]);
      return;
    }
    if (authMode === "byok" && !apiKey.trim() && !userByokConfigured) {
      setRepos([]);
      return;
    }

    const t = setTimeout(() => {
      fetchRepositories({
        authMode,
        apiKey: authMode === "byok" && apiKey.trim() ? apiKey.trim() : undefined,
        orgId: inOrg ? workspace : undefined,
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
    }, authMode === "byok" && apiKey.trim() ? 400 : 0);

    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [
    authMode,
    apiKey,
    runtime,
    backend,
    teamKeyReady,
    userByokConfigured,
    inOrg,
    workspace,
  ]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError("Session name is required");
      return;
    }

    if (isClaudeCloud) {
      if (!e2bConfigured) {
        setError("Server is missing E2B_API_KEY — Claude Code cloud cannot start");
        return;
      }
      if (
        !anthropicApiKey.trim() &&
        !anthropicConfigured &&
        !(inOrg && orgAnthropicKeyConfigured)
      ) {
        setError(
          inOrg
            ? "Set a shared Anthropic key in Team settings, or paste your key"
            : "Paste your Anthropic API key for Claude Code",
        );
        return;
      }
    } else if (!isClaude) {
      if (authMode === "byok" && !apiKey.trim() && !userByokConfigured) {
        setError("Paste your Cursor API key for BYOK");
        return;
      }
      if (authMode === "server" && !teamKeyReady) {
        setError(
          inOrg
            ? "Team shared Cursor key is not configured — set it in Team settings"
            : "Server key is not configured",
        );
        return;
      }
    }

    if (runtime === "cloud" && !repoUrl.trim()) {
      setError("Choose or paste a GitHub repo URL");
      return;
    }
    if (runtime === "local" && !repoPath.trim()) {
      setError("Select a local repository folder");
      return;
    }
    if (isClaudeLocal && !workerOnline) {
      setError("Start your CLI worker first (`steer start`) for local Claude Code");
      return;
    }

    setCreating(true);
    setError("");

    try {
      const effectiveAuth: AuthMode = isClaudeLocal
        ? "cli"
        : isClaudeCloud
          ? "server"
          : authMode;

      const room = await createRoom({
        name: name.trim(),
        runtime,
        authMode: effectiveAuth,
        backend,
        controlMode,
        modelId: isClaude
          ? modelId || DEFAULT_CLAUDE_MODEL
          : modelId || "auto",
        repoPath: runtime === "local" ? repoPath.trim() || undefined : undefined,
        repoUrl: runtime === "cloud" ? repoUrl.trim() : undefined,
        startingRef:
          runtime === "cloud" ? startingRef.trim() || "main" : undefined,
        autoCreatePR: runtime === "cloud" ? autoCreatePR : undefined,
        apiKey:
          !isClaude && authMode === "byok" && apiKey.trim()
            ? apiKey.trim()
            : undefined,
        anthropicApiKey:
          isClaudeCloud && anthropicApiKey.trim()
            ? anthropicApiKey.trim()
            : undefined,
        orgId: inOrg ? workspace : undefined,
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

  const subtitle = isClaude
    ? runtime === "cloud"
      ? "Claude Code in an E2B sandbox — bring your Anthropic API key. Server needs E2B_API_KEY (and GITHUB_TOKEN for push/PR)."
      : "Claude Code on your machine via the Steer CLI worker — requires the claude CLI and protocol 3+ (`npm i -g @oblivihon/steer`)."
    : "Local sessions use your Cursor CLI login — no API key. Cloud needs a server key or BYOK.";

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
        <p className="text-[13px] text-[#6e6e6e] mb-8">{subtitle}</p>

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
              Workspace
            </legend>
            <select
              value={workspace}
              onChange={(e) => {
                const next = e.target.value as WorkspaceScope;
                setWorkspace(next);
                writeSelectedWorkspace(next);
                setError("");
              }}
              className={inputClass}
            >
              <option value="personal">Personal</option>
              {orgs.map((org) => (
                <option key={org.id} value={org.id}>
                  {org.name}
                </option>
              ))}
            </select>
            <p className="text-[11px] text-[#6e6e6e] mt-1.5">
              {inOrg
                ? "Team sessions appear on every member’s shared dashboard."
                : "Personal sessions stay under your account."}
            </p>
          </fieldset>

          <fieldset>
            <legend className="block text-[12px] text-[#a0a0a0] mb-1.5">
              Agent backend
            </legend>
            <div className="flex gap-2">
              {(
                [
                  { id: "cursor" as const, label: "Cursor" },
                  { id: "claude-code" as const, label: "Claude Code" },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => selectBackend(opt.id)}
                  className={`h-9 px-3 rounded-md text-[13px] border transition-colors ${
                    backend === opt.id
                      ? "bg-[#252525] border-[#4d9fff] text-[#e4e4e4]"
                      : "bg-[#1a1a1a] border-[#2b2b2b] text-[#6e6e6e]"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </fieldset>

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
                  {r === "local"
                    ? isClaude
                      ? "Local (CLI)"
                      : "Local"
                    : isClaude
                      ? "Cloud (E2B)"
                      : "Cloud"}
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend className="block text-[12px] text-[#a0a0a0] mb-1.5">
              Control mode
            </legend>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {(
                [
                  {
                    id: "open" as const,
                    label: "Open",
                    body: "Any editor can steer",
                  },
                  {
                    id: "driver" as const,
                    label: "Driver",
                    body: "Driver or host only",
                  },
                  {
                    id: "host" as const,
                    label: "Host only",
                    body: "Host steers alone",
                  },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setControlMode(opt.id)}
                  className={`rounded-md border px-3 py-2 text-left transition-colors ${
                    controlMode === opt.id
                      ? "bg-[#252525] border-[#4d9fff] text-[#e4e4e4]"
                      : "bg-[#1a1a1a] border-[#2b2b2b] text-[#6e6e6e]"
                  }`}
                >
                  <div className="text-[13px] text-[#e4e4e4]">{opt.label}</div>
                  <div className="text-[11px] text-[#6e6e6e] mt-0.5">
                    {opt.body}
                  </div>
                </button>
              ))}
            </div>
            {runtime === "local" && (
              <p className="text-[11px] text-[#a07a3a] mt-2">
                Local agents can operate on the host machine. Driver-enforced
                mode is recommended.
              </p>
            )}
          </fieldset>

          {isClaude && (
            <div>
              <label className="block text-[12px] text-[#a0a0a0] mb-1.5">
                Model
              </label>
              <select
                value={modelId}
                onChange={(e) => setModelId(e.target.value)}
                className={inputClass}
              >
                {CLAUDE_MODELS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.displayName}
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-[#6e6e6e] mt-1.5">
                {CLAUDE_MODELS.find((m) => m.id === modelId)?.description}
              </p>
            </div>
          )}

          {isClaudeLocal && (
            <div className="rounded-md border border-[#2b2b2b] bg-[#1a1a1a] px-3 py-2.5 space-y-1">
              <p className="text-[12px] text-[#e4e4e4]">Local Claude Code</p>
              <p className="text-[11px] text-[#6e6e6e]">
                Uses your paired Steer worker (protocol 3+) and the{" "}
                <code className="text-[#a0a0a0]">claude</code> CLI on that
                machine. No Anthropic key is stored on the server.
              </p>
              <p
                className={`text-[11px] ${
                  workerOnline ? "text-[#3ecf8e]" : "text-[#f07070]"
                }`}
              >
                {workerOnline
                  ? "CLI worker online"
                  : "CLI worker offline — run `steer start`"}
              </p>
            </div>
          )}

          {isClaudeCloud && (
            <div className="space-y-3">
              <div className="rounded-md border border-[#2b2b2b] bg-[#1a1a1a] px-3 py-2.5 space-y-1">
                <p className="text-[12px] text-[#e4e4e4]">Cloud Claude Code</p>
                <p className="text-[11px] text-[#6e6e6e]">
                  Runs in an E2B sandbox. Anthropic key is BYOK (encrypted to
                  your account). Push/PR needs{" "}
                  <code className="text-[#a0a0a0]">GITHUB_TOKEN</code> on the
                  server.
                </p>
                <p
                  className={`text-[11px] ${
                    e2bConfigured ? "text-[#3ecf8e]" : "text-[#f07070]"
                  }`}
                >
                  {e2bConfigured
                    ? "E2B configured on server"
                    : "Server missing E2B_API_KEY"}
                </p>
              </div>

              <div>
                <label className="block text-[12px] text-[#a0a0a0] mb-1.5">
                  Anthropic API key
                </label>
                {inOrg &&
                orgAnthropicKeyConfigured &&
                !anthropicApiKey.trim() &&
                !anthropicConfigured ? (
                  <p className="text-[11px] text-[#6e6e6e] mb-1.5">
                    Using team shared Anthropic key {orgAnthropicKeyHint}
                    {activeOrg ? ` (${activeOrg.name})` : ""}. Paste a personal
                    key below only to override. Configure in{" "}
                    <Link
                      href={`/org/${workspace}/settings`}
                      className="text-[#4d9fff] hover:underline"
                    >
                      Team settings
                    </Link>
                    .
                  </p>
                ) : anthropicConfigured && !anthropicApiKey.trim() ? (
                  <p className="text-[11px] text-[#6e6e6e] mb-1.5">
                    Using your saved key {anthropicHint}. Paste a new key below
                    only if you want to replace it.
                  </p>
                ) : (
                  <p className="text-[11px] text-[#6e6e6e] mb-1.5">
                    {anthropicConfigured
                      ? `Replacing saved key ${anthropicHint}.`
                      : inOrg && !orgAnthropicKeyConfigured
                        ? "No team Anthropic key yet — paste one or set it in Team settings."
                        : byokAvailable
                          ? "Saved to your account (encrypted) for future Claude agents."
                          : "Paste your Anthropic API key (sk-ant-…)."}
                  </p>
                )}
                <div className="flex gap-2">
                  <input
                    type="password"
                    value={anthropicApiKey}
                    onChange={(e) => setAnthropicApiKey(e.target.value)}
                    placeholder={
                      teamAnthropicReady
                        ? "Override with personal key…"
                        : "sk-ant-…"
                    }
                    className={`${inputClass} font-mono flex-1`}
                    autoComplete="off"
                  />
                  {anthropicConfigured && (
                    <button
                      type="button"
                      onClick={() => void handleClearAnthropic()}
                      disabled={clearingAnthropic}
                      className="h-10 px-3 rounded-md bg-[#252525] border border-[#2b2b2b] text-[13px] text-[#a0a0a0] hover:text-[#f07070] hover:border-[#3c3c3c] disabled:opacity-40 shrink-0"
                    >
                      {clearingAnthropic ? "…" : "Clear"}
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {!isClaude && (
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
                    {authLabel(mode, inOrg)}
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
                  {inOrg ? (
                    orgCursorKeyConfigured ? (
                      <p className="text-[11px] text-[#6e6e6e]">
                        Using team shared key {orgCursorKeyHint}
                        {activeOrg ? ` (${activeOrg.name})` : ""}. Configure in{" "}
                        <Link
                          href={`/org/${workspace}/settings`}
                          className="text-[#4d9fff] hover:underline"
                        >
                          Team settings
                        </Link>
                        .
                      </p>
                    ) : serverKeyConfigured ? (
                      <p className="text-[11px] text-[#6e6e6e]">
                        No team key yet — falling back to server key{" "}
                        {serverKeyHint}. Prefer setting a shared key in{" "}
                        <Link
                          href={`/org/${workspace}/settings`}
                          className="text-[#4d9fff] hover:underline"
                        >
                          Team settings
                        </Link>
                        .
                      </p>
                    ) : (
                      <p className="text-[11px] text-[#f07070]">
                        No team shared Cursor key. Set one in{" "}
                        <Link
                          href={`/org/${workspace}/settings`}
                          className="text-[#4d9fff] hover:underline"
                        >
                          Team settings
                        </Link>{" "}
                        so the whole team can create cloud sessions.
                      </p>
                    )
                  ) : serverKeyConfigured ? (
                    <p className="text-[11px] text-[#6e6e6e]">
                      Using server key {serverKeyHint}{" "}
                      {serverKeySource === "env"
                        ? "(from CURSOR_API_KEY)"
                        : "(picked up & encrypted in DB)"}
                    </p>
                  ) : (
                    <p className="text-[11px] text-[#6e6e6e]">
                      No server key configured. Set CURSOR_API_KEY in the server
                      environment
                      {canManageServerKey
                        ? ", or paste one below to pick it up."
                        : " (admins only can pick up a key in the UI)."}
                    </p>
                  )}
                  {!inOrg && canManageServerKey && (
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
                  )}
                </div>
              )}
              {authMode === "byok" && (
                <div className="space-y-2">
                  {userByokConfigured && !apiKey.trim() ? (
                    <p className="text-[11px] text-[#6e6e6e]">
                      Using your saved key {userByokHint}. Paste a new key below
                      only if you want to replace it.
                    </p>
                  ) : (
                    <p className="text-[11px] text-[#6e6e6e]">
                      {userByokConfigured
                        ? `Replacing saved key ${userByokHint}. Saved to your account for future sessions.`
                        : "Saved to your account (encrypted) so you don’t re-paste for every cloud session."}
                    </p>
                  )}
                  <div className="flex gap-2">
                    <input
                      type="password"
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      placeholder={
                        userByokConfigured
                          ? "Replace saved key…"
                          : "cursor_…"
                      }
                      className={`${inputClass} font-mono flex-1`}
                      autoComplete="off"
                    />
                    {userByokConfigured && (
                      <button
                        type="button"
                        onClick={() => void handleClearByok()}
                        disabled={clearingByok}
                        className="h-10 px-3 rounded-md bg-[#252525] border border-[#2b2b2b] text-[13px] text-[#a0a0a0] hover:text-[#f07070] hover:border-[#3c3c3c] disabled:opacity-40 shrink-0"
                      >
                        {clearingByok ? "…" : "Clear"}
                      </button>
                    )}
                  </div>
                </div>
              )}
            </fieldset>
          )}

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
            </div>
          ) : (
            <>
              <div>
                <label className="block text-[12px] text-[#a0a0a0] mb-1.5">
                  GitHub repository
                </label>
                {repos.length > 0 && !isClaude && (
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
                {isClaude && (
                  <p className="text-[11px] text-[#6e6e6e] mt-1.5">
                    Paste any https://github.com/… URL. Private repos require{" "}
                    <code className="text-[#a0a0a0]">GITHUB_TOKEN</code> on the
                    server.
                  </p>
                )}
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
              {isClaude && autoCreatePR && (
                <p className="text-[11px] text-[#6e6e6e] -mt-2">
                  Opens a GitHub PR after each successful turn when{" "}
                  <code className="text-[#a0a0a0]">GITHUB_TOKEN</code> /{" "}
                  <code className="text-[#a0a0a0]">GH_TOKEN</code> is set.
                </p>
              )}
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
