"use client";

import { GitMerge } from "lucide-react";
import type { IntegrationJobInfo } from "../../shared/events";

export function integrateButtonState(
  agentId: string,
  job?: IntegrationJobInfo | null,
): "idle" | "merging" | "queued" {
  if (!job || job.status === "idle") return "idle";
  if (job.sourceAgentId === agentId) return "merging";
  if (job.queue.some((item) => item.sourceAgentId === agentId)) return "queued";
  return "idle";
}

export default function IntegrateButton({
  hasPr,
  state = "idle",
  queuedBehind,
  disabled,
  compact,
  onClick,
}: {
  hasPr: boolean;
  state?: "idle" | "merging" | "queued";
  queuedBehind?: string;
  disabled?: boolean;
  compact?: boolean;
  onClick: () => void;
}) {
  const label =
    state === "merging"
      ? "Merging…"
      : state === "queued"
        ? "Queued"
        : hasPr
          ? "Update PR"
          : "Integrate";
  const title =
    state === "merging"
      ? "Integrator is merging this work"
      : state === "queued"
        ? queuedBehind
          ? `Queued behind ${queuedBehind}’s integration`
          : "Queued behind the current integration"
        : hasPr
          ? "Queue a merge of this agent into the existing integration PR"
          : "Merge this agent into the integration branch and open a PR";
  const busy = state === "merging" || state === "queued";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || busy}
      title={title}
      className={`inline-flex items-center justify-center gap-1 rounded-md border text-[#a0a0a0] hover:text-[#e4e4e4] hover:border-[#3c3c3c] disabled:opacity-50 disabled:cursor-not-allowed ${
        compact
          ? "h-6 px-1.5 text-[10px] border-[#2b2b2b]"
          : "h-8 px-2.5 text-[11px] border-[#2b2b2b] bg-[#1f1f1f]"
      }`}
    >
      <GitMerge
        className={compact ? "h-3 w-3" : "h-3.5 w-3.5"}
        strokeWidth={1.75}
      />
      <span>{label}</span>
    </button>
  );
}
