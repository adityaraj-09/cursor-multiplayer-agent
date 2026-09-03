"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Crown,
  Maximize2,
  Minimize2,
  Radio,
  SendHorizontal,
  X,
} from "lucide-react";
import type {
  AgentInfo,
  AgentRunStatus,
  ChatMessage,
  ControlMode,
  ModelInfo,
  TypingUser,
} from "../../shared/events";
import { formatTypingIndicator } from "../../shared/typing";
import {
  canSteerWithRole,
  steerDeniedReason,
  type RoomRole,
} from "../../shared/roomPermissions";
import ChatPanel from "./ChatPanel";
import SteerInput from "./SteerInput";

const MAX_VISIBLE = 4;
const BROADCAST_KEY = "steer-broadcast-enabled";

function readBroadcastEnabled(): boolean {
  if (typeof window === "undefined") return true;
  try {
    const raw = window.localStorage.getItem(BROADCAST_KEY);
    if (raw === null) return true;
    return raw === "1";
  } catch {
    return true;
  }
}

function writeBroadcastEnabled(enabled: boolean): void {
  try {
    window.localStorage.setItem(BROADCAST_KEY, enabled ? "1" : "0");
  } catch {
    /* ignore quota / private mode */
  }
}

function gridClass(count: number, enlarged: boolean): string {
  if (enlarged || count <= 1) return "grid-cols-1";
  if (count === 2) return "grid-cols-1 lg:grid-cols-2";
  if (count === 3) return "grid-cols-1 lg:grid-cols-2 xl:grid-cols-3";
  return "grid-cols-1 md:grid-cols-2";
}

function statusTone(status: AgentRunStatus | string | undefined): string {
  if (status === "running") return "bg-[#3ecf8e] animate-pulse";
  if (status === "error") return "bg-[#f07070]";
  if (status === "stopped") return "bg-[#3c3c3c]";
  return "bg-[#6e6e6e]";
}

