"use client";

import Link from "next/link";
import {
  Columns2,
  Eye,
  Home,
  LayoutGrid,
  LayoutList,
  Maximize2,
  Settings2,
  Square,
  X,
} from "lucide-react";
import ChatPanel from "../ChatPanel";
import ApprovalCard from "../ApprovalCard";
import PresenceBar from "../PresenceBar";
import SteerInput from "../SteerInput";
import CursorSessionPicker from "../CursorSessionPicker";
import DriverControls from "../DriverControls";
import AgentTabs from "../AgentTabs";
import AgentSplitGrid from "../AgentSplitGrid";
import SplitViewMenu from "../SplitViewMenu";
import LockPanel from "../LockPanel";
import ReviewPingBanner from "../ReviewPingBanner";
import AttentionBadge from "../board/AttentionBadge";
import {
  formatTypingIndicator,
  formatTypingIndicatorAll,
} from "../../../shared/typing";
import { useRoomContext } from "./RoomContext";

export default function RoomChatPane() {
  const ctx = useRoomContext();
  const {
    variant,
    homeHref,
    onHome,
    onExpand,
    onRemove,
    roomId,
    roomInfo,
    userId,
    connected,
    participants,
    mySocketId,
    messages,
    agents,
    statusByAgent,
    typingByAgent,
    pendingApprovals,
    drivingAgentIds,
    amDriver,
    pendingRequest,
    pendingOutgoingDrive,
    sendSteer,
    revertChanges,
    notifyTyping,
    notifyTypingStop,
    requestDrive,
    releaseDrive,
    approvePlan,
    dismissPlan,
    ackReview,
    dismissReview,
    dismissDriveRequest,
    roomContext,
    contextStale,
    autoMemoryNotice,
    runtime,
    myRole,
    controlMode,
    canManage,
    models,
    modelError,
    savingModel,
    decidingApprovalId,
    setSettingsOpen,
    setAddAgentOpen,
    setMemoryOpen,
    cursorSessionError,
    savingCursorSession,
    actionError,
    aborting,
    selectedAgentId,
    setSelectedAgentId,
    chatFilterAgentId,
    setChatFilterAgentId,
    viewMode,
    setViewMode,
    visibleIds,
    setVisibleIds,
    broadcastEnabled,
    splitViewMenuOpen,
    setSplitViewMenuOpen,
    splitViewRef,
    selectedAgent,
    selectedBackend,
    selectedModelId,
    selectedStatus,
    amDrivingSelected,
    canSteerSelected,
    steerLockReason,
    showDriverControls,
    splitActive,
    splitPool,
    relevantPings,
    attention,
    handleShowSplitAgent,
    handleHideSplitAgent,
    handleFocusSplitAgent,
    handleBroadcast,
    handleModelChangeForAgent,
    handleModelChange,
    handleCursorSessionChange,
    handleGrantDrive,
    handleAbortRun,
    handleStopAgent,
    handleForceRelease,
    handleDecideApproval,
    handleAnswerQuestions,
    conflicts,
    fileLocks,
    lastBlocked,
    agentError,
  } = ctx;

  const activeMemoryCount = (roomContext?.entries || []).filter(
    (e) => e.status === "active",
  ).length;
  const proposedMemoryCount = (roomContext?.entries || []).filter(
    (e) => e.status === "proposed",
  ).length;

  const shellClass =
    variant === "page"
      ? "room-shell fixed inset-0 h-[100dvh] max-h-[100dvh] w-full flex flex-col bg-[#111111] text-[#e4e4e4] overflow-hidden overscroll-none"
      : "h-full min-h-0 w-full flex flex-col bg-[#111111] text-[#e4e4e4] overflow-hidden";

  const chat = splitActive ? (
    <AgentSplitGrid
      agents={agents}
      messages={messages}
      roomId={roomId}
      statusByAgent={statusByAgent}
      typingByAgent={typingByAgent}
      drivingAgentIds={drivingAgentIds}
      myRole={myRole}
      controlMode={controlMode}
      connected={connected}
      models={models}
      canManage={canManage}
      savingModel={savingModel}
      onSend={(text, agentId, attachmentIds) =>
        sendSteer(text, agentId, attachmentIds)
      }
      onTyping={notifyTyping}
      onTypingStop={notifyTypingStop}
      onModelChange={(agentId, modelId) =>
        void handleModelChangeForAgent(agentId, modelId)
      }
      onApprovePlan={(messageId, agentId) => approvePlan(messageId, agentId)}
      onDismissPlan={(messageId) => dismissPlan(messageId)}
      onAnswerQuestions={handleAnswerQuestions}
      onRevertMessage={(messageId, agentId) => {
        revertChanges({ messageId, agentId });
      }}
      visibleIds={visibleIds}
      onVisibleIdsChange={setVisibleIds}
    />
  ) : (
    <ChatPanel
      messages={messages}
      agentStatus={selectedStatus}
      agents={agents}
      filterAgentId={agents.length > 1 && variant !== "tile" ? chatFilterAgentId : null}
      roomId={roomId}
      canApprovePlan={canSteerSelected}
      onApprovePlan={(messageId, agentId) => approvePlan(messageId, agentId)}
      onDismissPlan={(messageId) => dismissPlan(messageId)}
      onAnswerQuestions={handleAnswerQuestions}
      onRevertMessage={(messageId, agentId) => {
        revertChanges({ messageId, agentId });
      }}
    />
  );

  if (variant === "tile") {
    return (
      <div className={shellClass}>
        <header className="shrink-0 flex items-center gap-2 px-2.5 h-10 border-b border-[#2b2b2b] bg-[#171717]">
          <button
            type="button"
            onClick={onExpand}
            className="min-w-0 flex-1 text-left"
            title="Focus this session"
          >
            <span className="block text-[12px] font-medium text-[#f0f0f0] truncate">
              {roomInfo?.name || roomId}
            </span>
          </button>
          <AttentionBadge attention={attention} />
          <button
            type="button"
            onClick={onExpand}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[#6e6e6e] hover:text-[#e4e4e4] border border-[#2b2b2b]"
            title="Focus session"
          >
            <Maximize2 className="h-3.5 w-3.5" strokeWidth={1.75} />
          </button>
          {onRemove && (
            <button
              type="button"
              onClick={onRemove}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[#6e6e6e] hover:text-[#f07070] border border-[#2b2b2b]"
              title="Remove from board"
            >
              <X className="h-3.5 w-3.5" strokeWidth={1.75} />
            </button>
          )}
        </header>
        <div className="flex-1 min-h-0">{chat}</div>
      </div>
    );
  }

  return (
    <div className={shellClass}>
      {variant === "page" && (
        <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(circle_at_20%_0%,rgba(77,159,255,0.07),transparent_28%),radial-gradient(circle_at_84%_12%,rgba(62,207,142,0.045),transparent_26%)]" />
      )}

      <header className="relative z-20 shrink-0 border-b border-[#2b2b2b]/90 bg-[#171717]/95 backdrop-blur-xl pt-[env(safe-area-inset-top)]">
        <div className="flex items-center justify-between gap-3 px-3 sm:px-4 h-12">
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            {onHome ? (
              <button
                type="button"
                onClick={onHome}
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#2b2b2b] bg-[#1f1f1f] text-[#a0a0a0] hover:text-[#e4e4e4] hover:border-[#3c3c3c] transition-colors shrink-0"
                aria-label="Back to board"
              >
                <LayoutGrid className="h-4 w-4" strokeWidth={1.75} />
              </button>
            ) : (
              <Link
                href={homeHref}
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#2b2b2b] bg-[#1f1f1f] text-[#a0a0a0] hover:text-[#e4e4e4] hover:border-[#3c3c3c] transition-colors shrink-0"
                aria-label="Go to dashboard"
              >
                <Home className="h-4 w-4" strokeWidth={1.75} />
              </Link>
            )}
            <h1 className="text-[13px] sm:text-[14px] font-medium text-[#f0f0f0] truncate min-w-0">
              {roomInfo?.name || roomId}
            </h1>
            <AttentionBadge attention={attention} />
            {agents.length > 1 && (
              <div className="inline-flex items-center gap-1.5 shrink-0">
                <div className="inline-flex items-center rounded-lg border border-[#2b2b2b] bg-[#1a1a1a] p-0.5">
                  <button
                    type="button"
                    onClick={() => setViewMode("split")}
                    className={`inline-flex h-7 items-center gap-1 px-2 rounded-md text-[11px] ${
                      viewMode === "split"
                        ? "bg-[#252525] text-[#e4e4e4]"
                        : "text-[#8a8a8a] hover:text-[#c8c8c8]"
                    }`}
                    title="Split agents"
                  >
                    <Columns2 className="h-3.5 w-3.5" strokeWidth={1.75} />
                    Split
                  </button>
                  <button
                    type="button"
                    onClick={() => setViewMode("tabs")}
                    className={`inline-flex h-7 items-center gap-1 px-2 rounded-md text-[11px] ${
                      viewMode === "tabs"
                        ? "bg-[#252525] text-[#e4e4e4]"
                        : "text-[#8a8a8a] hover:text-[#c8c8c8]"
                    }`}
                    title="One agent at a time"
                  >
                    <LayoutList className="h-3.5 w-3.5" strokeWidth={1.75} />
                    Tabs
                  </button>
                </div>
                {splitActive && (
                  <div className="relative" ref={splitViewRef}>
                    <button
                      type="button"
                      onClick={() => setSplitViewMenuOpen((open) => !open)}
                      aria-expanded={splitViewMenuOpen}
                      aria-haspopup="dialog"
                      className={`inline-flex h-8 w-8 items-center justify-center rounded-lg border transition-colors ${
                        splitViewMenuOpen
                          ? "border-[#26405d] bg-[#17202a] text-[#8ec5ff]"
                          : "border-[#2b2b2b] bg-[#1f1f1f] text-[#a0a0a0] hover:text-[#e4e4e4] hover:border-[#3c3c3c]"
                      }`}
                      title="Visible agents"
                    >
                      <Eye className="h-3.5 w-3.5" strokeWidth={1.75} />
                    </button>
                    <SplitViewMenu
                      open={splitViewMenuOpen}
                      agents={splitPool}
                      visibleIds={visibleIds}
                      statusByAgent={statusByAgent}
                      broadcastEnabled={broadcastEnabled}
                      connected={connected}
                      onShow={handleShowSplitAgent}
                      onHide={handleHideSplitAgent}
                      onFocus={handleFocusSplitAgent}
                      onBroadcast={handleBroadcast}
                    />
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[#a0a0a0] hover:text-[#e4e4e4] border border-[#2b2b2b] hover:border-[#3c3c3c] bg-[#1f1f1f] transition-colors"
              title="Room settings"
            >
              <Settings2 className="h-3.5 w-3.5" strokeWidth={1.75} />
            </button>
            {selectedStatus === "running" && canSteerSelected && (
              <button
                type="button"
                onClick={() => void handleAbortRun()}
                disabled={aborting}
                className="inline-flex h-8 items-center gap-1.5 px-2.5 rounded-lg text-[11px] text-[#f07070] hover:text-[#ff8a8a] border border-[#3c2b2b] hover:border-[#5a3a3a] bg-[#1f1818] transition-colors disabled:opacity-50"
              >
                <Square className="h-3 w-3" strokeWidth={2} />
                <span className="hidden sm:inline">
                  {aborting ? "Stopping…" : "Abort"}
                </span>
              </button>
            )}
            <PresenceBar
              onlyMe
              participants={participants}
              mySocketId={mySocketId}
              amHost={canManage}
            />
            {showDriverControls && (
              <DriverControls
                amDriver={amDrivingSelected}
                canGrant={canManage || amDrivingSelected}
                pendingRequest={
                  !pendingRequest?.agentId ||
                  pendingRequest.agentId === selectedAgentId
                    ? (pendingRequest?.name ?? null)
                    : null
                }
                pendingOutgoing={
                  Boolean(pendingOutgoingDrive) &&
                  (!pendingOutgoingDrive?.agentId ||
                    pendingOutgoingDrive.agentId === selectedAgentId)
                }
                onRequestDrive={() => requestDrive(selectedAgentId || undefined)}
                onReleaseDrive={() => releaseDrive(selectedAgentId || undefined)}
                onGrantDrive={handleGrantDrive}
                onDismissRequest={dismissDriveRequest}
              />
            )}
          </div>
        </div>
      </header>

      <LockPanel
        conflicts={conflicts}
        fileLocks={fileLocks}
        agents={agents}
        currentAgentId={selectedAgentId}
        amHost={canManage}
        lastBlocked={lastBlocked}
        onForceRelease={handleForceRelease}
      />

      <main className="relative z-10 flex flex-1 min-h-0 min-w-0 overflow-hidden overscroll-none">
        {!splitActive && (
          <AgentTabs
            agents={agents}
            selectedAgentId={selectedAgentId}
            chatFilterAgentId={chatFilterAgentId}
            onSelectAgent={(id) => {
              setSelectedAgentId(id);
              setChatFilterAgentId(id);
            }}
            onSelectAll={() => setChatFilterAgentId(null)}
            statusByAgent={statusByAgent}
            participants={participants}
            models={models}
            amHost={canManage}
            onAddAgent={() => setAddAgentOpen(true)}
            onStopAgent={(id) => void handleStopAgent(id)}
          />
        )}

        <div className="flex-1 flex flex-col min-h-0 min-w-0 overflow-hidden bg-[#121212]/80">
          {relevantPings.length > 0 && (
            <div
              id="review-pings"
              className="shrink-0 border-b border-[#3a2a1c] bg-[#14110e] px-3 py-2 space-y-2 max-h-[35%] overflow-y-auto"
            >
              {relevantPings.map((ping) => (
                <ReviewPingBanner
                  key={ping.id}
                  ping={ping}
                  myUserId={userId}
                  canDismiss={
                    canManage || Boolean(userId && ping.actorUserId === userId)
                  }
                  onAck={() => ackReview(ping.id)}
                  onDismiss={() => dismissReview(ping.id)}
                />
              ))}
            </div>
          )}
          {pendingApprovals.length > 0 && (
            <div className="shrink-0 border-b border-[#2e2a1c] bg-[#16140f] px-3 py-2 space-y-2 max-h-[40%] overflow-y-auto">
              {pendingApprovals.map((req) => {
                const drivingThis =
                  drivingAgentIds.includes(req.agentId) ||
                  (agents.length <= 1 && amDriver);
                const canDecide =
                  (myRole === "owner" || myRole === "editor") &&
                  (myRole === "owner" || !drivingThis);
                return (
                  <ApprovalCard
                    key={req.id}
                    request={req}
                    canDecide={canDecide}
                    deciding={decidingApprovalId === req.id}
                    onDecide={(approved) =>
                      handleDecideApproval(req.id, approved)
                    }
                  />
                );
              })}
            </div>
          )}
          {chat}
        </div>
      </main>

      {splitActive &&
        (modelError || cursorSessionError || actionError || agentError) && (
          <p className="relative z-20 shrink-0 px-3 py-2 text-[11px] text-[#f07070] border-t border-[#2b2b2b] bg-[#171717]">
            {actionError || agentError || modelError || cursorSessionError}
          </p>
        )}
      {!splitActive && (
        <footer className="relative z-20 border-t border-[#2b2b2b]/90 bg-[#171717]/95 backdrop-blur-xl shrink-0 overflow-hidden pb-[env(safe-area-inset-bottom)] shadow-[0_-20px_60px_rgba(0,0,0,0.24)]">
          {(modelError || cursorSessionError || actionError || agentError) && (
            <p className="px-3 pt-2 text-[11px] text-[#f07070]">
              {actionError || agentError || modelError || cursorSessionError}
            </p>
          )}
          {runtime === "local" &&
            roomInfo?.authMode === "cli" &&
            roomInfo.repoPath &&
            selectedBackend !== "claude-code" && (
              <div className="px-2 sm:px-3 pt-2">
                <CursorSessionPicker
                  roomId={roomId}
                  repoPath={roomInfo.repoPath}
                  cursorSessionId={
                    selectedAgent?.sessionId || roomInfo.cursorSessionId
                  }
                  disabled={selectedStatus === "running" || savingCursorSession}
                  canChange={canManage}
                  onSessionChange={(id) => void handleCursorSessionChange(id)}
                />
                <p className="text-[10px] text-[#6e6e6e] mt-1 px-0.5">
                  {selectedAgent?.sessionId || roomInfo.cursorSessionId
                    ? "Next message resumes this agent’s Cursor chat."
                    : "First message starts a new Cursor chat; reopening this Steer session resumes it."}
                </p>
              </div>
            )}
          {runtime === "local" &&
            selectedBackend === "claude-code" &&
            selectedAgent?.sessionId && (
              <p className="px-3 pt-2 text-[10px] text-[#6e6e6e]">
                Claude Code resumes session {selectedAgent.sessionId.slice(0, 12)}…
                automatically on the next message.
              </p>
            )}
          <SteerInput
            onSend={(text, attachmentIds) =>
              sendSteer(text, selectedAgentId || undefined, attachmentIds)
            }
            roomId={roomId}
            planMode={Boolean(selectedAgent?.planMode)}
            agentBusy={selectedStatus === "running"}
            connected={connected}
            canSteer={canSteerSelected}
            steerLockReason={steerLockReason || undefined}
            models={models}
            modelId={selectedModelId}
            onModelChange={(id) => void handleModelChange(id)}
            modelDisabled={!canManage || savingModel}
            modelLockReason={
              !canManage
                ? "Only the host or a team admin can change the model"
                : savingModel
                  ? "Saving…"
                  : undefined
            }
            placeholder={
              !canSteerSelected
                ? steerLockReason || "View only"
                : selectedAgent
                  ? `Message ${selectedAgent.label}…`
                  : "Message the agent…"
            }
            agentName={selectedAgent?.label}
            agentId={selectedAgentId || undefined}
            onTyping={canSteerSelected ? notifyTyping : undefined}
            onTypingStop={canSteerSelected ? notifyTypingStop : undefined}
            typingIndicator={
              chatFilterAgentId === null && agents.length > 1
                ? formatTypingIndicatorAll(typingByAgent, agents)
                : selectedAgentId
                  ? formatTypingIndicator(
                      (typingByAgent[selectedAgentId] || []).map((t) => t.name),
                      selectedAgent?.label || "Agent",
                    )
                  : ""
            }
            contextHint={
              autoMemoryNotice
                ? `Saved ${autoMemoryNotice.count} auto memor${
                    autoMemoryNotice.count === 1 ? "y" : "ies"
                  }`
                : contextStale &&
                    selectedAgentId &&
                    contextStale.agentId === selectedAgentId
                  ? `Memory stale (v${contextStale.usedVersion} → v${contextStale.currentVersion})`
                  : proposedMemoryCount
                    ? `${proposedMemoryCount} memory proposal${proposedMemoryCount === 1 ? "" : "s"} to review`
                    : activeMemoryCount
                      ? `Using ${activeMemoryCount} shared memor${activeMemoryCount === 1 ? "y" : "ies"}`
                      : roomContext?.map?.status === "ready"
                        ? "Repo map ready"
                        : "Room memory"
            }
            onOpenContext={() => setMemoryOpen(true)}
          />
        </footer>
      )}
    </div>
  );
}
