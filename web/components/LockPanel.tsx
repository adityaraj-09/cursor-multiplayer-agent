"use client";

import type {
  AgentConflict,
  AgentConflictBlocked,
  AgentInfo,
  FileLease,
} from "../../shared/events";

interface LockPanelProps {
  conflicts: AgentConflict[];
  fileLocks: FileLease[];
  agents: AgentInfo[];
  currentAgentId: string | null;
  amHost: boolean;
  lastBlocked: AgentConflictBlocked | null;
  onForceRelease: (path: string) => Promise<void>;
}

export default function LockPanel({
  conflicts,
  fileLocks,
  agents,
  currentAgentId,
  amHost,
  lastBlocked,
  onForceRelease,
}: LockPanelProps) {
  const labelFor = (id: string) =>
    agents.find((a) => a.id === id)?.label || id.slice(0, 6);

  const relevantConflicts =
    currentAgentId && conflicts.length
      ? conflicts.filter((c) => c.agentIds.includes(currentAgentId))
      : [];

  const locksForCurrentAgent = currentAgentId
    ? fileLocks.filter((l) => l.agentId === currentAgentId)
    : [];

  const locksHeldByOthers = currentAgentId
    ? fileLocks.filter((l) => l.agentId !== currentAgentId)
    : fileLocks;

  const showBlocked =
    lastBlocked &&
    currentAgentId &&
    lastBlocked.agentId === currentAgentId;

  if (
    !relevantConflicts.length &&
    !fileLocks.length &&
    !showBlocked
  ) {
    return null;
  }

  return (
    <div className="px-3 py-2 border-b border-[#3c2a1a] bg-[#2a1f14] text-[11px] text-[#e8a23a] shrink-0 space-y-1.5">
      {showBlocked && (
        <p className="text-[#f07070]">
          Edit blocked on{" "}
          <span className="font-mono text-[#f0a0a0]">{lastBlocked.path}</span>{" "}
          — held by {labelFor(lastBlocked.holderAgentId)}
        </p>
      )}

      {relevantConflicts.map((c, i) => {
        const others = c.agentIds.filter((id) => id !== currentAgentId);
        const names = others.map(labelFor).join(" and ");
        const paths = c.paths.slice(0, 3).join(", ");
        return (
          <p key={`conflict-${i}`}>
            {labelFor(currentAgentId!)} and {names} may conflict on{" "}
            <span className="font-mono text-[#f0c070]">{paths}</span>
          </p>
        );
      })}

      {locksForCurrentAgent.length > 0 && (
        <p className="text-[#3ecf8e]">
          {labelFor(currentAgentId!)} holds {locksForCurrentAgent.length} file
          lock{locksForCurrentAgent.length === 1 ? "" : "s"}:{" "}
          <span className="font-mono text-[#7ee0a8]">
            {locksForCurrentAgent
              .slice(0, 3)
              .map((l) => l.path)
              .join(", ")}
          </span>
        </p>
      )}

      {locksHeldByOthers.map((lock) => (
        <div
          key={`${lock.path}-${lock.agentId}`}
          className="flex flex-wrap items-center gap-x-2 gap-y-1"
        >
          <span>
            <span className="font-mono text-[#f0c070]">{lock.path}</span> locked
            by {labelFor(lock.agentId)}
          </span>
          {amHost && (
            <button
              type="button"
              onClick={() => void onForceRelease(lock.path)}
              className="text-[10px] px-1.5 py-0.5 rounded border border-[#5c4020] text-[#f0c070] hover:bg-[#3c2a1a]"
            >
              Force release
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