export default function AgentSplitGrid({
  agents,
  messages,
  roomId,
  statusByAgent,
  typingByAgent,
  drivingAgentIds,
  myRole,
  controlMode,
  connected,
  models,
  canManage,
  savingModel,
  selectedToolMessageId,
  onSelectToolMessage,
  onSend,
  onTyping,
  onTypingStop,
  onModelChange,
  onApprovePlan,
  onDismissPlan,
  onAnswerQuestions,
  onRevertMessage,
  onFocusAgent,
}: {
  agents: AgentInfo[];
  messages: ChatMessage[];
  roomId: string;
  statusByAgent: Record<string, AgentRunStatus>;
  typingByAgent: Record<string, TypingUser[]>;
  drivingAgentIds: string[];
  myRole: RoomRole;
  controlMode: ControlMode;
  connected: boolean;
  models: ModelInfo[];
  canManage: boolean;
  savingModel: boolean;
  selectedToolMessageId?: string | null;
  onSelectToolMessage?: (message: ChatMessage) => void;
  onSend: (text: string, agentId: string, attachmentIds?: string[]) => void;
  onTyping?: (agentId: string) => void;
  onTypingStop?: (agentId?: string) => void;
  onModelChange: (agentId: string, modelId: string) => void;
  onApprovePlan?: (messageId: string, agentId?: string) => void;
  onDismissPlan?: (messageId: string) => void;
  onAnswerQuestions?: (messageId: string, answers: Record<string, string>) => void;
  onRevertMessage?: (messageId: string, agentId?: string) => void;
  onFocusAgent?: (agentId: string) => void;
}) {
  const liveAgents = useMemo(
    () => agents.filter((a) => a.status !== "stopped"),
    [agents],
  );
  const pool = liveAgents.length ? liveAgents : agents;

  const [visibleIds, setVisibleIds] = useState<string[]>(() =>
    pool.slice(0, MAX_VISIBLE).map((a) => a.id),
  );
  const [enlargedId, setEnlargedId] = useState<string | null>(null);
  const [broadcast, setBroadcast] = useState("");
  const [broadcastEnabled, setBroadcastEnabled] = useState(true);

  useEffect(() => {
    queueMicrotask(() => setBroadcastEnabled(readBroadcastEnabled()));
  }, []);

  useEffect(() => {
    setVisibleIds((prev) => {
      const valid = prev.filter((id) => pool.some((a) => a.id === id));
      if (valid.length === 0) {
        return pool.slice(0, MAX_VISIBLE).map((a) => a.id);
      }
      return valid.slice(0, MAX_VISIBLE);
    });
  }, [pool]);

  useEffect(() => {
    if (enlargedId && !visibleIds.includes(enlargedId)) {
      setEnlargedId(null);
    }
  }, [enlargedId, visibleIds]);

  const visibleAgents = useMemo(() => {
    const byId = new Map(pool.map((a) => [a.id, a]));
    return visibleIds
      .map((id) => byId.get(id))
      .filter((a): a is AgentInfo => Boolean(a));
  }, [pool, visibleIds]);

  const shownAgents = enlargedId
    ? visibleAgents.filter((a) => a.id === enlargedId)
    : visibleAgents;

  const pinAgent = (id: string) => {
    setVisibleIds((prev) => {
      if (prev.includes(id)) return prev;
      if (prev.length < MAX_VISIBLE) return [...prev, id];
      return [...prev.slice(1), id];
    });
    onFocusAgent?.(id);
  };

  const closePane = (id: string) => {
    setVisibleIds((prev) => {
      if (prev.length <= 1) return prev;
      return prev.filter((item) => item !== id);
    });
    setEnlargedId((cur) => (cur === id ? null : cur));
  };

  const toggleBroadcast = () => {
    setBroadcastEnabled((prev) => {
      const next = !prev;
      writeBroadcastEnabled(next);
      return next;
    });
  };

  const sendBroadcast = () => {
    const text = broadcast.replace(/^\s+|\s+$/g, "");
    if (!text) return;
    for (const agent of visibleAgents) {
      const driving = drivingAgentIds.includes(agent.id);
      const canSteer = canSteerWithRole({
        role: myRole,
        controlMode,
        isDrivingAgent: driving,
      });
      if (!canSteer) continue;
      onSend(text, agent.id);
    }
    setBroadcast("");
  };

  return (
    <div className="flex-1 min-h-0 min-w-0 flex flex-col overflow-hidden">
      {pool.length > visibleIds.length && (
        <div className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 border-b border-[#2b2b2b] bg-[#151515] overflow-x-auto">
          <span className="text-[10px] uppercase tracking-[0.08em] text-[#6e6e6e] shrink-0">
            Visible
          </span>
          {pool.map((agent) => {
            const pinned = visibleIds.includes(agent.id);
            return (
              <div
                key={agent.id}
                className={`inline-flex items-center gap-1 h-7 pl-2 pr-1 rounded-md text-[11px] border shrink-0 ${
                  pinned
                    ? "border-[#26405d] bg-[#17202a] text-[#8ec5ff]"
                    : "border-[#2b2b2b] bg-[#1a1a1a] text-[#8a8a8a]"
                }`}
              >
                <button
                  type="button"
                  onClick={() => (pinned ? onFocusAgent?.(agent.id) : pinAgent(agent.id))}
                  className="inline-flex items-center gap-1.5 min-w-0"
                >
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${statusTone(statusByAgent[agent.id] || agent.status)}`}
                  />
                  {agent.label}
                </button>
                {pinned && visibleIds.length > 1 && (
                  <button
                    type="button"
                    onClick={() => closePane(agent.id)}
                    className="inline-flex h-5 w-5 items-center justify-center rounded text-[#6e6e6e] hover:text-[#f07070]"
                    title={`Close ${agent.label}`}
                    aria-label={`Close ${agent.label}`}
                  >
                    <X className="h-3 w-3" strokeWidth={1.75} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div
        className={`flex-1 min-h-0 grid gap-px bg-[#2b2b2b] overflow-hidden ${gridClass(
          shownAgents.length,
          Boolean(enlargedId),
        )}`}
      >
        {shownAgents.map((agent) => {
          const status =
            statusByAgent[agent.id] ||
            (agent.status === "running"
              ? "running"
              : agent.status === "error"
                ? "error"
                : "idle");
          const driving = drivingAgentIds.includes(agent.id);
          const canSteer = canSteerWithRole({
            role: myRole,
            controlMode,
            isDrivingAgent: driving,
          });
          const lockReason = steerDeniedReason({
            role: myRole,
            controlMode,
            isDrivingAgent: driving,
          });
          return (
            <section
              key={agent.id}
              className="min-h-0 min-w-0 flex flex-col bg-[#121212] overflow-hidden"
            >
              <div className="shrink-0 flex items-center gap-2 px-3 h-9 border-b border-[#2b2b2b] bg-[#171717]">
                <span
                  className={`h-2 w-2 rounded-full shrink-0 ${statusTone(status)}`}
                />
                <span className="text-[12px] font-medium text-[#e4e4e4] truncate min-w-0">
                  {agent.label}
                </span>
                {agent.planMode && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded border border-[#26405d] bg-[#17202a] text-[#8ec5ff] shrink-0">
                    Plan
                  </span>
                )}
                {driving && (
                  <span className="inline-flex items-center gap-1 text-[10px] text-[#e8a23a] shrink-0">
                    <Crown className="h-3 w-3" strokeWidth={1.75} />
                    Driving
                  </span>
                )}
                <span className="ml-auto text-[10px] text-[#6e6e6e] shrink-0">
                  {status === "running" ? "running" : status}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setEnlargedId((cur) => (cur === agent.id ? null : agent.id))
                  }
                  className="inline-flex h-6 w-6 items-center justify-center rounded-md text-[#6e6e6e] hover:text-[#e4e4e4] border border-[#2b2b2b]"
                  title={enlargedId === agent.id ? "Show all agents" : "Enlarge pane"}
                >
                  {enlargedId === agent.id ? (
                    <Minimize2 className="h-3.5 w-3.5" strokeWidth={1.75} />
                  ) : (
                    <Maximize2 className="h-3.5 w-3.5" strokeWidth={1.75} />
                  )}
                </button>
                {visibleAgents.length > 1 && (
                  <button
                    type="button"
                    onClick={() => closePane(agent.id)}
                    className="inline-flex h-6 w-6 items-center justify-center rounded-md text-[#6e6e6e] hover:text-[#f07070] border border-[#2b2b2b]"
                    title={`Close ${agent.label}`}
                    aria-label={`Close ${agent.label}`}
                  >
                    <X className="h-3.5 w-3.5" strokeWidth={1.75} />
                  </button>
                )}
              </div>
              <ChatPanel
                messages={messages}
                agentStatus={status}
                agents={agents}
                filterAgentId={agent.id}
                roomId={roomId}
                canApprovePlan={canSteer}
                onApprovePlan={onApprovePlan}
                onDismissPlan={onDismissPlan}
                selectedToolMessageId={selectedToolMessageId}
                onSelectToolMessage={onSelectToolMessage}
                onAnswerQuestions={onAnswerQuestions}
                onRevertMessage={onRevertMessage}
              />
              <div className="shrink-0 border-t border-[#2b2b2b] bg-[#171717]">
                <SteerInput
                  compact
                  onSend={(text, attachmentIds) =>
                    onSend(text, agent.id, attachmentIds)
                  }
                  roomId={roomId}
                  planMode={Boolean(agent.planMode)}
                  agentBusy={status === "running"}
                  connected={connected}
                  canSteer={canSteer}
                  steerLockReason={lockReason || undefined}
                  models={models}
                  modelId={agent.modelId || "auto"}
                  onModelChange={(id) => onModelChange(agent.id, id)}
                  modelDisabled={!canManage || savingModel}
                  modelLockReason={
                    !canManage
                      ? "Only the host or a team admin can change the model"
                      : savingModel
                        ? "Saving…"
                        : undefined
                  }
                  placeholder={
                    canSteer ? `Message ${agent.label}…` : lockReason || "View only"
                  }
                  agentName={agent.label}
                  agentId={agent.id}
                  onTyping={canSteer ? onTyping : undefined}
                  onTypingStop={canSteer ? onTypingStop : undefined}
                  typingIndicator={formatTypingIndicator(
                    (typingByAgent[agent.id] || []).map((t) => t.name),
                    agent.label,
                  )}
                />
              </div>
            </section>
          );
        })}
      </div>

      {!enlargedId && visibleAgents.length > 1 && (
        <div className="shrink-0 border-t border-[#2b2b2b] bg-[#171717] px-3 py-2 flex items-center gap-2">
          <button
            type="button"
            onClick={toggleBroadcast}
            aria-pressed={broadcastEnabled}
            className={`inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg text-[11px] border shrink-0 transition-colors ${
              broadcastEnabled
                ? "border-[#26405d] bg-[#17202a] text-[#8ec5ff]"
                : "border-[#2b2b2b] bg-[#1a1a1a] text-[#8a8a8a]"
            }`}
            title={
              broadcastEnabled
                ? "Broadcast is on — click to turn off"
                : "Broadcast is off — click to turn on"
            }
          >
            <Radio className="h-3.5 w-3.5" strokeWidth={1.75} />
            Broadcast
          </button>
          {broadcastEnabled && (
            <>
              <input
                value={broadcast}
                onChange={(e) => setBroadcast(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    sendBroadcast();
                  }
                }}
                placeholder={`Broadcast to ${visibleAgents.length} agents…`}
                className="flex-1 h-9 min-w-0 rounded-lg bg-[#202020] border border-[#2b2b2b] px-3 text-[13px] text-[#e4e4e4] placeholder:text-[#6e6e6e] outline-none focus:border-[#4d9fff]"
              />
              <button
                type="button"
                disabled={!broadcast.trim() || !connected}
                onClick={sendBroadcast}
                className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-[#e4e4e4] text-[#141414] hover:bg-white disabled:opacity-30"
                aria-label="Broadcast message"
              >
                <SendHorizontal className="h-4 w-4" strokeWidth={2} />
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
