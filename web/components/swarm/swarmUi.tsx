"use client";

import { Box, Boxes, Check } from "lucide-react";
import {
  formatSwarmModelLabel,
  type SwarmInfo,
  type SwarmPostInfo,
  type SwarmRole,
  type SwarmStatus,
} from "../../../shared/swarm";

export const STATUS_META: Record<SwarmStatus, { label: string; tone: string; dot: string; live?: boolean }> = {
  draft: { label: "Draft", tone: "border-[#2b2b2b] bg-[#1a1a1a] text-[#a0a0a0]", dot: "bg-[#6e6e6e]" },
  planning: { label: "Planning", tone: "border-[#26405d] bg-[#17202a] text-[#8ec5ff]", dot: "bg-[#4d9fff]", live: true },
  researching: { label: "Researching", tone: "border-[#26405d] bg-[#17202a] text-[#8ec5ff]", dot: "bg-[#4d9fff]", live: true },
  awaiting_approval: { label: "Needs approval", tone: "border-[#4a3d1f] bg-[#221c10] text-[#e6c07b]", dot: "bg-[#e6c07b]" },
  building: { label: "Building", tone: "border-[#2e2a4d] bg-[#1b1a2b] text-[#b3a8ff]", dot: "bg-[#8b7dff]", live: true },
  paused: { label: "Paused", tone: "border-[#3c3420] bg-[#1f1b12] text-[#e6c07b]", dot: "bg-[#e6c07b]" },
  stopped: { label: "Stopped", tone: "border-[#2b2b2b] bg-[#1a1a1a] text-[#a0a0a0]", dot: "bg-[#6e6e6e]" },
  done: { label: "Done", tone: "border-[#1f3d2e] bg-[#142019] text-[#3ecf8e]", dot: "bg-[#3ecf8e]" },
  failed: { label: "Failed", tone: "border-[#3c2b2b] bg-[#1a1414] text-[#f07070]", dot: "bg-[#f07070]" },
};

export type SwarmLayout = "cards" | "scene";

export function SwarmViewToggle({
  value,
  onChange,
}: {
  value: SwarmLayout;
  onChange: (next: SwarmLayout) => void;
}) {
  return (
    <div className="inline-flex rounded-lg border border-[#2b2b2b] bg-[#171717] p-0.5" role="group" aria-label="Swarm view">
      <button
        type="button"
        onClick={() => onChange("cards")}
        className={`inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-[12px] ${
          value === "cards" ? "bg-[#252525] text-[#e4e4e4]" : "text-[#6e6e6e] hover:text-[#e4e4e4]"
        }`}
      >
        <Boxes className="h-3.5 w-3.5" strokeWidth={1.75} />
        Cards
      </button>
      <button
        type="button"
        onClick={() => onChange("scene")}
        className={`inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-[12px] ${
          value === "scene" ? "bg-[#252525] text-[#e4e4e4]" : "text-[#6e6e6e] hover:text-[#e4e4e4]"
        }`}
      >
        <Box className="h-3.5 w-3.5" strokeWidth={1.75} />
        3D
      </button>
    </div>
  );
}

