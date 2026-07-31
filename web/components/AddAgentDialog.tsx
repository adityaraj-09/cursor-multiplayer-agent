"use client";

import { useEffect, useState } from "react";
import type { ModelInfo } from "../../shared/events";
import {
  CLAUDE_MODELS,
  DEFAULT_CLAUDE_MODEL,
  isClaudeModelId,
} from "../../shared/claudeModels";
import {
  clearAnthropicByokKey,
  clearByokKey,
  fetchAuthStatus,
  fetchModels,
  validateAgentScope,
} from "../lib/api";

interface AddAgentDialogProps {
  open: boolean;
  onClose: () => void;
  roomId: string;
  onSubmit: (data: {
    label: string;
    backend: "cursor" | "claude-code";
    scopePath?: string;
    modelId?: string;
    anthropicApiKey?: string;
    apiKey?: string;
  }) => Promise<void>;
  /** Fallback Cursor models from the room page (may be Claude models if a Claude agent is selected). */
  models: ModelInfo[];
  defaultModelId?: string;
  runtime: "local" | "cloud";
  /** When set, Claude cloud can reuse the org shared Anthropic key. */
  orgId?: string;
}

export default function AddAgentDialog({
  open,
  onClose,
  roomId,
  onSubmit,
  models,
  defaultModelId,
  runtime,
  orgId,
}: AddAgentDialogProps) {
  const [label, setLabel] = useState("");
  const [backend, setBackend] = useState<"cursor" | "claude-code">("cursor");
  const [scopePath, setScopePath] = useState("");
  const [scopeWarning, setScopeWarning] = useState("");
  const [modelId, setModelId] = useState("auto");
  const [cursorModels, setCursorModels] = useState<ModelInfo[]>([]);
  const [loadingCursorModels, setLoadingCursorModels] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [anthropicApiKey, setAnthropicApiKey] = useState("");
  const [anthropicConfigured, setAnthropicConfigured] = useState(false);
  const [anthropicHint, setAnthropicHint] = useState<string | null>(null);
  const [orgAnthropicConfigured, setOrgAnthropicConfigured] = useState(false);
  const [orgAnthropicHint, setOrgAnthropicHint] = useState<string | null>(null);
  const [userByokConfigured, setUserByokConfigured] = useState(false);
  const [userByokHint, setUserByokHint] = useState<string | null>(null);
  const [serverKeyConfigured, setServerKeyConfigured] = useState(false);
  const [e2bConfigured, setE2bConfigured] = useState(false);
  const [byokAvailable, setByokAvailable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const needsCursorKey = backend === "cursor" && runtime === "cloud";
  const hasCursorAuth =
    Boolean(apiKey.trim()) || userByokConfigured || serverKeyConfigured;
  const hasAnthropicAuth =
    Boolean(anthropicApiKey.trim()) ||
    anthropicConfigured ||
    orgAnthropicConfigured;

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
        setUserByokConfigured(Boolean(s.userByokConfigured));
        setUserByokHint(s.userByokHint ?? null);
        setServerKeyConfigured(Boolean(s.serverKeyConfigured));
        setE2bConfigured(Boolean(s.e2bConfigured));
        setByokAvailable(Boolean(s.byokAvailable));
      })
      .catch(() => {
        /* ignore — form still usable */
      });
    return () => {
      cancelled = true;
    };
  }, [open, orgId]);

  // Reset model when the dialog opens or backend changes.
  useEffect(() => {
    if (!open) return;
    if (backend === "claude-code") {
      setModelId(
        defaultModelId && isClaudeModelId(defaultModelId)
          ? defaultModelId
          : DEFAULT_CLAUDE_MODEL,
      );
    } else {
      const fallback =
        defaultModelId && !isClaudeModelId(defaultModelId)
          ? defaultModelId
          : "auto";
      setModelId(fallback);
    }
  }, [open, backend, defaultModelId]);

  // Load Cursor models from the Cursor API (BYOK / server), not the room's
  // currently-selected agent models (which may be Claude aliases).
  useEffect(() => {
    if (!open || backend !== "cursor") return;
    let cancelled = false;

    const roomLooksLikeCursor =
      models.length > 0 && !models.every((m) => isClaudeModelId(m.id));
    if (roomLooksLikeCursor) {
      setCursorModels(models);
    }

    if (runtime === "local") {
      // Local CLI rooms list models via the room endpoint; keep prop/fallback.
      if (!roomLooksLikeCursor) {
        setCursorModels([{ id: "auto", displayName: "Auto" }]);
      }
      return;
    }

    if (!hasCursorAuth && !apiKey.trim()) {
      if (!roomLooksLikeCursor) {
        setCursorModels([{ id: "auto", displayName: "Auto" }]);
      }
      return;
    }

    setLoadingCursorModels(true);
    const authMode =
      apiKey.trim() || userByokConfigured ? "byok" : "server";
    void fetchModels({
      authMode,
      apiKey: apiKey.trim() || undefined,
    })
      .then((list) => {
        if (cancelled || !list.length) return;
        setCursorModels(list);
        setModelId((prev) =>
          list.some((m) => m.id === prev) ? prev : list[0]?.id || "auto",
        );
      })
      .catch(() => {
        if (cancelled) return;
        if (!roomLooksLikeCursor) {
          setCursorModels([{ id: "auto", displayName: "Auto" }]);
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingCursorModels(false);
      });

    return () => {
      cancelled = true;
    };
  }, [
    open,
    backend,
    runtime,
    apiKey,
    userByokConfigured,
    serverKeyConfigured,
    hasCursorAuth,
    models,
  ]);

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
        modelId,
        anthropicApiKey:
          backend === "claude-code" && anthropicApiKey.trim()
            ? anthropicApiKey.trim()
            : undefined,
        apiKey:
          backend === "cursor" && apiKey.trim() ? apiKey.trim() : undefined,
      });
      setLabel("");
      setScopePath("");
      setBackend("cursor");
      setAnthropicApiKey("");
      setApiKey("");
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add agent");
    } finally {
      setBusy(false);
    }
  };

  const modelOptions =
    backend === "claude-code"
      ? CLAUDE_MODELS
      : cursorModels.length
        ? cursorModels
        : models.length && !models.every((m) => isClaudeModelId(m.id))
          ? models
          : [{ id: "auto", displayName: "Auto" }];

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
            const next = e.target.value as "cursor" | "claude-code";
            setBackend(next);
            setError("");
          }}
          className="w-full h-9 mb-3 px-2.5 rounded-md bg-[#252525] border border-[#2b2b2b] text-[13px] text-[#e4e4e4] outline-none"
        >
          <option value="cursor">Cursor</option>
          <option value="claude-code">
            Claude Code
            {runtime === "cloud" ? " (E2B sandbox)" : " (local CLI)"}
          </option>
        </select>
        {backend === "claude-code" && (
          <p className="text-[11px] text-[#6e6e6e] mb-3 -mt-1">
            {runtime === "cloud"
              ? e2bConfigured
                ? "Runs in an E2B sandbox. Bring your own Anthropic API key."
                : "Server is missing E2B_API_KEY — Claude Code cloud won’t start until it’s set."
              : "Uses the claude CLI on the host running steer start."}
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

        <label className="block text-[11px] text-[#6e6e6e] mb-1">
          Model
          {backend === "cursor" && loadingCursorModels ? " (loading…)" : ""}
        </label>
        <select
          value={modelId}
          onChange={(e) => setModelId(e.target.value)}
          className="w-full h-9 mb-3 px-2.5 rounded-md bg-[#252525] border border-[#2b2b2b] text-[13px] text-[#e4e4e4] outline-none"
        >
          {modelOptions.map((m) => (
            <option key={m.id} value={m.id}>
              {m.displayName}
            </option>
          ))}
        </select>

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
