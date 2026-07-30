"use client";

import type { AgentInfo, AgentRunStatus, ModelInfo, Participant } from "../../shared/events";

interface AgentTabsProps {
  agents: AgentInfo[];
  selectedAgentId: string | null;
  /** null = show all agents' messages in chat */
  chatFilterAgentId: string | null;
  onSelectAgent: (agentId: string) => void;
  onSelectAll: () => void;
  statusByAgent: Record<string, AgentRunStatus>;
  participants: Participant[];
  models: ModelInfo[];
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

function modelLabel(modelId: string, models: ModelInfo[]): string {
  const match = models.find((m) => m.id === modelId);
  if (match) return match.displayName;
  if (modelId === "auto") return "Auto";
  const tail = modelId.split("-").pop() || modelId;
  return tail.length > 14 ? `${tail.slice(0, 12)}…` : tail;
}

export default function AgentTabs({
  agents,
  selectedAgentId,
  chatFilterAgentId,
  onSelectAgent,
  onSelectAll,
  statusByAgent,
  participants,
  models,
  amHost,
  onAddAgent,
  onStopAgent,
}: AgentTabsProps) {
  const multi = agents.length > 1;
  const showAllTab = multi;
  const allSelected = multi && chatFilterAgentId === null;

  if (!agents.length && !amHost) return null;

  return (
    <div className="flex items-center gap-1 px-2 sm:px-3 py-1.5 border-b border-[#2b2b2b] bg-[#161616] overflow-x-auto shrink-0">
      {showAllTab && (
        <button
          type="button"
          onClick={onSelectAll}
          className={`h-7 px-2.5 rounded-md text-[12px] shrink-0 transition-colors border ${
            allSelected
              ? "bg-[#252525] text-[#e4e4e4] border-[#3c3c3c]"
              : "text-[#a0a0a0] hover:text-[#e4e4e4] hover:bg-[#1e1e1e] border-transparent"
          }`}
        >
          All agents
        </button>
      )}

      {agents.map((agent) => {
        const isActive = multi
          ? chatFilterAgentId === agent.id
          : selectedAgentId === agent.id;
        const isTarget = selectedAgentId === agent.id;
        const status = statusByAgent[agent.id] || agent.status;
        const driver = participants.find((p) =>
          p.drivingAgentIds?.includes(agent.id),
        );

        return (
          <div
            key={agent.id}
            className={`group flex items-center gap-1.5 h-7 px-2 rounded-md text-[12px] shrink-0 transition-colors border ${
              isActive
                ? "bg-[#252525] text-[#e4e4e4] border-[#3c3c3c]"
                : "text-[#a0a0a0] hover:text-[#e4e4e4] hover:bg-[#1e1e1e] border-transparent"
            } ${agent.status === "stopped" ? "opacity-50" : ""}`}
          >
            <button
              type="button"
              onClick={() => onSelectAgent(agent.id)}
              className="flex items-center gap-1.5 min-w-0"
              title={
                isTarget
                  ? `Messaging ${agent.label}`
                  : `View ${agent.label} — click to focus`
              }
            >
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${statusDot(status)}`} />
              <span className="whitespace-nowrap font-medium">{agent.label}</span>
              <span className="text-[10px] uppercase tracking-wide text-[#6e6e6e] hidden sm:inline">
                {agent.backend === "claude-code" ? "Claude" : "Cursor"}
              </span>
              <span
                className="text-[10px] px-1.5 py-0.5 rounded bg-[#1a1a1a] text-[#8a8a8a] max-w-[7rem] truncate hidden md:inline"
                title={agent.modelId}
              >
                {modelLabel(agent.modelId, models)}
              </span>
              {isTarget && multi && (
                <span className="text-[9px] px-1 py-0.5 rounded bg-[#1f2a1f] text-[#3ecf8e]">
                  active
                </span>
              )}
              {driver && (
                <span
                  className="w-4 h-4 rounded-full text-[9px] flex items-center justify-center text-white shrink-0"
                  style={{ backgroundColor: driver.color }}
                  title={`Driven by ${driver.name}`}
                >
                  {driver.name.slice(0, 1).toUpperCase()}
                </span>
              )}
            </button>
            {amHost && agent.status !== "stopped" && multi && (
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
