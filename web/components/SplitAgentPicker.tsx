"use client";

import { X } from "lucide-react";
import type { AgentInfo, AgentRunStatus } from "../../shared/events";

function statusTone(status: AgentRunStatus | string | undefined): string {
  if (status === "running") return "bg-[#3ecf8e] animate-pulse";
  if (status === "error") return "bg-[#f07070]";
  if (status === "stopped") return "bg-[#3c3c3c]";
  return "bg-[#6e6e6e]";
}

export default function SplitAgentPicker({
  agents,
  visibleIds,
  statusByAgent,
  onShow,
  onHide,
  onFocus,
}: {
  agents: AgentInfo[];
  visibleIds: string[];
  statusByAgent: Record<string, AgentRunStatus>;
  onShow: (id: string) => void;
  onHide: (id: string) => void;
  onFocus?: (id: string) => void;
}) {
  if (!agents.length) {
    return (
      <p className="text-[12px] text-[#6e6e6e]">No agents in this session.</p>
    );
  }

  return (
    <div className="space-y-1.5">
      {agents.map((agent) => {
        const visible = visibleIds.includes(agent.id);
        const status = statusByAgent[agent.id] || agent.status;
        return (
          <div
            key={agent.id}
            className={`flex items-center gap-2 rounded-md border px-2.5 py-2 ${
              visible
                ? "border-[#26405d] bg-[#17202a]"
                : "border-[#2b2b2b] bg-[#141414]"
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full shrink-0 ${statusTone(status)}`}
            />
            <button
              type="button"
              onClick={() => (visible ? onFocus?.(agent.id) : onShow(agent.id))}
              className={`flex-1 min-w-0 text-left text-[12px] truncate ${
                visible ? "text-[#8ec5ff]" : "text-[#a0a0a0]"
              }`}
            >
              {agent.label}
            </button>
            {visible ? (
              visibleIds.length > 1 && (
                <button
                  type="button"
                  onClick={() => onHide(agent.id)}
                  className="inline-flex h-6 w-6 items-center justify-center rounded-md text-[#6e6e6e] hover:text-[#f07070] border border-transparent hover:border-[#2b2b2b]"
                  title={`Hide ${agent.label}`}
                  aria-label={`Hide ${agent.label}`}
                >
                  <X className="h-3.5 w-3.5" strokeWidth={1.75} />
                </button>
              )
            ) : (
              <button
                type="button"
                onClick={() => onShow(agent.id)}
                className="h-6 px-2 rounded-md text-[11px] border border-[#2b2b2b] text-[#a0a0a0] hover:text-[#e4e4e4]"
              >
                Show
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
