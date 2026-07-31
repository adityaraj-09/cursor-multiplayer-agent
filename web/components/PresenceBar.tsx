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
  const visible = participants.slice(0, 5);
  const overflow = participants.length - visible.length;

  return (
    <div className="flex items-center -space-x-1.5">
      {visible.map((p) => {
        const canRemove =
          amHost &&
          p.userId &&
          !p.isOwner &&
          p.socketId !== mySocketId &&
          onRemoveMember;

        return (
          <div key={p.socketId} className="relative group">
            <div
              className={`w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-semibold text-white border-2 border-[#171717] shadow-sm ${
                p.isDriver
                  ? "ring-1 ring-[#4d9fff] ring-offset-1 ring-offset-[#171717]"
                  : ""
              }`}
              style={{ backgroundColor: p.color }}
              title={`${p.name}${p.isOwner ? " · host" : ""}${
                p.drivingAgentIds?.length
                  ? ` · driving ${p.drivingAgentIds.length} agent(s)`
                  : p.isDriver
                    ? " · driving"
                    : ""
              }${p.socketId === mySocketId ? " · you" : ""}`}
            >
              {p.name.charAt(0).toUpperCase()}
            </div>
            <div className="absolute top-full right-0 sm:left-1/2 sm:-translate-x-1/2 sm:right-auto mt-2 bg-[#202020] border border-[#3c3c3c] text-[#e4e4e4] px-2.5 py-2 rounded-lg text-[11px] whitespace-nowrap opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity pointer-events-none group-hover:pointer-events-auto z-50 shadow-xl">
              <div>
                {p.name}
                {p.isOwner ? " · host" : ""}
                {p.drivingAgentIds?.length
                  ? ` · driving ${p.drivingAgentIds.length}`
                  : p.isDriver
                    ? " · driving"
                    : ""}
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
      {overflow > 0 && (
        <div
          className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-medium text-[#a0a0a0] bg-[#252525] border-2 border-[#171717]"
          title={`${overflow} more`}
        >
          +{overflow}
        </div>
      )}
    </div>
  );
}
