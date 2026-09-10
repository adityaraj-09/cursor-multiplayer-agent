"use client";

import { useMemo, useState } from "react";
import {
  LayoutGrid,
  Maximize2,
  Plus,
  X,
} from "lucide-react";
import DemoChatTimeline from "./DemoChatTimeline";
import { DEMO_BOARD, type DemoBoardTile } from "./demo-chat";
import { DEMO_SESSIONS } from "./demo-data";

export default function BoardShowcase() {
  const [tiles, setTiles] = useState(DEMO_BOARD.slice(0, 2));
  const [focusId, setFocusId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const pinned = useMemo(() => new Set(tiles.map((tile) => tile.id)), [tiles]);
  const available = DEMO_SESSIONS.filter((room) => !pinned.has(room.id));
  const focused = tiles.find((tile) => tile.id === focusId) || null;

  const addRoom = (id: string) => {
    const existing = DEMO_BOARD.find((tile) => tile.id === id);
    if (existing) {
      setTiles((prev) => [...prev, existing]);
      setAdding(false);
      return;
    }
    const session = DEMO_SESSIONS.find((room) => room.id === id);
    if (!session) return;
    const label = session.agents.split(" · ")[0];
    setTiles((prev) => [
      ...prev,
      {
        id: session.id,
        name: session.name,
        live: session.status === "active",
        agents: [
          {
            id: "agent",
            label,
            running: session.status === "active",
            model: session.model,
          },
        ],
        placeholder: `Steer ${label}…`,
        items: [
          {
            kind: "user",
            agentId: "agent",
            agentLabel: label,
            name: "Jules",
            color: "#8ec5ff",
            time: "now",
            text: "Pin this room and keep going from the last steer.",
          },
          {
            kind: "assistant",
            agentId: "agent",
            agentLabel: label,
            time: "now",
            text: "On the board. Waiting for the next prompt.",
          },
        ],
      },
    ]);
    setAdding(false);
  };

  const removeRoom = (id: string) => {
    setTiles((prev) => prev.filter((tile) => tile.id !== id));
    setFocusId((cur) => (cur === id ? null : cur));
  };

  const gridClass =
    tiles.length <= 1
      ? "grid-cols-1"
      : tiles.length === 2
        ? "grid-cols-1 sm:grid-cols-2"
        : "grid-cols-1 sm:grid-cols-2 xl:grid-cols-3";

  return (
    <div className="relative flex min-h-0 flex-1 flex-col bg-[#111111]">
      <header className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-[#2b2b2b] bg-[#171717] px-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#2b2b2b] bg-[#1f1f1f] text-[#a0a0a0]">
            <LayoutGrid className="h-4 w-4" strokeWidth={1.75} />
          </span>
          <h3 className="text-[14px] font-medium text-[#f0f0f0]">Board</h3>
          <span className="text-[11px] text-[#6e6e6e]">
            {tiles.length} session{tiles.length === 1 ? "" : "s"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {focusId && (
            <button
              type="button"
              onClick={() => setFocusId(null)}
              className="h-8 rounded-md border border-[#2b2b2b] px-2.5 text-[12px] text-[#a0a0a0] hover:text-[#e4e4e4]"
            >
              Exit focus
            </button>
          )}
          {!focusId && (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[#2b2b2b] bg-[#1f1f1f] px-2.5 text-[12px] text-[#a0a0a0] hover:border-[#3c3c3c] hover:text-[#e4e4e4]"
            >
              <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
              Add session
            </button>
          )}
          <span className="hidden h-8 items-center rounded-md border border-[#2b2b2b] px-2.5 text-[12px] text-[#a0a0a0] sm:inline-flex">
            Fullscreen
          </span>
        </div>
      </header>

      {focused && tiles.length > 1 && (
        <div className="flex shrink-0 items-center gap-1.5 overflow-x-auto border-b border-[#2b2b2b] px-2 py-1.5">
          {tiles.map((tile) => (
            <button
              key={tile.id}
              type="button"
              onClick={() => setFocusId(tile.id)}
              className={`h-8 shrink-0 rounded-md border px-2.5 text-[11px] ${
                tile.id === focusId
                  ? "border-[#26405d] bg-[#17202a] text-[#8ec5ff]"
                  : "border-[#2b2b2b] bg-[#1a1a1a] text-[#8a8a8a]"
              }`}
            >
              {tile.name}
            </button>
          ))}
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col p-2 sm:p-3">
        {tiles.length === 0 ? (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="mx-auto flex min-h-[180px] w-full max-w-sm flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-[#2b2b2b] bg-[#151515] text-[#6e6e6e] hover:border-[#3c3c3c] hover:text-[#e4e4e4]"
          >
            <Plus className="h-6 w-6" strokeWidth={1.75} />
            <span className="text-[13px]">Add session</span>
            <span className="text-[11px]">Pin a room to the board</span>
          </button>
        ) : (
          <div
            className={
              focused ? "min-h-0 flex-1" : `grid min-h-0 flex-1 gap-2 ${gridClass}`
            }
          >
            {tiles.map((tile) => {
              if (focused && tile.id !== focusId) return null;
              return (
                <BoardTile
                  key={tile.id}
                  tile={tile}
                  focused={tile.id === focusId}
                  onFocus={() => setFocusId(tile.id === focusId ? null : tile.id)}
                  onRemove={() => removeRoom(tile.id)}
                />
              );
            })}
          </div>
        )}
      </div>

      {adding && (
        <div
          className="absolute inset-0 z-20 flex items-center justify-center bg-black/55 px-4"
          onClick={() => setAdding(false)}
          role="presentation"
        >
          <div
            className="flex max-h-[70%] w-full max-w-md flex-col rounded-lg border border-[#2b2b2b] bg-[#1a1a1a] shadow-xl"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-label="Add session to board"
          >
            <div className="flex h-11 items-center justify-between border-b border-[#2b2b2b] px-4">
              <h2 className="text-[14px] font-medium text-[#e4e4e4]">Add to board</h2>
              <button
                type="button"
                onClick={() => setAdding(false)}
                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[#a0a0a0] hover:text-[#e4e4e4]"
                aria-label="Close"
              >
                <X className="h-4 w-4" strokeWidth={1.75} />
              </button>
            </div>
            <div className="space-y-1.5 overflow-y-auto p-3">
              {available.length === 0 ? (
                <p className="px-1 py-6 text-center text-[12px] text-[#6e6e6e]">
                  No other sessions in this workspace.
                </p>
              ) : (
                available.map((room) => (
                  <button
                    key={room.id}
                    type="button"
                    onClick={() => addRoom(room.id)}
                    className="w-full rounded-md border border-[#2b2b2b] bg-[#141414] px-3 py-2.5 text-left hover:border-[#3c3c3c]"
                  >
                    <p className="truncate text-[13px] text-[#e4e4e4]">{room.name}</p>
                    <p className="text-[11px] text-[#6e6e6e]">
                      {room.status === "active" ? "Live" : "Stopped"}
                      {` · ${room.people} online`}
                    </p>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function BoardTile({
  tile,
  focused,
  onFocus,
  onRemove,
}: {
  tile: DemoBoardTile;
  focused: boolean;
  onFocus: () => void;
  onRemove: () => void;
}) {
  const [agentId, setAgentId] = useState<string | null>(
    tile.agents.length > 1 ? null : tile.agents[0]?.id ?? null,
  );
  const multi = tile.agents.length > 1;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-[#2b2b2b] bg-[#141414]">
      <header className="flex h-10 shrink-0 items-center gap-2 border-b border-[#2b2b2b] bg-[#171717] px-2.5">
        <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-[#f0f0f0]">
          {tile.name}
        </span>
        {tile.live && (
          <span className="hidden text-[10px] text-[#3ecf8e] sm:inline">Live</span>
        )}
        <button
          type="button"
          onClick={onFocus}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-[#2b2b2b] text-[#6e6e6e] hover:text-[#e4e4e4]"
          title={focused ? "Exit focus" : "Focus session"}
        >
          <Maximize2 className="h-3.5 w-3.5" strokeWidth={1.75} />
        </button>
        <button
          type="button"
          onClick={onRemove}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-[#2b2b2b] text-[#6e6e6e] hover:text-[#f07070]"
          title="Remove from board"
        >
          <X className="h-3.5 w-3.5" strokeWidth={1.75} />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-auto px-2.5">
        <DemoChatTimeline
          items={tile.items}
          agents={tile.agents}
          filterAgentId={agentId}
          compact={!focused}
        />
      </div>

      {multi && (
        <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-t border-[#2b2b2b] bg-[#171717] px-2 py-1">
          <button
            type="button"
            onClick={() => setAgentId(null)}
            className={`inline-flex h-6 shrink-0 items-center rounded-md border px-2 text-[10px] ${
              agentId === null
                ? "border-[#26405d] bg-[#17202a] text-[#8ec5ff]"
                : "border-[#2b2b2b] bg-[#1a1a1a] text-[#8a8a8a]"
            }`}
          >
            All
          </button>
          {tile.agents.map((agent) => (
            <button
              key={agent.id}
              type="button"
              onClick={() => setAgentId(agent.id)}
              className={`inline-flex h-6 shrink-0 items-center gap-1.5 rounded-md border px-2 text-[10px] ${
                agentId === agent.id
                  ? "border-[#26405d] bg-[#17202a] text-[#8ec5ff]"
                  : "border-[#2b2b2b] bg-[#1a1a1a] text-[#8a8a8a]"
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  agent.running ? "bg-[#3ecf8e] animate-pulse" : "bg-[#6e6e6e]"
                }`}
              />
              {agent.label}
              {agent.integrator && (
                <span className="text-[9px] text-[#a3e635]">int</span>
              )}
            </button>
          ))}
        </div>
      )}

      <footer className="shrink-0 border-t border-[#2b2b2b] bg-[#171717] px-2 py-1.5">
        <div className="flex items-end gap-1.5 rounded-lg border border-[#2b2b2b] bg-[#1a1a1a] px-2 py-1.5">
          <div className="min-w-0 flex-1">
            <p className="mb-0.5 text-[10px] text-[#6e6e6e]">
              {tile.agents.find((agent) => agent.id === agentId)?.model ||
                tile.agents.find((agent) => agent.running)?.model ||
                tile.agents[0]?.model}
            </p>
            <p className="text-[12px] text-[#6e6e6e]">{tile.placeholder}</p>
          </div>
          <span className="mb-0.5 flex h-6 w-6 items-center justify-center rounded-md bg-[#e4e4e4] text-[11px] font-medium text-[#141414]">
            ↑
          </span>
        </div>
      </footer>
    </div>
  );
}
