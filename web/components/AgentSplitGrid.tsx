"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Crown,
  Maximize2,
  Minimize2,
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
import { isFeatureAgent } from "../../shared/events";
import { resolveAgentRunStatus } from "../../shared/agentRunStatus";
import IntegrateButton, { integrateButtonState } from "./IntegrateButton";
import type { IntegrationJobInfo } from "../../shared/events";
import { formatTypingIndicator } from "../../shared/typing";
import {
  canSteerWithRole,
  steerDeniedReason,
  type RoomRole,
} from "../../shared/roomPermissions";
import { closeVisibleId } from "../lib/splitViewSettings";
import ChatPanel from "./ChatPanel";
import SteerInput from "./SteerInput";

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
  onSend,
  onTyping,
  onTypingStop,
  onModelChange,
  onApprovePlan,
  onDismissPlan,
  onAnswerQuestions,
  onRevertMessage,
  visibleIds,
  onVisibleIdsChange,
  canIntegrate,
  integrationJob,
  hasIntegrationPr,
  singleAgent,
  onIntegrate,
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
  onSend: (text: string, agentId: string, attachmentIds?: string[]) => void;
  onTyping?: (agentId: string) => void;
  onTypingStop?: (agentId?: string) => void;
  onModelChange: (agentId: string, modelId: string) => void;
  onApprovePlan?: (messageId: string, agentId?: string) => void;
  onDismissPlan?: (messageId: string) => void;
  onAnswerQuestions?: (messageId: string, answers: Record<string, string>) => void;
  onRevertMessage?: (messageId: string, agentId?: string) => void;
  visibleIds: string[];
  onVisibleIdsChange: (ids: string[]) => void;
  canIntegrate?: boolean;
  integrationJob?: IntegrationJobInfo | null;
  hasIntegrationPr?: boolean;
  singleAgent?: boolean;
  onIntegrate?: (agentId: string) => void;
}) {
  const liveAgents = useMemo(
    () => agents.filter((a) => a.status !== "stopped"),
    [agents],
  );
  const pool = liveAgents.length ? liveAgents : agents;

  const [enlargedId, setEnlargedId] = useState<string | null>(null);

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

  const closePane = (id: string) => {
    onVisibleIdsChange(closeVisibleId(visibleIds, id));
    setEnlargedId((cur) => (cur === id ? null : cur));
  };

  return (
    <div className="flex-1 min-h-0 min-w-0 flex flex-col overflow-hidden">
      <div
        className={`flex-1 min-h-0 grid gap-px bg-[#2b2b2b] overflow-hidden ${gridClass(
          shownAgents.length,
          Boolean(enlargedId),
        )}`}
      >
        {shownAgents.map((agent) => {
          const status = resolveAgentRunStatus(agent, statusByAgent);
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
                {canIntegrate &&
                  onIntegrate &&
                  isFeatureAgent(agent) &&
                  Boolean(agent.branch) && (
                    <IntegrateButton
                      compact
                      hasPr={Boolean(hasIntegrationPr || agent.prUrl)}
                      singleAgent={singleAgent}
                      state={integrateButtonState(agent.id, integrationJob)}
                      queuedBehind={integrationJob?.sourceLabel}
                      disabled={status === "running"}
                      onClick={() => onIntegrate(agent.id)}
                    />
                  )}
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
    </div>
  );
}
