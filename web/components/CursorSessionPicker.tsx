"use client";

import { useEffect, useState } from "react";
import type { CursorChatSession } from "../../shared/events";
import { fetchCursorSessions } from "../lib/api";

interface CursorSessionPickerProps {
  roomId: string;
  repoPath: string;
  /** Cursor chat this Steer room last used — resume target. */
  cursorSessionId?: string | null;
  disabled?: boolean;
  canChange?: boolean;
  onSessionChange: (sessionId: string | null) => void;
}

export default function CursorSessionPicker({
  roomId,
  repoPath,
  cursorSessionId,
  disabled = false,
  canChange = false,
  onSessionChange,
}: CursorSessionPickerProps) {
  const [sessions, setSessions] = useState<CursorChatSession[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    if (!repoPath.trim()) {
      setSessions([]);
      return;
    }

    setLoading(true);
    setError("");
    fetchCursorSessions(repoPath.trim())
      .then((list) => {
        if (!cancelled) setSessions(list);
      })
      .catch((err) => {
        if (!cancelled) {
          setSessions([]);
          setError(
            err instanceof Error ? err.message : "Failed to load Cursor chats",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [repoPath, roomId]);

  const activeId = cursorSessionId || "";
  const hasOrphan =
    Boolean(activeId) && !sessions.some((s) => s.id === activeId);

  return (
    <div className="flex items-center gap-2 min-w-0 flex-1 sm:flex-none">
      <label className="text-[11px] text-[#6e6e6e] shrink-0">Cursor chat</label>
      {loading ? (
        <span className="text-[11px] text-[#6e6e6e]">Loading…</span>
      ) : error ? (
        <span className="text-[11px] text-[#f07070] truncate" title={error}>
          Unavailable
        </span>
      ) : (
        <select
          value={activeId}
          onChange={(e) => {
            const v = e.target.value;
            onSessionChange(v ? v : null);
          }}
          disabled={disabled || !canChange}
          className="min-w-0 flex-1 sm:max-w-[min(100%,320px)] h-8 sm:h-7 px-2 rounded-md bg-[#252525] border border-[#2b2b2b] text-[12px] text-[#e4e4e4] outline-none focus:border-[#4d9fff] disabled:opacity-40"
        >
          <option value="">New chat (next message)</option>
          {hasOrphan && activeId && (
            <option value={activeId}>
              Active · {activeId.slice(0, 8)}…
            </option>
          )}
          {sessions.map((s) => (
            <option key={s.id} value={s.id}>
              {formatLabel(s, s.id === activeId)}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

function formatLabel(session: CursorChatSession, isActive: boolean): string {
  const when = new Date(session.updatedAt).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  const prefix = isActive ? "Active · " : "";
  const empty = session.hasConversation ? "" : " · empty";
  return `${prefix}${when} · ${session.id.slice(0, 8)}${empty}`;
}
