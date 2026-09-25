"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import { Boxes, Pause, Play, RotateCcw } from "lucide-react";
import type { SwarmAgentInfo, SwarmRole, SwarmTaskInfo } from "../../../shared/swarm";
import {
  ROLE_HEX,
  ZERO_VEC,
  buildSwarmVisualGraph,
  replayCast,
  smootherstep,
  type Vec3,
} from "../../../shared/swarmVisual";
import { ROLE_META } from "./swarmUi";

const SwarmVisualizerScene = dynamic(() => import("./SwarmVisualizerScene"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-[13px] text-[#6e6e6e]">
      Loading 3D scene…
    </div>
  ),
});

const TRAVEL_MS = 2100;
const TRAVEL_SAME_ROLE_MS = 1100;
const SPAWN_MS = 1900;
const DWELL_MS = 1000;
const OVERVIEW_MS = 2600;

type PlayPhase = "travel" | "spawn" | "dwell" | "overview";

export default function SwarmVisualizer({
  agents,
  tasks,
  selectedId,
  onSelect,
  showRetired,
  fill = false,
  className = "",
  onExitScene,
}: {
  agents: SwarmAgentInfo[];
  tasks: SwarmTaskInfo[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  showRetired: boolean;
  fill?: boolean;
  className?: string;
  onExitScene?: () => void;
}) {
  const [asOf, setAsOf] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [resetKey, setResetKey] = useState(0);
  const [floorOffsets, setFloorOffsets] = useState<Partial<Record<SwarmRole, Vec3>>>({});
  const [workOffset, setWorkOffset] = useState<Vec3>(ZERO_VEC);
  const [revealingId, setRevealingId] = useState<string | null>(null);
  const [reveal, setReveal] = useState(1);
  const [focusAgentId, setFocusAgentId] = useState<string | null>(null);
  const [beat, setBeat] = useState(0);
  const [flightMs, setFlightMs] = useState(TRAVEL_MS);

  const cast = useMemo(() => replayCast(agents, { includeRetired: showRetired }), [agents, showRetired]);
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
  const canReplay = cast.length > 1;
  const introducing = revealingId ? cast.find((a) => a.id === revealingId) : null;
  const castKey = cast.map((a) => a.id).join("|");
  const castRef = useRef(cast);
  castRef.current = cast;

  useEffect(() => {
    const roster = castRef.current;
    if (!playing || roster.length < 2) return;
    let cancelled = false;
    let frame = 0;
    const startAt = (() => {
      if (asOf == null || asOf >= (roster[roster.length - 1]?.createdAt ?? 0)) return 0;
      const idx = roster.findIndex((a) => a.createdAt > asOf);
      return idx < 0 ? 0 : idx;
    })();
    let index = startAt;
    let phase: PlayPhase = "travel";
    let started = performance.now();
    let prevRole: SwarmRole | null = index > 0 ? roster[index - 1]!.role : null;

    const beginBeat = (i: number) => {
      const agent = roster[i]!;
      setBeat(i);
      setFlightMs(prevRole === agent.role ? TRAVEL_SAME_ROLE_MS : TRAVEL_MS);
      setRevealingId(agent.id);
      setReveal(0);
      setAsOf(agent.createdAt);
      setFocusAgentId(agent.id);
      onSelect(agent.id);
    };

    beginBeat(index);

    const durationOf = (next: PlayPhase, role: SwarmRole) => {
      if (next === "travel") return prevRole === role ? TRAVEL_SAME_ROLE_MS : TRAVEL_MS;
      if (next === "spawn") return SPAWN_MS;
      if (next === "dwell") return DWELL_MS;
      return OVERVIEW_MS;
    };

    const tick = (now: number) => {
      if (cancelled) return;
      const agent = roster[index];
      const duration = durationOf(phase, agent?.role ?? "researcher");
      const t = Math.min(1, (now - started) / duration);
      const eased = smootherstep(t);

      if (phase === "spawn") setReveal(eased);

      if (t >= 1) {
        if (phase === "travel") {
          phase = "spawn";
          started = now;
        } else if (phase === "spawn") {
          setReveal(1);
          phase = "dwell";
          started = now;
        } else if (phase === "dwell") {
          prevRole = agent?.role ?? prevRole;
          index += 1;
          if (index >= roster.length) {
            phase = "overview";
            started = now;
            setFlightMs(OVERVIEW_MS);
            setRevealingId(null);
            setReveal(1);
            setAsOf(null);
            setFocusAgentId(null);
            onSelect(null);
          } else {
            phase = "travel";
            started = now;
            beginBeat(index);
          }
        } else {
          index = 0;
          prevRole = null;
          phase = "travel";
          started = now;
          beginBeat(0);
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [playing, canReplay, castKey, onSelect]);

  const reset = () => {
    setPlaying(false);
    setFloorOffsets({});
    setWorkOffset(ZERO_VEC);
    setAsOf(null);
    setRevealingId(null);
    setReveal(1);
    setFocusAgentId(null);
    setBeat(cast.length);
    setResetKey((n) => n + 1);
    onSelect(null);
  };

  const sliderMax = Math.max(1, cast.length);
  const sliderValue = asOf == null && !playing ? sliderMax : Math.min(sliderMax, beat + reveal);

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
        playFocusId={playing ? focusAgentId : null}
        revealingId={revealingId}
        reveal={reveal}
        playing={playing}
        flightMs={playing ? flightMs : 820}
      />

      <div className={`pointer-events-none absolute inset-x-0 flex flex-wrap items-end justify-between gap-3 p-4 sm:p-5 ${fill ? "bottom-0" : "top-0"}`}>
        <div className="max-w-xl">
          <p className="text-[11px] leading-5 text-[#8a8f9a]">
            Play walks each spawn: the camera eases onto that role plane, then the agent fades in.
            Click a plane to focus it. Drag to pull it away.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
            {Object.entries(ROLE_HEX).map(([role, hex]) => (
              <span key={role} className="inline-flex items-center gap-1.5 text-[10px] text-[#8a8a8a]">
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: hex }} />
                {ROLE_META[role as keyof typeof ROLE_META].label}
              </span>
            ))}
          </div>
          {(introducing || selected) && (
            <p className="mt-2 text-[12px] text-[#e4e4e4]">
              {playing && introducing ? "Introducing " : ""}
              @{(introducing ?? selected)!.label}{" "}
              <span className={ROLE_META[(introducing ?? selected)!.role].color}>
                {ROLE_META[(introducing ?? selected)!.role].label}
              </span>
              {!playing && selected && (
                <span className="ml-2 text-[11px] text-[#8a8a8a]">
                  {graph.agents.find((a) => a.id === selected.id)?.taskTitle ||
                    selected.brief ||
                    (selected.role === "orchestrator" ? "Plans, delegates, and keeps the ledger." : "Waiting for work")}
                </span>
              )}
            </p>
          )}
        </div>
        <div className="pointer-events-auto flex flex-wrap items-center gap-2">
          {onExitScene && (
            <button
              type="button"
              onClick={onExitScene}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-white/10 bg-[#141414]/70 px-2.5 text-[11px] text-[#c5c8ce] backdrop-blur hover:text-[#e4e4e4]"
            >
              <Boxes className="h-3.5 w-3.5" strokeWidth={1.75} />
              Cards
            </button>
          )}
          {canReplay && (
            <>
              <button
                type="button"
                onClick={() => setPlaying((v) => !v)}
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-white/10 bg-[#141414]/70 px-2.5 text-[11px] text-[#c5c8ce] backdrop-blur hover:text-[#e4e4e4]"
              >
                {playing ? <Pause className="h-3 w-3" strokeWidth={2} /> : <Play className="h-3 w-3" strokeWidth={2} />}
                {playing ? "Pause" : "Play"}
              </button>
              <label className="flex items-center gap-2 rounded-md border border-white/10 bg-[#141414]/70 px-2 py-1 text-[11px] text-[#8a8a8a] backdrop-blur">
                Replay
                <input
                  type="range"
                  min={0}
                  max={sliderMax}
                  step={0.01}
                  value={sliderValue}
                  onChange={(e) => {
                    setPlaying(false);
                    const next = Number(e.target.value);
                    if (next >= sliderMax) {
                      setAsOf(null);
                      setBeat(cast.length);
                      setRevealingId(null);
                      setReveal(1);
                      setFocusAgentId(null);
                      return;
                    }
                    const idx = Math.min(cast.length - 1, Math.max(0, Math.floor(next)));
                    const agent = cast[idx]!;
                    setBeat(idx);
                    setAsOf(agent.createdAt);
                    setRevealingId(null);
                    setReveal(1);
                    setFocusAgentId(agent.id);
                  }}
                  className="h-1 w-28 accent-[#f0c674]"
                />
              </label>
            </>
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
