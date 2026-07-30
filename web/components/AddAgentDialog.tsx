"use client";

import { useState } from "react";
import type { ModelInfo } from "../../shared/events";

interface AddAgentDialogProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (data: {
    label: string;
    backend: "cursor" | "claude-code";
    scopePath?: string;
    modelId?: string;
  }) => Promise<void>;
  models: ModelInfo[];
  defaultModelId?: string;
  runtime: "local" | "cloud";
}

export default function AddAgentDialog({
  open,
  onClose,
  onSubmit,
  models,
  defaultModelId,
  runtime,
}: AddAgentDialogProps) {
  const [label, setLabel] = useState("");
  const [backend, setBackend] = useState<"cursor" | "claude-code">("cursor");
  const [scopePath, setScopePath] = useState("");
  const [modelId, setModelId] = useState(defaultModelId || "auto");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await onSubmit({
        label: label.trim() || "Agent",
        backend,
        scopePath: scopePath.trim() || undefined,
        modelId,
      });
      setLabel("");
      setScopePath("");
      setBackend("cursor");
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
          onChange={(e) =>
            setBackend(e.target.value as "cursor" | "claude-code")
          }
          className="w-full h-9 mb-3 px-2.5 rounded-md bg-[#252525] border border-[#2b2b2b] text-[13px] text-[#e4e4e4] outline-none"
        >
          <option value="cursor">Cursor</option>
          <option value="claude-code" disabled>
            Claude Code (coming soon)
          </option>
        </select>

        {runtime === "local" && (
          <>
            <label className="block text-[11px] text-[#6e6e6e] mb-1">
              Scope path (optional)
            </label>
            <input
              value={scopePath}
              onChange={(e) => setScopePath(e.target.value)}
              placeholder="e.g. backend/ or frontend/"
              className="w-full h-9 mb-3 px-2.5 rounded-md bg-[#252525] border border-[#2b2b2b] text-[13px] text-[#e4e4e4] outline-none focus:border-[#4d9fff]"
            />
          </>
        )}

        <label className="block text-[11px] text-[#6e6e6e] mb-1">Model</label>
        <select
          value={modelId}
          onChange={(e) => setModelId(e.target.value)}
          className="w-full h-9 mb-3 px-2.5 rounded-md bg-[#252525] border border-[#2b2b2b] text-[13px] text-[#e4e4e4] outline-none"
        >
          {(models.length ? models : [{ id: "auto", displayName: "Auto" }]).map(
            (m) => (
              <option key={m.id} value={m.id}>
                {m.displayName}
              </option>
            ),
          )}
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
