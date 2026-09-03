"use client";

import { useEffect, useState } from "react";
import { Radio, SendHorizontal } from "lucide-react";
import type { AgentInfo, AgentRunStatus } from "../../shared/events";
import SplitAgentPicker from "./SplitAgentPicker";

export default function SplitViewMenu({
  open,
  agents,
  visibleIds,
  statusByAgent,
  broadcastEnabled,
  connected,
  onShow,
  onHide,
  onFocus,
  onBroadcast,
}: {
  open: boolean;
  agents: AgentInfo[];
  visibleIds: string[];
  statusByAgent: Record<string, AgentRunStatus>;
  broadcastEnabled: boolean;
  connected: boolean;
  onShow: (id: string) => void;
  onHide: (id: string) => void;
  onFocus?: (id: string) => void;
  onBroadcast: (text: string) => void;
}) {
  const [broadcast, setBroadcast] = useState("");

  useEffect(() => {
    if (!open) setBroadcast("");
  }, [open]);

  if (!open) return null;

  const send = () => {
    const text = broadcast.replace(/^\s+|\s+$/g, "");
    if (!text) return;
    onBroadcast(text);
    setBroadcast("");
  };

  return (
    <div
      className="absolute left-0 top-[calc(100%+6px)] z-40 w-[min(22rem,calc(100vw-1.5rem))] rounded-lg border border-[#2b2b2b] bg-[#1a1a1a] shadow-xl"
      role="dialog"
      aria-label="Split view"
    >
      <div className="px-3 pt-2.5 pb-2">
        <p className="text-[11px] uppercase tracking-wide text-[#6e6e6e] mb-2">
          Visible agents
        </p>
        <SplitAgentPicker
          agents={agents}
          visibleIds={visibleIds}
          statusByAgent={statusByAgent}
          onShow={onShow}
          onHide={onHide}
          onFocus={onFocus}
        />
      </div>
      {broadcastEnabled && (
        <div className="border-t border-[#2b2b2b] px-3 py-2.5 space-y-2">
          <p className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-[#8ec5ff]">
            <Radio className="h-3.5 w-3.5" strokeWidth={1.75} />
            Broadcast
          </p>
          <div className="flex items-center gap-2">
            <input
              value={broadcast}
              onChange={(e) => setBroadcast(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              placeholder={`Message ${visibleIds.length} agents…`}
              className="flex-1 h-9 min-w-0 rounded-lg bg-[#202020] border border-[#2b2b2b] px-3 text-[13px] text-[#e4e4e4] placeholder:text-[#6e6e6e] outline-none focus:border-[#4d9fff]"
            />
            <button
              type="button"
              disabled={!broadcast.trim() || !connected}
              onClick={send}
              className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-[#e4e4e4] text-[#141414] hover:bg-white disabled:opacity-30"
              aria-label="Broadcast message"
            >
              <SendHorizontal className="h-4 w-4" strokeWidth={2} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
