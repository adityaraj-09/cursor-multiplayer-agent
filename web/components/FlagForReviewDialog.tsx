"use client";

import { useEffect, useMemo, useState } from "react";
import type { RoomMemberInfo } from "../../shared/events";

export default function FlagForReviewDialog({
  open,
  onClose,
  members,
  myUserId,
  slackConfigured,
  onFlag,
  onOpenSlack,
}: {
  open: boolean;
  onClose: () => void;
  members: RoomMemberInfo[];
  myUserId?: string;
  slackConfigured: boolean;
  onFlag: (payload: { note?: string; targetUserIds?: string[] }) => void;
  onOpenSlack: () => void;
}) {
  const [note, setNote] = useState("");
  const [audience, setAudience] = useState<"everyone" | "selected">("everyone");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const selectable = useMemo(
    () => members.filter((m) => m.userId !== myUserId),
    [members, myUserId],
  );

  useEffect(() => {
    if (!open) return;
    setNote("");
    setAudience("everyone");
    setSelected(new Set());
    setError("");
    setSubmitting(false);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const toggle = (userId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  };

  const handleSubmit = () => {
    setError("");
    if (audience === "selected" && selected.size === 0) {
      setError("Select at least one member, or choose everyone.");
      return;
    }
    setSubmitting(true);
    onFlag({
      note: note.trim() || undefined,
      targetUserIds:
        audience === "selected" ? [...selected] : undefined,
    });
    setSubmitting(false);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/55 px-0 sm:px-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="w-full sm:max-w-md bg-[#1a1a1a] border border-[#2b2b2b] sm:rounded-lg rounded-t-lg shadow-xl max-h-[85dvh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Flag for review"
      >
        <div className="flex items-center justify-between px-4 h-11 border-b border-[#2b2b2b] shrink-0">
          <h2 className="text-[14px] font-medium text-[#e4e4e4]">
            Flag for review
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="h-7 px-2 rounded-md text-[12px] text-[#a0a0a0] hover:text-[#e4e4e4] border border-transparent hover:border-[#2b2b2b]"
          >
            Close
          </button>
        </div>

        <div className="px-4 py-3 space-y-3 overflow-y-auto min-h-0">
          <p className="text-[12px] text-[#6e6e6e]">
            Interrupt the room and optionally notify Slack. Teammates can open
            the link to acknowledge.
          </p>

          {!slackConfigured && (
            <div className="rounded-md border border-[#3a3420] bg-[#16140f] px-3 py-2">
              <p className="text-[12px] text-[#c9a227]">
                Slack isn’t set up yet. Open Settings to connect a webhook.
                In-room ping still works.
              </p>
              <button
                type="button"
                onClick={onOpenSlack}
                className="mt-1.5 text-[12px] text-[#8ec5ff] hover:underline"
              >
                Open room settings
              </button>
            </div>
          )}

          <label className="block">
            <span className="text-[11px] text-[#a0a0a0]">Note (optional)</span>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              maxLength={2000}
              placeholder="What needs eyes?"
              className="mt-1 w-full px-3 py-2 bg-[#252525] border border-[#2b2b2b] rounded-md text-[13px] text-[#e4e4e4] placeholder:text-[#6e6e6e] outline-none focus:border-[#4d9fff] resize-none"
            />
          </label>

          <div className="space-y-2">
            <span className="text-[11px] text-[#a0a0a0]">Audience</span>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setAudience("everyone")}
                className={`rounded-md border px-3 py-2 text-left transition-colors ${
                  audience === "everyone"
                    ? "border-[#4d9fff] bg-[#1a2330]"
                    : "border-[#2b2b2b] bg-[#141414] hover:border-[#3c3c3c]"
                }`}
              >
                <div className="text-[12px] font-medium text-[#e4e4e4]">
                  Everyone
                </div>
                <div className="text-[11px] text-[#6e6e6e] mt-0.5">
                  All room members
                </div>
              </button>
              <button
                type="button"
                onClick={() => setAudience("selected")}
                className={`rounded-md border px-3 py-2 text-left transition-colors ${
                  audience === "selected"
                    ? "border-[#4d9fff] bg-[#1a2330]"
                    : "border-[#2b2b2b] bg-[#141414] hover:border-[#3c3c3c]"
                }`}
              >
                <div className="text-[12px] font-medium text-[#e4e4e4]">
                  Selected
                </div>
                <div className="text-[11px] text-[#6e6e6e] mt-0.5">
                  Pick members
                </div>
              </button>
            </div>
          </div>

          {audience === "selected" && (
            <ul className="max-h-40 overflow-y-auto space-y-1 rounded-md border border-[#2b2b2b] bg-[#141414] p-2">
              {selectable.length === 0 ? (
                <li className="text-[12px] text-[#6e6e6e] px-1 py-1">
                  No other members in this room yet.
                </li>
              ) : (
                selectable.map((m) => (
                  <li key={m.userId}>
                    <label className="flex items-center gap-2 px-1.5 py-1.5 rounded hover:bg-[#1f1f1f] cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selected.has(m.userId)}
                        onChange={() => toggle(m.userId)}
                        className="accent-[#4d9fff]"
                      />
                      <span className="text-[13px] text-[#e4e4e4] truncate">
                        {m.name}
                      </span>
                      <span className="text-[11px] text-[#6e6e6e] ml-auto shrink-0">
                        {m.role}
                      </span>
                    </label>
                  </li>
                ))
              )}
            </ul>
          )}

          {error && <p className="text-[12px] text-[#f07070]">{error}</p>}
        </div>

        <div className="px-4 py-3 border-t border-[#2b2b2b] flex justify-end gap-2 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="h-9 px-3 rounded-md text-[12px] text-[#a0a0a0] border border-[#2b2b2b] hover:text-[#e4e4e4]"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={submitting}
            onClick={handleSubmit}
            className="h-9 px-3 rounded-md bg-[#e4e4e4] text-[#141414] text-[12px] font-medium hover:bg-white disabled:opacity-40"
          >
            {submitting ? "Sending…" : "Flag for review"}
          </button>
        </div>
      </div>
    </div>
  );
}