export function StatusPill({ status, className = "" }: { status: SwarmStatus; className?: string }) {
  const meta = STATUS_META[status];
  return (
    <span
      className={`inline-flex h-6 items-center gap-1.5 rounded-md border px-2 text-[11px] font-medium ${meta.tone} ${className}`}
    >
      <span className="relative flex h-1.5 w-1.5">
        {meta.live && (
          <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 ${meta.dot}`} />
        )}
        <span className={`relative inline-flex h-1.5 w-1.5 rounded-full ${meta.dot}`} />
      </span>
      {meta.label}
    </span>
  );
}

export const ROLE_META: Record<SwarmRole | "human" | "system", { label: string; color: string; bg: string }> = {
  orchestrator: { label: "Orchestrator", color: "text-[#f0c674]", bg: "bg-[#2a2415] border-[#4a3d1f]" },
  researcher: { label: "Researcher", color: "text-[#8ec5ff]", bg: "bg-[#17202a] border-[#26405d]" },
  critic: { label: "Critic", color: "text-[#f59e9e]", bg: "bg-[#241616] border-[#4a2626]" },
  ranker: { label: "Ranker", color: "text-[#c4a7ff]", bg: "bg-[#1f1a2b] border-[#3b2f55]" },
  synthesizer: { label: "Synthesizer", color: "text-[#7ee2c4]", bg: "bg-[#13231f] border-[#1f4a3f]" },
  verifier: { label: "Verifier", color: "text-[#3ecf8e]", bg: "bg-[#142019] border-[#1f3d2e]" },
  engineer: { label: "Engineer", color: "text-[#f7a86b]", bg: "bg-[#261b12] border-[#4d3320]" },
  integrator: { label: "Integrator", color: "text-[#f7d56b]", bg: "bg-[#262112] border-[#4d4220]" },
  human: { label: "Human", color: "text-[#e4e4e4]", bg: "bg-[#222] border-[#3c3c3c]" },
  system: { label: "Steer", color: "text-[#a0a0a0]", bg: "bg-[#1a1a1a] border-[#2b2b2b]" },
};

export function RoleBadge({ role }: { role: SwarmPostInfo["authorRole"] }) {
  const meta = ROLE_META[role] ?? ROLE_META.system;
  return (
    <span className={`inline-flex h-5 items-center rounded border px-1.5 text-[10px] font-medium ${meta.bg} ${meta.color}`}>
      {meta.label}
    </span>
  );
}

export function ModelChip({
  modelId,
  className = "",
}: {
  modelId: string | null | undefined;
  className?: string;
}) {
  const label = formatSwarmModelLabel(modelId);
  return (
    <span
      className={`inline-flex h-5 max-w-[10rem] items-center truncate rounded border border-[#2b2b2b] bg-[#1a1a1a] px-1.5 text-[10px] text-[#a0a0a0] ${className}`}
      title={modelId && modelId !== "auto" ? modelId : "Cursor Auto"}
    >
      {label}
    </span>
  );
}

export function formatUsd(value: number): string {
  if (value >= 100) return `$${value.toFixed(0)}`;
  return `$${value.toFixed(2)}`;
}

export function relativeTime(ts: number | null | undefined, now = Date.now()): string {
  if (!ts) return "—";
  const diff = Math.round((now - ts) / 1000);
  if (diff < 0) {
    const ahead = -diff;
    if (ahead < 3600) return `in ${Math.max(1, Math.round(ahead / 60))}m`;
    if (ahead < 86_400) return `in ${Math.round(ahead / 3600)}h`;
    return `in ${Math.round(ahead / 86_400)}d`;
  }
  if (diff < 45) return "just now";
  if (diff < 3600) return `${Math.max(1, Math.round(diff / 60))}m ago`;
  if (diff < 86_400) return `${Math.round(diff / 3600)}h ago`;
  return `${Math.round(diff / 86_400)}d ago`;
}

export function BudgetMeter({
  spent,
  budget,
  compact = false,
}: {
  spent: number;
  budget: number;
  compact?: boolean;
}) {
  const ratio = budget > 0 ? Math.min(1, spent / budget) : 0;
  const tone = ratio >= 1 ? "bg-[#f07070]" : ratio >= 0.8 ? "bg-[#e6c07b]" : "bg-[#4d9fff]";
  return (
    <div className={compact ? "w-28" : "w-full"}>
      {!compact && (
        <div className="mb-1.5 flex items-baseline justify-between text-[11px]">
          <span className="text-[#6e6e6e]">Budget</span>
          <span className="tabular-nums text-[#a0a0a0]">
            <span className="text-[#e4e4e4]">{formatUsd(spent)}</span> / {formatUsd(budget)}
          </span>
        </div>
      )}
      <div className="h-1.5 overflow-hidden rounded-full bg-[#252525]">
        <div className={`h-full rounded-full transition-[width] duration-500 ${tone}`} style={{ width: `${ratio * 100}%` }} />
      </div>
      {compact && (
        <p className="mt-1 text-[10px] tabular-nums text-[#6e6e6e]">
          {formatUsd(spent)} / {formatUsd(budget)}
        </p>
      )}
    </div>
  );
}

const PHASE_STEPS = [
  { key: "plan", label: "Plan" },
  { key: "research", label: "Research" },
  { key: "approval", label: "Approval" },
  { key: "build", label: "Build" },
  { key: "done", label: "Done" },
] as const;

function phaseIndex(swarm: Pick<SwarmInfo, "status" | "phase">): number {
  if (swarm.status === "done") return 4;
  if (swarm.phase === "build") return 3;
  if (swarm.status === "awaiting_approval") return 2;
  if (swarm.status === "planning" || swarm.status === "draft") return 0;
  return 1;
}

export function PhaseStepper({ swarm }: { swarm: Pick<SwarmInfo, "status" | "phase" | "repoUrl"> }) {
  const current = phaseIndex(swarm);
  const steps = swarm.repoUrl ? PHASE_STEPS : PHASE_STEPS.filter((s) => s.key !== "approval" && s.key !== "build");
  return (
    <ol className="flex items-center gap-1.5 text-[11px]">
      {steps.map((step, i) => {
        const index = PHASE_STEPS.findIndex((s) => s.key === step.key);
        const done = index < current || swarm.status === "done";
        const active = index === current && swarm.status !== "done";
        return (
          <li key={step.key} className="flex items-center gap-1.5">
            {i > 0 && <span className={`h-px w-4 sm:w-6 ${done || active ? "bg-[#3c3c3c]" : "bg-[#252525]"}`} />}
            <span
              className={`inline-flex h-6 items-center gap-1 rounded-full border px-2 ${
                active
                  ? "border-[#26405d] bg-[#17202a] text-[#8ec5ff]"
                  : done
                    ? "border-[#2b2b2b] bg-[#1a1a1a] text-[#a0a0a0]"
                    : "border-[#222] text-[#555]"
              }`}
            >
              {done && <Check className="h-3 w-3" strokeWidth={2} />}
              {step.label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
