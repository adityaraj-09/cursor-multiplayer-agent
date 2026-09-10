"use client";

import { useState } from "react";
import { KeyRound } from "lucide-react";
import {
  clearAnthropicByokKey,
  clearByokKey,
  clearOrgAnthropicKey,
  clearOrgCursorKey,
  setAnthropicByokKey,
  setByokKey,
  setOrgAnthropicKey,
  setOrgCursorKey,
  type WorkspaceKeyInfo,
} from "../../lib/api";

export default function WorkspaceKeysCard({
  orgId,
  keys,
  onChange,
}: {
  orgId?: string;
  keys: WorkspaceKeyInfo[];
  onChange: (next: WorkspaceKeyInfo[]) => void;
}) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");

  const updateKey = (id: string, patch: Partial<WorkspaceKeyInfo>) => {
    onChange(keys.map((key) => (key.id === id ? { ...key, ...patch } : key)));
  };

  const save = async (key: WorkspaceKeyInfo) => {
    const value = (drafts[key.id] || "").trim();
    if (!value) return;
    setBusyId(key.id);
    setError("");
    try {
      if (key.id === "user-cursor") {
        const result = await setByokKey(value);
        updateKey(key.id, {
          configured: result.userByokConfigured,
          hint: result.userByokHint,
        });
      } else if (key.id === "user-anthropic") {
        const result = await setAnthropicByokKey(value);
        updateKey(key.id, {
          configured: result.userAnthropicByokConfigured,
          hint: result.userAnthropicByokHint,
        });
      } else if (key.id === "org-cursor" && orgId) {
        const result = await setOrgCursorKey(orgId, value);
        updateKey(key.id, {
          configured: result.cursorKeyConfigured,
          hint: result.cursorKeyHint,
        });
      } else if (key.id === "org-anthropic" && orgId) {
        const result = await setOrgAnthropicKey(orgId, value);
        updateKey(key.id, {
          configured: result.anthropicKeyConfigured,
          hint: result.anthropicKeyHint,
        });
      }
      setDrafts((prev) => ({ ...prev, [key.id]: "" }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save key");
    } finally {
      setBusyId("");
    }
  };

  const clear = async (key: WorkspaceKeyInfo) => {
    if (!window.confirm(`Remove the ${key.label} key?`)) return;
    setBusyId(key.id);
    setError("");
    try {
      if (key.id === "user-cursor") await clearByokKey();
      else if (key.id === "user-anthropic") await clearAnthropicByokKey();
      else if (key.id === "org-cursor" && orgId) await clearOrgCursorKey(orgId);
      else if (key.id === "org-anthropic" && orgId) {
        await clearOrgAnthropicKey(orgId);
      }
      updateKey(key.id, { configured: false, hint: null });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to clear key");
    } finally {
      setBusyId("");
    }
  };

  return (
    <section className="rounded-xl border border-[#2b2b2b] bg-[#1a1a1a] p-5">
      <div className="flex items-start gap-3 mb-4">
        <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-lg bg-[#252525] text-[#e4e4e4]">
          <KeyRound className="h-4 w-4" strokeWidth={1.75} />
        </div>
        <div>
          <h2 className="text-[15px] font-medium text-[#e4e4e4]">API keys</h2>
          <p className="text-[12px] text-[#6e6e6e] mt-0.5">
            Keys added for this workspace. Team keys are shared; your personal
            keys stay on your account and are listed here too.
          </p>
        </div>
      </div>

      <ul className="space-y-3">
        {keys.map((key) => (
          <li
            key={key.id}
            className="rounded-lg border border-[#2b2b2b] bg-[#141414] p-3"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-[13px] text-[#e4e4e4]">{key.label}</p>
                  <span className="text-[10px] uppercase tracking-wide text-[#6e6e6e] border border-[#2b2b2b] rounded px-1.5 py-0.5">
                    {key.owner === "team" ? "Team" : "Personal"}
                  </span>
                </div>
                <p className="text-[12px] text-[#a0a0a0] mt-0.5">
                  {key.configured
                    ? `Configured ${key.hint || ""}`
                    : "Not added yet"}
                </p>
              </div>
              <span
                className={`text-[11px] ${
                  key.configured ? "text-[#3ecf8e]" : "text-[#6e6e6e]"
                }`}
              >
                {key.configured ? "Added" : "Missing"}
              </span>
            </div>
            {key.canManage && (
              <div className="mt-3 flex flex-col sm:flex-row gap-2">
                <input
                  type="password"
                  value={drafts[key.id] || ""}
                  onChange={(e) =>
                    setDrafts((prev) => ({ ...prev, [key.id]: e.target.value }))
                  }
                  placeholder={
                    key.configured
                      ? "Replace key…"
                      : key.provider === "cursor"
                        ? "cursor_…"
                        : "sk-ant-…"
                  }
                  className="flex-1 h-9 px-2.5 rounded-md bg-[#252525] border border-[#2b2b2b] text-[13px] text-[#e4e4e4] font-mono outline-none focus:border-[#4d9fff]"
                  autoComplete="off"
                />
                <button
                  type="button"
                  disabled={busyId === key.id || !(drafts[key.id] || "").trim()}
                  onClick={() => void save(key)}
                  className="h-9 px-3 rounded-md bg-[#e4e4e4] text-[#141414] text-[12px] font-medium disabled:opacity-50"
                >
                  {busyId === key.id ? "Saving…" : key.configured ? "Replace" : "Add"}
                </button>
                {key.configured && (
                  <button
                    type="button"
                    disabled={busyId === key.id}
                    onClick={() => void clear(key)}
                    className="h-9 px-3 rounded-md border border-[#2b2b2b] text-[12px] text-[#a0a0a0] hover:text-[#f07070] disabled:opacity-50"
                  >
                    Clear
                  </button>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
      {error && <p className="text-[12px] text-[#f07070] mt-3">{error}</p>}
    </section>
  );
}
