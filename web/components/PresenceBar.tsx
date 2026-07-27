"use client";

import type { Participant } from "../../shared/events";

interface PresenceBarProps {
  participants: Participant[];
  mySocketId: string | null;
  /** Current user is the room host (owner). */
  amHost?: boolean;
  onRemoveMember?: (userId: string) => void;
}

export default function PresenceBar({
  participants,
  mySocketId,
  amHost = false,
  onRemoveMember,
}: PresenceBarProps) {
  return (
    <div className="flex items-center -space-x-1.5">
      {participants.map((p) => {
        const canRemove =
          amHost &&
          p.userId &&
          !p.isOwner &&
          p.socketId !== mySocketId &&
          onRemoveMember;

        return (
          <div key={p.socketId} className="relative group">
            <div
              className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-medium text-white border-2 border-[#1a1a1a] ${
                p.isDriver
                  ? "ring-1 ring-[#4d9fff] ring-offset-1 ring-offset-[#1a1a1a]"
                  : ""
              }`}
              style={{ backgroundColor: p.color }}
              title={`${p.name}${p.isOwner ? " · host" : ""}${p.isDriver ? " · driving" : ""}${p.socketId === mySocketId ? " · you" : ""}`}
            >
              {p.name.charAt(0).toUpperCase()}
            </div>
            <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 bg-[#252525] border border-[#3c3c3c] text-[#e4e4e4] px-2 py-1.5 rounded text-[11px] whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none group-hover:pointer-events-auto z-50 shadow-lg">
              <div>
                {p.name}
                {p.isOwner ? " · host" : ""}
                {p.isDriver ? " · driving" : ""}
                {p.socketId === mySocketId ? " · you" : ""}
              </div>
              {canRemove && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemoveMember(p.userId!);
                  }}
                  className="mt-1 w-full text-left text-[#f07070] hover:underline"
                >
                  Remove
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
