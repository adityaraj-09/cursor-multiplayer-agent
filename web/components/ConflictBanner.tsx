"use client";

import type { AgentConflict, AgentInfo } from "../../shared/events";

interface ConflictBannerProps {
  conflicts: AgentConflict[];
  agents: AgentInfo[];
  currentAgentId: string | null;
}

export default function ConflictBanner({
  conflicts,
  agents,
  currentAgentId,
}: ConflictBannerProps) {
  if (!currentAgentId || !conflicts.length) return null;

  const relevant = conflicts.filter((c) =>
    c.agentIds.includes(currentAgentId),
  );
  if (!relevant.length) return null;

  const labelFor = (id: string) =>
    agents.find((a) => a.id === id)?.label || id.slice(0, 6);

  return (
    <div className="px-3 py-2 border-b border-[#3c2a1a] bg-[#2a1f14] text-[11px] text-[#e8a23a] shrink-0 space-y-1">
      {relevant.map((c, i) => {
        const others = c.agentIds.filter((id) => id !== currentAgentId);
        const names = others.map(labelFor).join(" and ");
        const paths = c.paths.slice(0, 3).join(", ");
        return (
          <p key={i}>
            {labelFor(currentAgentId)} and {names} may conflict on{" "}
            <span className="font-mono text-[#f0c070]">{paths}</span>
          </p>
        );
      })}
    </div>
  );
}
