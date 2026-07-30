"use client";

import type { AgentInfo, AgentRunStatus, Participant } from "../../shared/events";

interface AgentTabsProps {
  agents: AgentInfo[];
  selectedAgentId: string | null;
  onSelect: (agentId: string) => void;
  statusByAgent: Record<string, AgentRunStatus>;
  participants: Participant[];
  amHost: boolean;
  onAddAgent: () => void;
  onStopAgent: (agentId: string) => void;
}

function statusDot(status: AgentRunStatus | string | undefined): string {
  if (status === "running") return "bg-[#3ecf8e] animate-pulse";
  if (status === "error") return "bg-[#f07070]";
  if (status === "stopped") return "bg-[#3c3c3c]";
  return "bg-[#6e6e6e]";
}

export default function AgentTabs({
  agents,
  selectedAgentId,
  onSelect,
  statusByAgent,
  participants,
  amHost,
  onAddAgent,
  onStopAgent,
}: AgentTabsProps) {
  const showTabs = agents.length > 1;
  // Hosts always get "+ Add agent" even with one agent; non-hosts keep a clean single-agent UI.
  if (!showTabs && !amHost) return null;

  return (
    <div className="flex items-center gap-1 px-2 sm:px-3 py-1.5 border-b border-[#2b2b2b] bg-[#161616] overflow-x-auto shrink-0">
      {showTabs && agents.map((agent) => {
        const selected = agent.id === selectedAgentId;
        const status = statusByAgent[agent.id] || agent.status;
        const driver = participants.find((p) =>
          p.drivingAgentIds?.includes(agent.id),
        );
        return (
          <div
            key={agent.id}
            className={`group flex items-center gap-1.5 h-7 px-2 rounded-md text-[12px] shrink-0 transition-colors ${
              selected
                ? "bg-[#252525] text-[#e4e4e4] border border-[#3c3c3c]"
                : "text-[#a0a0a0] hover:text-[#e4e4e4] hover:bg-[#1e1e1e] border border-transparent"
            } ${agent.status === "stopped" ? "opacity-50" : ""}`}
          >
            <button
              type="button"
              onClick={() => onSelect(agent.id)}
              className="flex items-center gap-1.5"
            >
              <span className={`w-1.5 h-1.5 rounded-full ${statusDot(status)}`} />
              <span className="whitespace-nowrap">{agent.label}</span>
              <span className="text-[10px] uppercase tracking-wide text-[#6e6e6e]">
                {agent.backend === "claude-code" ? "Claude" : "Cursor"}
              </span>
              {driver && (
                <span
                  className="w-4 h-4 rounded-full text-[9px] flex items-center justify-center text-white"
                  style={{ backgroundColor: driver.color }}
                  title={`Driven by ${driver.name}`}
                >
                  {driver.name.slice(0, 1).toUpperCase()}
                </span>
              )}
            </button>
            {amHost && agent.status !== "stopped" && agents.length > 1 && (
              <button
                type="button"
                title="Stop agent"
                onClick={() => onStopAgent(agent.id)}
                className="opacity-0 group-hover:opacity-100 text-[#6e6e6e] hover:text-[#f07070] ml-0.5"
              >
                ×
              </button>
            )}
          </div>
        );
      })}
      {amHost && (
        <button
          type="button"
          onClick={onAddAgent}
          className="h-7 px-2 rounded-md text-[12px] text-[#6e6e6e] hover:text-[#e4e4e4] hover:bg-[#1e1e1e] shrink-0"
        >
          + Add agent
        </button>
      )}
    </div>
  );
}
