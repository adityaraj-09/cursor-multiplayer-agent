"use client";

import { formatAgentUsage, formatAgentUsageDetail } from "../../shared/agentUsage";
import type { AgentUsageInfo } from "../../shared/events";

export default function AgentUsageBadge({
  usage,
  compact = false,
}: {
  usage?: AgentUsageInfo | null;
  compact?: boolean;
}) {
  if (!usage || usage.totalTokens <= 0) return null;
  return (
    <span
      className={`tabular-nums ${
        compact
          ? "text-[10px] text-[#6e6e6e]"
          : "inline-flex items-center rounded-md border border-[#2b2b2b] bg-[#1a1a1a] px-1.5 py-0.5 text-[10px] text-[#a0a0a0]"
      }`}
      title={formatAgentUsageDetail(usage)}
    >
      {formatAgentUsage(usage)}
    </span>
  );
}
