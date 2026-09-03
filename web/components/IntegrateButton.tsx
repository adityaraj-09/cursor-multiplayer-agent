"use client";

import { GitMerge } from "lucide-react";

export default function IntegrateButton({
  hasPr,
  busy,
  disabled,
  compact,
  onClick,
}: {
  hasPr: boolean;
  busy: boolean;
  disabled?: boolean;
  compact?: boolean;
  onClick: () => void;
}) {
  const label = busy ? "Merging…" : hasPr ? "Update PR" : "Integrate";
  const title = busy
    ? "Integrator is merging this work"
    : hasPr
      ? "Merge this agent into the existing integration PR"
      : "Merge this agent into the integration branch and open a PR";
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
