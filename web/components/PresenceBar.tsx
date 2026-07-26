"use client";

import type { Participant } from "../../shared/events";

interface PresenceBarProps {
  participants: Participant[];
  mySocketId: string | null;
}

export default function PresenceBar({
  participants,
  mySocketId,
}: PresenceBarProps) {
  return (
    <div className="flex items-center -space-x-1.5">
      {participants.map((p) => (
        <div key={p.socketId} className="relative group">
          <div
            className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-medium text-white border-2 border-[#1a1a1a] ${
              p.isDriver ? "ring-1 ring-[#4d9fff] ring-offset-1 ring-offset-[#1a1a1a]" : ""
            }`}
            style={{ backgroundColor: p.color }}
            title={`${p.name}${p.isDriver ? " · driving" : ""}${p.socketId === mySocketId ? " · you" : ""}`}
          >
            {p.name.charAt(0).toUpperCase()}
          </div>
          <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 bg-[#252525] border border-[#3c3c3c] text-[#e4e4e4] px-2 py-1 rounded text-[11px] whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50 shadow-lg">
            {p.name}
            {p.isDriver ? " · driving" : ""}
            {p.socketId === mySocketId ? " · you" : ""}
          </div>
        </div>
      ))}
    </div>
  );
}
