"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { X } from "lucide-react";
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
import { workspaceCode } from "../../lib/useWorkspaceScope";

type AgentBackendKind = "cursor" | "claude-code";

function authLabel(mode: AuthMode, inOrg: boolean): string {
  if (mode === "cli") return "Local login";
  if (mode === "byok") return "Bring your own";
  return inOrg ? "Team key" : "Server key";
}

export default function SessionComposeModal({
  initialOrgId,
  workspaceName,
  onClose,
}: {
  initialOrgId?: string;
  workspaceName: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [backend, setBackend] = useState<AgentBackendKind>("cursor");
  const [runtime, setRuntime] = useState<AgentRuntime>("local");
  const [controlMode, setControlMode] = useState<"open" | "driver" | "host">(
    "driver",
  );
  const [planMode, setPlanMode] = useState(false);
  const [approvalMode, setApprovalMode] = useState<
    "off" | "dangerous" | "all"
  >("dangerous");
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
  const [workspace, setWorkspace] = useState<WorkspaceScope>(
    initialOrgId && initialOrgId !== "personal" ? initialOrgId : "personal",
  );

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
  const displayWorkspaceName =
    workspace === "personal"
      ? "Personal"
      : activeOrg?.name || workspaceName || "Workspace";

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
    const initial =
      initialOrgId && initialOrgId !== "personal"
        ? initialOrgId
        : readSelectedWorkspace();
    setWorkspace(initial);
    writeSelectedWorkspace(initial);
    void fetchOrgs()
      .then((list) => {
        setOrgs(list);
        if (initial !== "personal" && !list.some((o) => o.id === initial)) {
          setWorkspace("personal");
          writeSelectedWorkspace("personal");
        }
      })
      .catch(() => {});
  }, [initialOrgId]);

  useEffect(() => {
    void refreshAuth(workspace);
  }, [workspace]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

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

  const handleSubmit = async (e?: FormEvent) => {
    e?.preventDefault();
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
        planMode,
        approvalMode,
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
    "w-full h-9 px-3 bg-[#252525] border border-[#2b2b2b] rounded-md text-[13px] text-[#e4e4e4] placeholder:text-[#6e6e6e] outline-none focus:border-[#4d9fff] transition-colors";

  const authOptions: AuthMode[] =
    runtime === "local" ? ["cli", "server", "byok"] : ["server", "byok"];

  const subtitle = isClaude
    ? runtime === "cloud"
      ? "Claude Code in an E2B sandbox — Anthropic key required."
      : "Claude Code on your machine via the Steer CLI worker."
    : "Local uses your Cursor CLI login. Cloud needs a server key or BYOK.";

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center px-3 pt-[5vh] sm:pt-[8vh] pb-6">
      <button
        type="button"
        className="absolute inset-0 bg-black/65"
        aria-label="Close new session"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="session-compose-title"
        className="relative flex w-full max-w-[680px] max-h-[min(860px,90vh)] flex-col overflow-hidden rounded-xl border border-[#2b2b2b] bg-[#1c1c1c] shadow-[0_24px_80px_rgba(0,0,0,0.55)]"
      >
        <div className="flex shrink-0 items-center justify-between gap-3 px-4 pt-3.5 pb-2">
          <div className="flex items-center gap-2 min-w-0 text-[13px]">
            <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-[#1e2a3a] text-[10px] font-medium text-[#8ec5ff]">
              {workspaceCode(displayWorkspaceName).slice(0, 1)}
            </span>
            <span className="text-[#a0a0a0] truncate">
              {workspaceCode(displayWorkspaceName)}
            </span>
            <span className="text-[#6e6e6e]">›</span>
            <span id="session-compose-title" className="text-[#e4e4e4]">
              New session
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[#6e6e6e] hover:text-[#e4e4e4]"
            aria-label="Close"
          >
            <X className="h-4 w-4" strokeWidth={1.75} />
          </button>
        </div>

        <form
          onSubmit={(e) => void handleSubmit(e)}
          className="flex min-h-0 flex-1 flex-col"
        >
          <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-2">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Session name"
              className="w-full bg-transparent pt-1 pb-1.5 text-[20px] font-medium text-[#e4e4e4] placeholder:text-[#6e6e6e] outline-none"
              autoFocus
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                  e.preventDefault();
                  void handleSubmit();
                }
              }}
            />
            <p className="text-[12px] text-[#6e6e6e] mb-4">{subtitle}</p>

            <div className="space-y-4">
              <Field label="Workspace">
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
              </Field>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Agent backend">
                  <Segmented
                    value={backend}
                    onChange={selectBackend}
                    options={[
                      { id: "cursor", label: "Cursor" },
                      { id: "claude-code", label: "Claude Code" },
                    ]}
                  />
                </Field>
                <Field label="Runtime">
                  <Segmented
                    value={runtime}
                    onChange={selectRuntime}
                    options={[
                      {
                        id: "local",
                        label: isClaude ? "Local (CLI)" : "Local",
                      },
                      {
                        id: "cloud",
                        label: isClaude ? "Cloud (E2B)" : "Cloud",
                      },
                    ]}
                  />
                </Field>
              </div>

              <Field label="Control mode">
                <div className="grid grid-cols-3 gap-1.5">
                  {(
                    [
                      {
                        id: "open" as const,
                        label: "Open",
                        body: "Any editor",
                      },
                      {
                        id: "driver" as const,
                        label: "Driver",
                        body: "Driver/host",
                      },
                      {
                        id: "host" as const,
                        label: "Host only",
                        body: "Host alone",
                      },
                    ] as const
                  ).map((opt) => (
                    <ChoiceCard
                      key={opt.id}
                      active={controlMode === opt.id}
                      onClick={() => setControlMode(opt.id)}
                      label={opt.label}
                      body={opt.body}
                    />
                  ))}
                </div>
                {runtime === "local" && (
                  <p className="text-[11px] text-[#c9a227] mt-2">
                    Local agents can operate on the host machine. Driver mode is
                    recommended.
                  </p>
                )}
              </Field>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Agent mode">
                  <div className="grid grid-cols-2 gap-1.5">
                    <ChoiceCard
                      active={!planMode}
                      onClick={() => setPlanMode(false)}
                      label="Agent"
                      body="Edit + shell"
                    />
                    <ChoiceCard
                      active={planMode}
                      onClick={() => setPlanMode(true)}
                      label="Plan"
                      body="Propose only"
                    />
                  </div>
                </Field>
                <Field label="Approval gates">
                  <div className="grid grid-cols-3 gap-1.5">
                    {(
                      [
                        { id: "off" as const, label: "Off" },
                        { id: "dangerous" as const, label: "Dangerous" },
                        { id: "all" as const, label: "All tools" },
                      ] as const
                    ).map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => setApprovalMode(opt.id)}
                        className={`h-9 rounded-md border px-1.5 text-[12px] transition-colors ${
                          approvalMode === opt.id
                            ? "bg-[#252525] border-[#c9a227] text-[#e4e4e4]"
                            : "bg-[#171717] border-[#2b2b2b] text-[#6e6e6e] hover:text-[#a0a0a0]"
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </Field>
              </div>

              {isClaude && (
                <Field label="Model">
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
                </Field>
              )}

              {isClaudeLocal && (
                <Note>
                  <p className="text-[12px] text-[#e4e4e4]">Local Claude Code</p>
                  <p className="text-[11px] text-[#6e6e6e] mt-1">
                    Uses your paired Steer worker and the{" "}
                    <code className="text-[#a0a0a0]">claude</code> CLI. No
                    Anthropic key is stored on the server.
                  </p>
                  <p
                    className={`text-[11px] mt-1 ${
                      workerOnline ? "text-[#3ecf8e]" : "text-[#f07070]"
                    }`}
                  >
                    {workerOnline
                      ? "CLI worker online"
                      : "CLI worker offline — run `steer start`"}
                  </p>
                </Note>
              )}

              {isClaudeCloud && (
                <div className="space-y-3">
                  <Note>
                    <p className="text-[12px] text-[#e4e4e4]">
                      Cloud Claude Code
                    </p>
                    <p className="text-[11px] text-[#6e6e6e] mt-1">
                      Runs in an E2B sandbox. Push/PR needs{" "}
                      <code className="text-[#a0a0a0]">GITHUB_TOKEN</code> on
                      the server.
                    </p>
                    <p
                      className={`text-[11px] mt-1 ${
                        e2bConfigured ? "text-[#3ecf8e]" : "text-[#f07070]"
                      }`}
                    >
                      {e2bConfigured
                        ? "E2B configured on server"
                        : "Server missing E2B_API_KEY"}
                    </p>
                  </Note>

                  <Field label="Anthropic API key">
                    {inOrg &&
                    orgAnthropicKeyConfigured &&
                    !anthropicApiKey.trim() &&
                    !anthropicConfigured ? (
                      <p className="text-[11px] text-[#6e6e6e] mb-1.5">
                        Using team shared Anthropic key {orgAnthropicKeyHint}
                        {activeOrg ? ` (${activeOrg.name})` : ""}. Configure in{" "}
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
                        Using your saved key {anthropicHint}. Paste a new key
                        below only if you want to replace it.
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
                          className="h-9 px-3 rounded-md bg-[#252525] border border-[#2b2b2b] text-[12px] text-[#a0a0a0] hover:text-[#f07070] hover:border-[#3c3c3c] disabled:opacity-40 shrink-0"
                        >
                          {clearingAnthropic ? "…" : "Clear"}
                        </button>
                      )}
                    </div>
                  </Field>
                </div>
              )}

              {!isClaude && (
                <Field label="Auth">
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {authOptions.map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        disabled={mode === "byok" && !byokAvailable}
                        onClick={() => setAuthMode(mode)}
                        className={`h-8 px-2.5 rounded-md text-[12px] border transition-colors disabled:opacity-40 ${
                          authMode === mode
                            ? "bg-[#252525] border-[#4d9fff] text-[#e4e4e4]"
                            : "bg-[#171717] border-[#2b2b2b] text-[#6e6e6e] hover:text-[#a0a0a0]"
                        }`}
                      >
                        {authLabel(mode, inOrg)}
                      </button>
                    ))}
                  </div>
                  {authMode === "cli" && (
                    <p className="text-[11px] text-[#6e6e6e]">
                      Uses the Cursor account already logged in on this machine.
                      No API key required.
                    </p>
                  )}
                  {authMode === "server" && (
                    <div className="space-y-2">
                      {inOrg ? (
                        orgCursorKeyConfigured ? (
                          <p className="text-[11px] text-[#6e6e6e]">
                            Using team shared key {orgCursorKeyHint}
                            {activeOrg ? ` (${activeOrg.name})` : ""}. Configure
                            in{" "}
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
                            </Link>
                            .
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
                          No server key configured. Set CURSOR_API_KEY in the
                          server environment
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
                            className="h-9 px-3 rounded-md bg-[#252525] border border-[#2b2b2b] text-[12px] text-[#e4e4e4] hover:border-[#3c3c3c] disabled:opacity-40 shrink-0"
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
                          Using your saved key {userByokHint}. Paste a new key
                          below only if you want to replace it.
                        </p>
                      ) : (
                        <p className="text-[11px] text-[#6e6e6e]">
                          {userByokConfigured
                            ? `Replacing saved key ${userByokHint}.`
                            : "Saved to your account (encrypted) for future sessions."}
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
                            className="h-9 px-3 rounded-md bg-[#252525] border border-[#2b2b2b] text-[12px] text-[#a0a0a0] hover:text-[#f07070] hover:border-[#3c3c3c] disabled:opacity-40 shrink-0"
                          >
                            {clearingByok ? "…" : "Clear"}
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </Field>
              )}

              {runtime === "local" ? (
                <Field label="Repository folder">
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
                      className="h-9 px-3 rounded-md bg-[#252525] border border-[#2b2b2b] text-[12px] text-[#e4e4e4] hover:border-[#3c3c3c] disabled:opacity-40 shrink-0"
                    >
                      {pickingFolder ? "Opening…" : "Browse…"}
                    </button>
                  </div>
                  <p className="text-[11px] text-[#6e6e6e] mt-1.5">
                    {workerOnline
                      ? "Opens a folder picker on the machine running `steer start`."
                      : "Start your CLI worker first (`steer start`), then browse."}
                  </p>
                </Field>
              ) : (
                <>
                  <Field label="GitHub repository">
                    {repos.length > 0 && !isClaude && (
                      <select
                        value={
                          repos.some((r) => r.url === repoUrl) ? repoUrl : ""
                        }
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
                        <code className="text-[#a0a0a0]">GITHUB_TOKEN</code> on
                        the server.
                      </p>
                    )}
                  </Field>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Starting ref">
                      <input
                        type="text"
                        value={startingRef}
                        onChange={(e) => setStartingRef(e.target.value)}
                        placeholder="main"
                        className={`${inputClass} font-mono`}
                      />
                    </Field>
                    <label className="flex items-end gap-2 pb-1.5 text-[13px] text-[#a0a0a0] cursor-pointer">
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
                <div className="px-3 py-2 rounded-md bg-[rgba(240,112,112,0.1)] border border-[rgba(240,112,112,0.25)] text-[#f07070] text-[12px]">
                  {error}
                </div>
              )}
            </div>
          </div>

          <div className="flex shrink-0 items-center justify-end gap-2 border-t border-[#2b2b2b] px-4 py-3">
            <button
              type="button"
              onClick={onClose}
              className="h-8 px-3 rounded-md text-[12px] text-[#a0a0a0] hover:text-[#e4e4e4]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={creating}
              className="h-8 px-3 rounded-md bg-[#5e6ad2] text-white text-[13px] font-medium hover:bg-[#6b76db] disabled:opacity-50"
            >
              {creating ? "Starting…" : "Create session"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div>
      <div className="block text-[11px] font-medium uppercase tracking-wide text-[#6e6e6e] mb-1.5">
        {label}
      </div>
      {children}
    </div>
  );
}

function Note({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-md border border-[#2b2b2b] bg-[#171717] px-3 py-2.5">
      {children}
    </div>
  );
}

function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (value: T) => void;
  options: Array<{ id: T; label: string }>;
}) {
  return (
    <div className="flex gap-1.5">
      {options.map((opt) => (
        <button
          key={opt.id}
          type="button"
          onClick={() => onChange(opt.id)}
          className={`h-9 flex-1 rounded-md text-[12px] border transition-colors ${
            value === opt.id
              ? "bg-[#252525] border-[#4d9fff] text-[#e4e4e4]"
              : "bg-[#171717] border-[#2b2b2b] text-[#6e6e6e] hover:text-[#a0a0a0]"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function ChoiceCard({
  active,
  onClick,
  label,
  body,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  body: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md border px-2.5 py-2 text-left transition-colors ${
        active
          ? "bg-[#252525] border-[#4d9fff] text-[#e4e4e4]"
          : "bg-[#171717] border-[#2b2b2b] text-[#6e6e6e] hover:text-[#a0a0a0]"
      }`}
    >
      <div className="text-[12px] text-[#e4e4e4] leading-tight">{label}</div>
      <div className="text-[10px] text-[#6e6e6e] mt-0.5 leading-tight">
        {body}
      </div>
    </button>
  );
}
