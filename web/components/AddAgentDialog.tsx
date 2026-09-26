"use client";

import { useEffect, useState } from "react";
import type { AgentBackendKind } from "../../shared/backends/types";
import { isCliSandboxBackend } from "../../shared/backends/types";
import {
  clearAnthropicByokKey,
  clearByokKey,
  clearOpenaiByokKey,
  fetchAuthStatus,
  validateAgentScope,
} from "../lib/api";

interface AddAgentDialogProps {
  open: boolean;
  onClose: () => void;
  roomId: string;
  onSubmit: (data: {
    label: string;
    backend: AgentBackendKind;
    scopePath?: string;
    modelId?: string;
    anthropicApiKey?: string;
    openaiApiKey?: string;
    apiKey?: string;
    planMode?: boolean;
    seedContext?: boolean;
  }) => Promise<void>;
  runtime: "local" | "cloud";
  /** When set, Claude cloud can reuse the org shared Anthropic key. */
  orgId?: string;
}

export default function AddAgentDialog({
  open,
  onClose,
  roomId,
  onSubmit,
  runtime,
  orgId,
}: AddAgentDialogProps) {
  const [label, setLabel] = useState("");
  const [backend, setBackend] = useState<AgentBackendKind>("cursor");
  const [scopePath, setScopePath] = useState("");
  const [scopeWarning, setScopeWarning] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [anthropicApiKey, setAnthropicApiKey] = useState("");
  const [openaiApiKey, setOpenaiApiKey] = useState("");
  const [anthropicConfigured, setAnthropicConfigured] = useState(false);
  const [anthropicHint, setAnthropicHint] = useState<string | null>(null);
  const [openaiConfigured, setOpenaiConfigured] = useState(false);
  const [openaiHint, setOpenaiHint] = useState<string | null>(null);
  const [orgAnthropicConfigured, setOrgAnthropicConfigured] = useState(false);
  const [orgAnthropicHint, setOrgAnthropicHint] = useState<string | null>(null);
  const [orgOpenaiConfigured, setOrgOpenaiConfigured] = useState(false);
  const [orgOpenaiHint, setOrgOpenaiHint] = useState<string | null>(null);
  const [userByokConfigured, setUserByokConfigured] = useState(false);
  const [userByokHint, setUserByokHint] = useState<string | null>(null);
  const [serverKeyConfigured, setServerKeyConfigured] = useState(false);
  const [blaxelConfigured, setBlaxelConfigured] = useState(false);
  const [byokAvailable, setByokAvailable] = useState(false);
  const [planMode, setPlanMode] = useState(false);
  const [seedContext, setSeedContext] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const needsCursorKey = backend === "cursor" && runtime === "cloud";
  const hasAnthropicAuth =
    Boolean(anthropicApiKey.trim()) ||
    anthropicConfigured ||
    orgAnthropicConfigured;
  const hasOpenaiAuth =
    Boolean(openaiApiKey.trim()) || openaiConfigured || orgOpenaiConfigured;

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void fetchAuthStatus({ orgId: orgId || null })
      .then((s) => {
        if (cancelled) return;
        setAnthropicConfigured(Boolean(s.userAnthropicByokConfigured));
        setAnthropicHint(s.userAnthropicByokHint ?? null);
        setOrgAnthropicConfigured(Boolean(s.orgAnthropicKeyConfigured));
        setOrgAnthropicHint(s.orgAnthropicKeyHint ?? null);
        setOpenaiConfigured(Boolean(s.userOpenaiByokConfigured));
        setOpenaiHint(s.userOpenaiByokHint ?? null);
        setOrgOpenaiConfigured(Boolean(s.orgOpenaiKeyConfigured));
        setOrgOpenaiHint(s.orgOpenaiKeyHint ?? null);
        setUserByokConfigured(Boolean(s.userByokConfigured));
        setUserByokHint(s.userByokHint ?? null);
        setServerKeyConfigured(Boolean(s.serverKeyConfigured));
        setBlaxelConfigured(Boolean(s.blaxelConfigured ?? s.e2bConfigured));
        setByokAvailable(Boolean(s.byokAvailable));
      })
      .catch(() => {
        /* ignore — form still usable */
      });
    return () => {
      cancelled = true;
    };
  }, [open, orgId]);

  useEffect(() => {
    if (!open || runtime !== "local") {
      setScopeWarning("");
      return;
    }
    const trimmed = scopePath.trim();
    if (!trimmed) {
      setScopeWarning("");
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      void validateAgentScope(roomId, trimmed).then((result) => {
        if (cancelled) return;
        setScopeWarning(result.ok ? "" : result.error);
      });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, roomId, runtime, scopePath]);

  if (!open) return null;

  const handleClearAnthropic = async () => {
    try {
      await clearAnthropicByokKey();
      setAnthropicConfigured(false);
      setAnthropicHint(null);
      setAnthropicApiKey("");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to clear Anthropic key",
      );
    }
  };

  const handleClearOpenai = async () => {
    try {
      await clearOpenaiByokKey();
      setOpenaiConfigured(false);
      setOpenaiHint(null);
      setOpenaiApiKey("");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to clear OpenAI key",
      );
    }
  };

  const handleClearByok = async () => {
    try {
      await clearByokKey();
      setUserByokConfigured(false);
      setUserByokHint(null);
      setApiKey("");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to clear Cursor key",
      );
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (runtime === "local" && scopePath.trim()) {
      const check = await validateAgentScope(roomId, scopePath.trim());
      if (!check.ok) {
        setError(check.error);
        return;
      }
    }
    if (backend === "claude-code" && runtime === "cloud" && !hasAnthropicAuth) {
      setError(
        orgId
          ? "Set a shared Anthropic key in Team settings, or paste your key"
          : "Paste your Anthropic API key for Claude Code",
      );
      return;
    }
    if (backend === "codex" && runtime === "cloud" && !hasOpenaiAuth) {
      setError(
        orgId
          ? "Set a shared OpenAI key in Team settings, or paste your key"
          : "Paste your OpenAI API key for Codex",
      );
      return;
    }
    if (needsCursorKey && !apiKey.trim() && !userByokConfigured && !serverKeyConfigured) {
      setError(
        "Paste your Cursor API key (or reuse the one saved from a previous session)",
      );
      return;
    }
    setBusy(true);
    try {
      await onSubmit({
        label: label.trim() || "Agent",
        backend,
        scopePath: scopePath.trim() || undefined,
        modelId: "auto",
        planMode,
        seedContext,
        anthropicApiKey:
          backend === "claude-code" && anthropicApiKey.trim()
            ? anthropicApiKey.trim()
            : undefined,
        openaiApiKey:
          backend === "codex" && openaiApiKey.trim()
            ? openaiApiKey.trim()
            : undefined,
        apiKey:
          backend === "cursor" && apiKey.trim() ? apiKey.trim() : undefined,
      });
      setLabel("");
      setScopePath("");
      setBackend("cursor");
      setPlanMode(false);
      setSeedContext(true);
      setAnthropicApiKey("");
      setOpenaiApiKey("");
      setApiKey("");
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add agent");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 p-3">
      <form
        onSubmit={(e) => void handleSubmit(e)}
        className="w-full max-w-md rounded-lg border border-[#2b2b2b] bg-[#1a1a1a] p-4 shadow-2xl"
      >
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-[14px] font-medium text-[#e4e4e4]">Add agent</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-[#6e6e6e] hover:text-[#e4e4e4] text-[16px]"
          >
            ×
          </button>
        </div>

        <label className="block text-[11px] text-[#6e6e6e] mb-1">Label</label>
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="e.g. backend agent"
          className="w-full h-9 mb-3 px-2.5 rounded-md bg-[#252525] border border-[#2b2b2b] text-[13px] text-[#e4e4e4] outline-none focus:border-[#4d9fff]"
        />

        <label className="block text-[11px] text-[#6e6e6e] mb-1">Backend</label>
        <select
          value={backend}
          onChange={(e) => {
            const next = e.target.value as AgentBackendKind;
            setBackend(next);
            setError("");
          }}
          className="w-full h-9 mb-3 px-2.5 rounded-md bg-[#252525] border border-[#2b2b2b] text-[13px] text-[#e4e4e4] outline-none"
        >
          <option value="cursor">Cursor</option>
          <option value="claude-code">
            Claude Code
            {runtime === "cloud" ? " (Blaxel sandbox)" : " (local CLI)"}
          </option>
          <option value="codex">
            Codex
            {runtime === "cloud" ? " (Blaxel sandbox)" : " (local CLI)"}
          </option>
        </select>
        {isCliSandboxBackend(backend) && (
          <p className="text-[11px] text-[#6e6e6e] mb-3 -mt-1">
            {runtime === "cloud"
              ? blaxelConfigured
                ? `Runs in a Blaxel sandbox. Bring your own ${backend === "codex" ? "OpenAI" : "Anthropic"} API key. Clone, push, and PRs use the GitHub account connected in Settings.`
                : "Server is missing BL_API_KEY / BL_WORKSPACE — cloud CLI agents won’t start until they’re set."
              : `Uses the ${backend === "codex" ? "codex" : "claude"} CLI on the host running steer start.`}
          </p>
        )}
        {backend === "cursor" && runtime === "cloud" && (
          <p className="text-[11px] text-[#6e6e6e] mb-3 -mt-1">
            Uses the Cursor cloud API. You can reuse a Cursor key saved from a
            previous session.
          </p>
        )}

        {needsCursorKey && (
          <>
            <label className="block text-[11px] text-[#6e6e6e] mb-1">
              Cursor API key
            </label>
            {userByokConfigured && !apiKey.trim() ? (
              <p className="text-[11px] text-[#a0a0a0] mb-1">
                Using your saved key {userByokHint} from previous sessions.
                Paste a new key below to replace it.
              </p>
            ) : serverKeyConfigured && !apiKey.trim() && !userByokConfigured ? (
              <p className="text-[11px] text-[#a0a0a0] mb-1">
                Using the server Cursor key. Paste your own key below to use
                BYOK instead.
              </p>
            ) : (
              <p className="text-[11px] text-[#6e6e6e] mb-1">
                {userByokConfigured
                  ? `Replacing saved key ${userByokHint}. Saved to your account for future Cursor agents.`
                  : byokAvailable
                    ? "Saved to your account for future Cursor agents (including in Claude sessions)."
                    : "Paste your Cursor API key (cursor_…)."}
              </p>
            )}
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={
                userByokConfigured
                  ? "Paste new key to replace…"
                  : "cursor_…"
              }
              autoComplete="off"
              className="w-full h-9 mb-1 px-2.5 rounded-md bg-[#252525] border border-[#2b2b2b] text-[13px] text-[#e4e4e4] outline-none focus:border-[#4d9fff]"
            />
            {userByokConfigured && (
              <button
                type="button"
                onClick={() => void handleClearByok()}
                className="text-[11px] text-[#a0a0a0] hover:text-[#f07070] mb-3"
              >
                Clear saved Cursor key
              </button>
            )}
            {!userByokConfigured && <div className="mb-3" />}
          </>
        )}

        {backend === "claude-code" && runtime === "cloud" && (
          <>
            <label className="block text-[11px] text-[#6e6e6e] mb-1">
              Anthropic API key
            </label>
            {orgAnthropicConfigured &&
            !anthropicApiKey.trim() &&
            !anthropicConfigured ? (
              <p className="text-[11px] text-[#a0a0a0] mb-1">
                Using team shared Anthropic key {orgAnthropicHint}. Paste a
                personal key below only to override.
              </p>
            ) : anthropicConfigured && !anthropicApiKey.trim() ? (
              <p className="text-[11px] text-[#a0a0a0] mb-1">
                Using your saved key {anthropicHint}. Paste a new key below to
                replace it.
              </p>
            ) : (
              <p className="text-[11px] text-[#6e6e6e] mb-1">
                {anthropicConfigured
                  ? `Replacing saved key ${anthropicHint}. Saved to your account for future Claude agents.`
                  : orgId && !orgAnthropicConfigured
                    ? "No team Anthropic key — paste one or set it in Team settings."
                    : byokAvailable
                      ? "Saved to your account for future Claude Code agents."
                      : "Paste your Anthropic API key (sk-ant-…)."}
              </p>
            )}
            <input
              type="password"
              value={anthropicApiKey}
              onChange={(e) => setAnthropicApiKey(e.target.value)}
              placeholder={
                hasAnthropicAuth
                  ? "Paste new key to override…"
                  : "sk-ant-…"
              }
              autoComplete="off"
              className="w-full h-9 mb-1 px-2.5 rounded-md bg-[#252525] border border-[#2b2b2b] text-[13px] text-[#e4e4e4] outline-none focus:border-[#4d9fff]"
            />
            {anthropicConfigured && (
              <button
                type="button"
                onClick={() => void handleClearAnthropic()}
                className="text-[11px] text-[#a0a0a0] hover:text-[#f07070] mb-3"
              >
                Clear saved Anthropic key
              </button>
            )}
            {!anthropicConfigured && <div className="mb-3" />}
          </>
        )}

        {backend === "codex" && runtime === "cloud" && (
          <>
            <label className="block text-[11px] text-[#6e6e6e] mb-1">
              OpenAI API key
            </label>
            {orgOpenaiConfigured &&
            !openaiApiKey.trim() &&
            !openaiConfigured ? (
              <p className="text-[11px] text-[#a0a0a0] mb-1">
                Using team shared OpenAI key {orgOpenaiHint}. Paste a
                personal key below only to override.
              </p>
            ) : openaiConfigured && !openaiApiKey.trim() ? (
              <p className="text-[11px] text-[#a0a0a0] mb-1">
                Using your saved key {openaiHint}. Paste a new key below to
                replace it.
              </p>
            ) : (
              <p className="text-[11px] text-[#6e6e6e] mb-1">
                {openaiConfigured
                  ? `Replacing saved key ${openaiHint}. Saved to your account for future Codex agents.`
                  : orgId && !orgOpenaiConfigured
                    ? "No team OpenAI key — paste one or set it in Team settings."
                    : byokAvailable
                      ? "Saved to your account for future Codex agents."
                      : "Paste your OpenAI API key (sk-…)."}
              </p>
            )}
            <input
              type="password"
              value={openaiApiKey}
              onChange={(e) => setOpenaiApiKey(e.target.value)}
              placeholder={
                hasOpenaiAuth ? "Paste new key to override…" : "sk-…"
              }
              autoComplete="off"
              className="w-full h-9 mb-1 px-2.5 rounded-md bg-[#252525] border border-[#2b2b2b] text-[13px] text-[#e4e4e4] outline-none focus:border-[#4d9fff]"
            />
            {openaiConfigured && (
              <button
                type="button"
                onClick={() => void handleClearOpenai()}
                className="text-[11px] text-[#a0a0a0] hover:text-[#f07070] mb-3"
              >
                Clear saved OpenAI key
              </button>
            )}
            {!openaiConfigured && <div className="mb-3" />}
          </>
        )}

        {runtime === "local" && (
          <>
            <label className="block text-[11px] text-[#6e6e6e] mb-1">
              Scope path (optional)
            </label>
            <input
              value={scopePath}
              onChange={(e) => setScopePath(e.target.value)}
              placeholder="e.g. backend/ or frontend/"
              className="w-full h-9 mb-1 px-2.5 rounded-md bg-[#252525] border border-[#2b2b2b] text-[13px] text-[#e4e4e4] outline-none focus:border-[#4d9fff]"
            />
            {scopeWarning && (
              <p className="text-[11px] text-[#f07070] mb-3">{scopeWarning}</p>
            )}
            {!scopeWarning && <div className="mb-3" />}
          </>
        )}

        <p className="text-[11px] text-[#6e6e6e] mb-3">
          Starts on Auto. Pick a model in the room — the latest catalog is
          fetched live.
        </p>

        <label className="block text-[11px] text-[#6e6e6e] mb-1">Mode</label>
        <div className="grid grid-cols-2 gap-2 mb-3">
          <button
            type="button"
            onClick={() => setPlanMode(false)}
            className={`h-9 rounded-md border text-[12px] ${
              !planMode
                ? "border-[#4d9fff] bg-[#252525] text-[#e4e4e4]"
                : "border-[#2b2b2b] bg-[#1a1a1a] text-[#6e6e6e]"
            }`}
          >
            Agent
          </button>
          <button
            type="button"
            onClick={() => setPlanMode(true)}
            className={`h-9 rounded-md border text-[12px] ${
              planMode
                ? "border-[#4d9fff] bg-[#252525] text-[#e4e4e4]"
                : "border-[#2b2b2b] bg-[#1a1a1a] text-[#6e6e6e]"
            }`}
          >
            Plan
          </button>
        </div>

        <label className="flex items-start gap-2 mb-3 text-[12px] text-[#c8c8c8]">
          <input
            type="checkbox"
            checked={seedContext}
            onChange={(e) => setSeedContext(e.target.checked)}
            className="mt-0.5"
          />
          <span>
            Start with repo map + room memory
            <span className="block text-[11px] text-[#6e6e6e] mt-0.5">
              The first run gets a bounded briefing so the agent doesn’t re-explore
              the repo from scratch.
            </span>
          </span>
        </label>

        {error && (
          <p className="text-[12px] text-[#f07070] mb-3">{error}</p>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="h-8 px-3 rounded-md text-[12px] text-[#a0a0a0] hover:text-[#e4e4e4]"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy}
            className="h-8 px-3 rounded-md bg-[#e4e4e4] text-[#141414] text-[12px] font-medium hover:bg-white disabled:opacity-50"
          >
            {busy ? "Adding…" : "Add agent"}
          </button>
        </div>
      </form>
    </div>
  );
}
