"use client";

import { useState } from "react";
import {
  Bot,
  BrainCircuit,
  Columns2,
  Home,
  Layers3,
  LayoutList,
  Plus,
  Radio,
  Settings2,
} from "lucide-react";
import DemoChatTimeline from "./DemoChatTimeline";
import { getDemoRoom, type DemoBoardTile } from "./demo-chat";
import { DEMO_SESSIONS } from "./demo-data";

export default function SessionRoomView({
  roomId,
  onBack,
}: {
  roomId: string;
  onBack: () => void;
}) {
  const session = DEMO_SESSIONS.find((item) => item.id === roomId);
  const room: DemoBoardTile | undefined = getDemoRoom(roomId);
  const [viewMode, setViewMode] = useState<"tabs" | "split">("tabs");
  const [filterId, setFilterId] = useState<string | null>(null);
  const [targetId, setTargetId] = useState(room?.agents[0]?.id ?? "cursor");

  if (!room || !session) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 bg-[#141414]">
        <p className="text-[13px] text-[#6e6e6e]">Session not found</p>
        <button type="button" onClick={onBack} className="text-[12px] text-[#8ec5ff]">
          Back to sessions
        </button>
      </div>
    );
  }

  const target = room.agents.find((agent) => agent.id === targetId) || room.agents[0];
  const multi = room.agents.length > 1;
  const split = viewMode === "split" && multi;
  const featureAgents = room.agents.filter((agent) => !agent.integrator);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-[#141414]">
      <header className="relative z-20 flex h-12 shrink-0 items-center justify-between gap-3 border-b border-[#2b2b2b]/90 bg-[#171717]/95 px-3">
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          <button
            type="button"
            onClick={onBack}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[#2b2b2b] bg-[#1f1f1f] text-[#a0a0a0] hover:text-[#e4e4e4]"
            aria-label="Back to sessions"
          >
            <Home className="h-4 w-4" strokeWidth={1.75} />
          </button>
          <h3 className="min-w-0 truncate text-[14px] font-medium text-[#f0f0f0]">
            {room.name}
          </h3>
          {session.target && (
            <span className="hidden truncate font-mono text-[11px] text-[#6e6e6e] sm:inline">
              {session.target}
            </span>
          )}
          {multi && (
            <div className="inline-flex items-center rounded-lg border border-[#2b2b2b] bg-[#1a1a1a] p-0.5">
              <button
                type="button"
                onClick={() => setViewMode("split")}
                className={`inline-flex h-7 items-center gap-1 rounded-md px-2 text-[11px] ${
                  viewMode === "split"
                    ? "bg-[#252525] text-[#e4e4e4]"
                    : "text-[#8a8a8a] hover:text-[#c8c8c8]"
                }`}
              >
                <Columns2 className="h-3.5 w-3.5" strokeWidth={1.75} />
                Split
              </button>
              <button
                type="button"
                onClick={() => setViewMode("tabs")}
                className={`inline-flex h-7 items-center gap-1 rounded-md px-2 text-[11px] ${
                  viewMode === "tabs"
                    ? "bg-[#252525] text-[#e4e4e4]"
                    : "text-[#8a8a8a] hover:text-[#c8c8c8]"
                }`}
              >
                <LayoutList className="h-3.5 w-3.5" strokeWidth={1.75} />
                Tabs
              </button>
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <span className="hidden h-8 items-center rounded-md border border-[#26405d] bg-[#17202a] px-2 text-[10px] text-[#8ec5ff] sm:inline-flex">
            Pull request
          </span>
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[#2b2b2b] bg-[#1f1f1f] text-[#a0a0a0]">
            <Settings2 className="h-3.5 w-3.5" strokeWidth={1.75} />
          </span>
          <div className="flex -space-x-1.5">
            {["J", "M", "A"].slice(0, session.people).map((initial) => (
              <span
                key={initial}
                className="flex h-6 w-6 items-center justify-center rounded-full border border-[#171717] bg-[#252525] text-[9px] text-[#e4e4e4]"
              >
                {initial}
              </span>
            ))}
          </div>
          <span className="hidden h-8 items-center rounded-md border border-[#2b2b2b] bg-[#1f1f1f] px-2 text-[11px] text-[#3ecf8e] sm:inline-flex">
            Driving
          </span>
        </div>
      </header>

      <main className="flex min-h-0 flex-1 overflow-hidden">
        {!split && (
          <aside className="hidden w-[220px] shrink-0 flex-col border-r border-[#2b2b2b] bg-[#171717] sm:flex">
            <div className="min-h-0 flex-1 space-y-1 overflow-auto p-2">
              {multi && (
                <button
                  type="button"
                  onClick={() => setFilterId(null)}
                  className={`flex w-full items-center gap-2.5 rounded-xl border px-2.5 py-2 text-left text-[12px] ${
                    filterId === null
                      ? "border-[#3c3c3c] bg-[#252525] text-[#e4e4e4]"
                      : "border-transparent text-[#a0a0a0] hover:bg-[#1e1e1e]"
                  }`}
                >
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#1a1a1a] text-[#a0a0a0]">
                    <Layers3 className="h-3.5 w-3.5" strokeWidth={1.75} />
                  </span>
                  <span>
                    <span className="block font-medium">All agents</span>
                    <span className="mt-0.5 block text-[10px] text-[#6e6e6e]">
                      Combined chat
                    </span>
                  </span>
                </button>
              )}
              {room.agents.map((agent) => {
                const active = filterId === agent.id || (!multi && targetId === agent.id);
                const targeting = targetId === agent.id;
                return (
                  <button
                    key={agent.id}
                    type="button"
                    onClick={() => {
                      setFilterId(agent.id);
                      setTargetId(agent.id);
                    }}
                    className={`flex w-full items-start gap-2.5 rounded-xl border px-2.5 py-2 text-left ${
                      active
                        ? "border-[#3c3c3c] bg-[#252525]"
                        : "border-transparent hover:bg-[#1e1e1e]"
                    }`}
                  >
                    <span className="relative mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#1a1a1a] text-[#a0a0a0]">
                      {agent.backend === "claude-code" ? (
                        <BrainCircuit className="h-3.5 w-3.5" strokeWidth={1.75} />
                      ) : (
                        <Bot className="h-3.5 w-3.5" strokeWidth={1.75} />
                      )}
                      <span
                        className={`absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full ring-1 ring-[#1a1a1a] ${
                          agent.running ? "animate-pulse bg-[#3ecf8e]" : "bg-[#6e6e6e]"
                        }`}
                      />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate text-[12px] font-medium text-[#e4e4e4]">
                          {agent.label}
                        </span>
                        {targeting && multi && (
                          <span className="inline-flex items-center gap-1 rounded-md bg-[#17251f] px-1.5 py-0.5 text-[9px] text-[#3ecf8e]">
                            <Radio className="h-2.5 w-2.5" strokeWidth={2} />
                            active
                          </span>
                        )}
                        {agent.integrator && (
                          <span className="rounded-md bg-[#1d2418] px-1.5 py-0.5 text-[9px] text-[#a3e635]">
                            integrator
                          </span>
                        )}
                      </span>
                      <span className="mt-0.5 block text-[10px] text-[#6e6e6e]">
                        {agent.backend === "claude-code" ? "Claude" : "Cursor"} · {agent.model}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="border-t border-[#2b2b2b] p-2">
              <span className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-[#3c3c3c] text-[12px] text-[#8a8a8a]">
                <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
                Add agent
              </span>
            </div>
          </aside>
        )}

        {split ? (
          <div className="grid min-h-0 flex-1 grid-cols-1 divide-y divide-[#2b2b2b] md:grid-cols-2 md:divide-x md:divide-y-0">
            {featureAgents.slice(0, 2).map((agent) => (
              <div key={agent.id} className="flex min-h-0 flex-col bg-[#121212]">
                <div className="flex h-9 items-center gap-2 border-b border-[#2b2b2b] px-3 text-[12px] text-[#e4e4e4]">
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      agent.running ? "animate-pulse bg-[#3ecf8e]" : "bg-[#6e6e6e]"
                    }`}
                  />
                  {agent.label}
                  <span className="text-[10px] text-[#6e6e6e]">{agent.model}</span>
                </div>
                <div className="min-h-0 flex-1 overflow-auto px-3">
                  <DemoChatTimeline
                    items={room.items}
                    agents={room.agents}
                    filterAgentId={agent.id}
                    compact
                  />
                </div>
                <div className="border-t border-[#2b2b2b] px-2 py-1.5">
                  <p className="rounded-md border border-[#2b2b2b] bg-[#1a1a1a] px-2.5 py-1.5 text-[11px] text-[#6e6e6e]">
                    Steer {agent.label}…
                  </p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-[#121212]/80">
            <div className="min-h-0 flex-1 overflow-auto px-3 sm:px-5">
              <DemoChatTimeline
                items={room.items}
                agents={room.agents}
                filterAgentId={filterId}
              />
            </div>
          </div>
        )}
      </main>

      {!split && (
        <footer className="shrink-0 border-t border-[#2b2b2b]/90 bg-[#171717]/95 px-3 py-2">
          <div className="flex items-end gap-2 rounded-xl border border-[#2b2b2b] bg-[#1a1a1a] px-3 py-2">
            <div className="min-w-0 flex-1">
              <p className="text-[10px] text-[#6e6e6e]">
                {target.label} · {target.model}
              </p>
              <p className="text-[13px] text-[#6e6e6e]">Steer {target.label}…</p>
            </div>
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#e4e4e4] text-[#141414]">
              ↑
            </span>
          </div>
        </footer>
      )}
    </div>
  );
}
