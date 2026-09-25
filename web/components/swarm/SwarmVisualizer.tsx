"use client";

import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import { RotateCcw } from "lucide-react";
import type { SwarmAgentInfo, SwarmRole, SwarmTaskInfo } from "../../../shared/swarm";
import { ROLE_HEX, ZERO_VEC, buildSwarmVisualGraph, type Vec3 } from "../../../shared/swarmVisual";
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
  fill = false,
  className = "",
}: {
  agents: SwarmAgentInfo[];
  tasks: SwarmTaskInfo[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  showRetired: boolean;
  fill?: boolean;
  className?: string;
}) {
  const [asOf, setAsOf] = useState<number | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const [floorOffsets, setFloorOffsets] = useState<Partial<Record<SwarmRole, Vec3>>>({});
  const [workOffset, setWorkOffset] = useState<Vec3>(ZERO_VEC);

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

  const reset = () => {
    setFloorOffsets({});
    setWorkOffset(ZERO_VEC);
    setAsOf(null);
    setResetKey((n) => n + 1);
  };

  return (
    <div className={`relative overflow-hidden bg-[#0b0d12] ${fill ? "h-full w-full" : "h-[min(70vh,640px)] w-full"} ${className}`}>
      <SwarmVisualizerScene
        key={resetKey}
        graph={graph}
        selectedId={selectedId}
        onSelect={onSelect}
        floorOffsets={floorOffsets}
        workOffset={workOffset}
        onFloorOffset={(role, next) => setFloorOffsets((prev) => ({ ...prev, [role]: next }))}
        onWorkOffset={setWorkOffset}
      />

      <div className={`pointer-events-none absolute inset-x-0 flex flex-wrap items-end justify-between gap-3 p-4 sm:p-5 ${fill ? "bottom-0" : "top-0"}`}>
        <div className="max-w-xl">
          <p className="text-[11px] leading-5 text-[#8a8f9a]">
            Drag a role plane to pull it away — spawn strings stay attached. Shift-drag to lift.
            Scroll to zoom. Drag empty space to orbit.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
            {Object.entries(ROLE_HEX).map(([role, hex]) => (
              <span key={role} className="inline-flex items-center gap-1.5 text-[10px] text-[#8a8a8a]">
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: hex }} />
                {ROLE_META[role as keyof typeof ROLE_META].label}
              </span>
            ))}
          </div>
          {selected && (
            <p className="mt-2 text-[12px] text-[#e4e4e4]">
              @{selected.label}{" "}
              <span className={ROLE_META[selected.role].color}>{ROLE_META[selected.role].label}</span>
              <span className="ml-2 text-[11px] text-[#8a8a8a]">
                {graph.agents.find((a) => a.id === selected.id)?.taskTitle ||
                  selected.brief ||
                  (selected.role === "orchestrator" ? "Plans, delegates, and keeps the ledger." : "Waiting for work")}
              </span>
            </p>
          )}
        </div>
        <div className="pointer-events-auto flex flex-wrap items-center gap-2">
          {canReplay && (
            <label className="flex items-center gap-2 rounded-md border border-white/10 bg-[#141414]/70 px-2 py-1 text-[11px] text-[#8a8a8a] backdrop-blur">
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
            onClick={reset}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-white/10 bg-[#141414]/70 px-2.5 text-[11px] text-[#c5c8ce] backdrop-blur hover:text-[#e4e4e4]"
          >
            <RotateCcw className="h-3 w-3" strokeWidth={1.75} />
            Reset view
          </button>
        </div>
      </div>
    </div>
  );
}
