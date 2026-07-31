"use client";

import { useEffect, useState } from "react";
import type { ModelInfo } from "../../shared/events";
import {
  clearAnthropicByokKey,
  fetchAuthStatus,
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
  }) => Promise<void>;
  models: ModelInfo[];
  defaultModelId?: string;
  runtime: "local" | "cloud";
}

export default function AddAgentDialog({
  open,
  onClose,
  roomId,
  onSubmit,
  models,
  defaultModelId,
  runtime,
}: AddAgentDialogProps) {
  const [label, setLabel] = useState("");
  const [backend, setBackend] = useState<"cursor" | "claude-code">("cursor");
  const [scopePath, setScopePath] = useState("");
  const [scopeWarning, setScopeWarning] = useState("");
  const [modelId, setModelId] = useState(defaultModelId || "auto");
  const [anthropicApiKey, setAnthropicApiKey] = useState("");
  const [anthropicConfigured, setAnthropicConfigured] = useState(false);
  const [anthropicHint, setAnthropicHint] = useState<string | null>(null);
  const [e2bConfigured, setE2bConfigured] = useState(false);
  const [byokAvailable, setByokAvailable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void fetchAuthStatus()
      .then((s) => {
        if (cancelled) return;
        setAnthropicConfigured(Boolean(s.userAnthropicByokConfigured));
        setAnthropicHint(s.userAnthropicByokHint ?? null);
        setE2bConfigured(Boolean(s.e2bConfigured));
        setByokAvailable(Boolean(s.byokAvailable));
      })
      .catch(() => {
        /* ignore — form still usable */
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

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
    if (
      backend === "claude-code" &&
      runtime === "cloud" &&
      !anthropicApiKey.trim() &&
      !anthropicConfigured
    ) {
      setError("Paste your Anthropic API key for Claude Code");
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
      });
      setLabel("");
      setScopePath("");
      setBackend("cursor");
      setAnthropicApiKey("");
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
            const next = e.target.value as "cursor" | "claude-code";
            setBackend(next);
            if (next === "claude-code" && (!modelId || modelId === "auto")) {
              setModelId("sonnet");
            }
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

        {backend === "claude-code" && runtime === "cloud" && (
          <>
            <label className="block text-[11px] text-[#6e6e6e] mb-1">
              Anthropic API key
            </label>
            {anthropicConfigured && !anthropicApiKey.trim() ? (
              <p className="text-[11px] text-[#a0a0a0] mb-1">
                Using your saved key {anthropicHint}. Paste a new key below to
                replace it.
              </p>
            ) : (
              <p className="text-[11px] text-[#6e6e6e] mb-1">
                {anthropicConfigured
                  ? `Replacing saved key ${anthropicHint}. Saved to your account for future Claude agents.`
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
                anthropicConfigured
                  ? "Paste new key to replace…"
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

        <label className="block text-[11px] text-[#6e6e6e] mb-1">Model</label>
        <select
          value={modelId}
          onChange={(e) => setModelId(e.target.value)}
          className="w-full h-9 mb-3 px-2.5 rounded-md bg-[#252525] border border-[#2b2b2b] text-[13px] text-[#e4e4e4] outline-none"
        >
          {(backend === "claude-code"
            ? [
                { id: "sonnet", displayName: "Sonnet" },
                { id: "opus", displayName: "Opus" },
                { id: "haiku", displayName: "Haiku" },
                { id: "fable", displayName: "Fable" },
              ]
            : models.length
              ? models
              : [{ id: "auto", displayName: "Auto" }]
          ).map((m) => (
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
