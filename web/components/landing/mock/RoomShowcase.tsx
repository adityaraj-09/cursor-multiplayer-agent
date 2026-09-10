"use client";

import { useState } from "react";
import DemoChatTimeline from "./DemoChatTimeline";
import { DEMO_BOARD } from "./demo-chat";

const ROOM = DEMO_BOARD[0];

export default function RoomShowcase() {
  const [agentId, setAgentId] = useState<string | null>(null);
  const selected =
    ROOM.agents.find((agent) => agent.id === agentId) || ROOM.agents[0];

  return (
    <div className="flex min-h-[480px] flex-col overflow-hidden rounded-[18px] border border-[#2b2b2b] bg-[#141414] shadow-[0_30px_80px_rgba(0,0,0,0.45)]">
      <div className="flex items-center justify-between border-b border-[#2b2b2b] bg-[#171717] px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full bg-[#3ecf8e]" />
          <span className="text-[13px] font-medium text-[#e4e4e4]">{ROOM.name}</span>
          <span className="text-[11px] text-[#6e6e6e]">kinetic/rider-ios</span>
        </div>
        <div className="flex items-center gap-1.5">
          {["J", "M", "A"].map((initial) => (
            <span
              key={initial}
              className="flex h-5 w-5 items-center justify-center rounded-full bg-[#252525] text-[9px] text-[#e4e4e4]"
            >
              {initial}
            </span>
          ))}
        </div>
      </div>
      <div className="flex gap-1 border-b border-[#2b2b2b] bg-[#171717] px-2 py-1.5">
        {ROOM.agents.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setAgentId(item.id)}
            className={`inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[12px] ${
              agentId === item.id
                ? "bg-[#252525] text-[#e4e4e4]"
                : "text-[#6e6e6e] hover:text-[#e4e4e4]"
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                item.running ? "bg-[#3ecf8e] animate-pulse" : "bg-[#6e6e6e]"
              }`}
            />
            {item.label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setAgentId(null)}
          className={`h-7 rounded-md px-2.5 text-[12px] ${
            agentId === null ? "bg-[#252525] text-[#e4e4e4]" : "text-[#6e6e6e]"
          }`}
        >
          All
        </button>
        <span className="ml-auto text-[11px] leading-7 text-[#6e6e6e]">
          Driver Maya · {selected.model}
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-3">
        <DemoChatTimeline
          items={ROOM.items}
          agents={ROOM.agents}
          filterAgentId={agentId}
        />
      </div>
      <footer className="border-t border-[#2b2b2b] bg-[#171717] px-3 py-2">
        <div className="flex items-end gap-2 rounded-lg border border-[#2b2b2b] bg-[#1a1a1a] px-3 py-2">
          <div className="min-w-0 flex-1">
            <p className="text-[10px] text-[#6e6e6e]">{selected.model}</p>
            <p className="text-[13px] text-[#6e6e6e]">Steer {selected.label}…</p>
          </div>
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-[#e4e4e4] text-[#141414]">
            ↑
          </span>
        </div>
      </footer>
    </div>
  );
}
