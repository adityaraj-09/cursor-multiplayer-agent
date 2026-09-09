"use client";

import { useEffect, useMemo, useState } from "react";
import { Plus, X } from "lucide-react";
import { fetchRooms } from "../../lib/api";
import { MAX_BOARD_ROOMS } from "../../lib/boardStorage";
import { readSelectedWorkspace } from "../../lib/workspace";
import type { RoomInfo } from "../../../shared/events";

export default function BoardAddTile({
  pinnedIds,
  disabled,
  onAdd,
  variant = "header",
}: {
  pinnedIds: string[];
  disabled?: boolean;
  onAdd: (id: string) => void;
  /** header = compact toolbar control; empty = centered empty-state CTA */
  variant?: "header" | "empty";
}) {
  const [open, setOpen] = useState(false);
  const [rooms, setRooms] = useState<RoomInfo[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    const orgId = readSelectedWorkspace();
    fetchRooms({ orgId: orgId === "personal" ? "personal" : orgId })
      .then((list) => {
        if (!cancelled) setRooms(list);
      })
      .catch(console.error)
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const available = useMemo(
    () => rooms.filter((room) => !pinnedIds.includes(room.id)),
    [rooms, pinnedIds],
  );

  const trigger =
    variant === "empty" ? (
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
        className="mx-auto flex min-h-[180px] w-full max-w-sm flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-[#2b2b2b] bg-[#151515] px-6 text-[#6e6e6e] transition-colors hover:border-[#3c3c3c] hover:text-[#e4e4e4] disabled:opacity-40"
      >
        <Plus className="h-6 w-6" strokeWidth={1.75} />
        <span className="text-[13px]">Add session</span>
        <span className="text-[11px] text-[#6e6e6e]">
          {disabled
            ? `Board is full (${MAX_BOARD_ROOMS})`
            : "Pin a room to the board"}
        </span>
      </button>
    ) : (
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
        className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[#2b2b2b] bg-[#1f1f1f] px-2.5 text-[12px] text-[#a0a0a0] hover:border-[#3c3c3c] hover:text-[#e4e4e4] disabled:opacity-40"
        title={
          disabled
            ? `Board is full (${MAX_BOARD_ROOMS})`
            : "Add session to board"
        }
      >
        <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
        Add session
      </button>
    );

  return (
    <>
      {trigger}

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/55 px-0 sm:px-4"
          onClick={() => setOpen(false)}
          role="presentation"
        >
          <div
            className="w-full sm:max-w-md bg-[#1a1a1a] border border-[#2b2b2b] sm:rounded-lg rounded-t-lg shadow-xl max-h-[80dvh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="Add session to board"
          >
            <div className="flex items-center justify-between px-4 h-11 border-b border-[#2b2b2b]">
              <h2 className="text-[14px] font-medium text-[#e4e4e4]">
                Add to board
              </h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="h-7 w-7 inline-flex items-center justify-center rounded-md text-[#a0a0a0] hover:text-[#e4e4e4]"
                aria-label="Close"
              >
                <X className="h-4 w-4" strokeWidth={1.75} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
              {loading ? (
                <p className="text-[12px] text-[#6e6e6e] px-1 py-6 text-center">
                  Loading sessions…
                </p>
              ) : available.length === 0 ? (
                <p className="text-[12px] text-[#6e6e6e] px-1 py-6 text-center">
                  No other sessions in this workspace.
                </p>
              ) : (
                available.map((room) => (
                  <button
                    key={room.id}
                    type="button"
                    onClick={() => {
                      onAdd(room.id);
                      setOpen(false);
                    }}
                    className="w-full text-left rounded-md border border-[#2b2b2b] bg-[#141414] px-3 py-2.5 hover:border-[#3c3c3c]"
                  >
                    <p className="text-[13px] text-[#e4e4e4] truncate">
                      {room.name}
                    </p>
                    <p className="text-[11px] text-[#6e6e6e]">
                      {room.status === "active" ? "Live" : "Stopped"}
                      {room.participantCount
                        ? ` · ${room.participantCount} online`
                        : ""}
                    </p>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
