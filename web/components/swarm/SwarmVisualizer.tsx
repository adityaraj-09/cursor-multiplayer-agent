"use client";

import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import { BoxSelect, RotateCcw } from "lucide-react";
import type { SwarmAgentInfo, SwarmTaskInfo } from "../../../shared/swarm";
import { ROLE_HEX, buildSwarmVisualGraph } from "../../../shared/swarmVisual";
import { ROLE_META } from "./swarmUi";

const SwarmVisualizerScene = dynamic(() => import("./SwarmVisualizerScene"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-[13px] text-[#6e6e6e]">
      Loading 3D scene…
    </div>
  ),
});

export default function SwarmVisualizer({
  agents,
  tasks,
  selectedId,
  onSelect,
  showRetired,
  className = "",
}: {
  agents: SwarmAgentInfo[];
  tasks: SwarmTaskInfo[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  showRetired: boolean;
  className?: string;
}) {
  const [asOf, setAsOf] = useState<number | null>(null);
  const [resetKey, setResetKey] = useState(0);

  const times = useMemo(() => {
    const ts = agents.map((a) => a.createdAt).sort((a, b) => a - b);
    return { min: ts[0] ?? 0, max: ts[ts.length - 1] ?? 0 };
  }, [agents]);

  const graph = useMemo(
    () =>
      buildSwarmVisualGraph({
        agents,
        tasks,
        includeRetired: showRetired,
        asOf,
      }),
    [agents, tasks, showRetired, asOf],
  );

  const selected = agents.find((a) => a.id === selectedId) ?? null;
  const canReplay = times.max > times.min;

  return (
    <div className={`overflow-hidden rounded-xl border border-[#2b2b2b] bg-[#0c0e13] ${className}`}>
      <div className="flex flex-wrap items-center gap-2 border-b border-[#1f1f1f] px-3 py-2">
        <p className="mr-auto text-[11px] text-[#6e6e6e]">
          Drag to orbit · click a figure · gold lines are spawns
        </p>
        {canReplay && (
          <label className="flex items-center gap-2 text-[11px] text-[#8a8a8a]">
            Replay
            <input
              type="range"
              min={times.min}
              max={times.max}
              value={asOf ?? times.max}
              onChange={(e) => {
                const next = Number(e.target.value);
                setAsOf(next >= times.max ? null : next);
              }}
              className="h-1 w-28 accent-[#f0c674]"
            />
          </label>
        )}
        <button
          type="button"
          onClick={() => setResetKey((n) => n + 1)}
          className="inline-flex h-7 items-center gap-1 rounded-md border border-[#2b2b2b] bg-[#171717] px-2 text-[11px] text-[#a0a0a0] hover:text-[#e4e4e4]"
        >
          <RotateCcw className="h-3 w-3" strokeWidth={1.75} />
          Reset view
        </button>
      </div>

      <div className="relative h-[560px] w-full">
        <SwarmVisualizerScene
          key={resetKey}
          graph={graph}
          selectedId={selectedId}
          onSelect={onSelect}
        />
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-[#1f1f1f] px-3 py-2">
        {Object.entries(ROLE_HEX).map(([role, hex]) => (
          <span key={role} className="inline-flex items-center gap-1.5 text-[10px] text-[#8a8a8a]">
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: hex }} />
            {ROLE_META[role as keyof typeof ROLE_META].label}
          </span>
        ))}
        <span className="ml-auto inline-flex items-center gap-3 text-[10px] text-[#6e6e6e]">
          <span>working = glow</span>
          <span>idle = dim</span>
          <span>dead = faded</span>
        </span>
      </div>

      {selected && (
        <div className="flex items-start gap-3 border-t border-[#1f1f1f] px-3 py-2.5">
          <BoxSelect className="mt-0.5 h-3.5 w-3.5 text-[#6e6e6e]" strokeWidth={1.75} />
          <div className="min-w-0">
            <p className="text-[12px] text-[#e4e4e4]">
              @{selected.label}{" "}
              <span className={ROLE_META[selected.role].color}>{ROLE_META[selected.role].label}</span>
            </p>
            <p className="mt-0.5 line-clamp-2 text-[11px] text-[#8a8a8a]">
              {graph.agents.find((a) => a.id === selected.id)?.taskTitle ||
                selected.brief ||
                (selected.role === "orchestrator" ? "Plans, delegates, and keeps the ledger." : "Waiting for work")}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
