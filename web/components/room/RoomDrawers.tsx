"use client";

import AgentTabs from "../AgentTabs";
import SidePanel from "../SidePanel";
import ContextPanel from "../ContextPanel";
import RoomSettingsDialog from "../RoomSettingsDialog";
import InvitePanel from "../InvitePanel";
import FlagForReviewDialog from "../FlagForReviewDialog";
import SlackConnectModal from "../SlackConnectModal";
import MemberRoster from "../MemberRoster";
import AddAgentDialog from "../AddAgentDialog";
import { fetchOrJoinRoom } from "../../lib/api";
import { useRoomContext } from "./RoomContext";

export default function RoomDrawers() {
  const {
    roomId,
    roomInfo,
    onRoomInfo,
    userId,
    socket,
    agents,
    statusByAgent,
    participants,
    liveMembers,
    selectedDiff,
    cloudMeta,
    flagReview,
    leaveRoom,
    roomContext,
    contextStale,
    runtime,
    controlMode,
    approvalMode,
    autoMemory,
    myRole,
    amHost,
    canManage,
    canFlag,
    canEditMemory,
    models,
    savingControlMode,
    savingApprovalMode,
    savingAutoMemory,
    togglingPlanMode,
    flagOpen,
    setFlagOpen,
    slackOpen,
    setSlackOpen,
    settingsOpen,
    setSettingsOpen,
    inviteOpen,
    setInviteOpen,
    rosterOpen,
    setRosterOpen,
    rosterMembers,
    setRosterMembers,
    exporting,
    agentsOpen,
    setAgentsOpen,
    changesOpen,
    setChangesOpen,
    memoryOpen,
    setMemoryOpen,
    addAgentOpen,
    setAddAgentOpen,
    stopping,
    selectedAgentId,
    setSelectedAgentId,
    chatFilterAgentId,
    setChatFilterAgentId,
    selectedAgent,
    selectedModelId,
    selectedStatus,
    splitPool,
    visibleIds,
    broadcastEnabled,
    handleBroadcastEnabledChange,
    handleShowSplitAgent,
    handleHideSplitAgent,
    handleFocusSplitAgent,
    handleStopAgent,
    handleControlModeChange,
    handleApprovalModeChange,
    handleAutoMemoryChange,
    handleTogglePlanMode,
    handleExport,
    handleStopSession,
    handleAddAgent,
  } = useRoomContext();

  return (
    <>
      {agentsOpen && (
        <AgentTabs
          agents={agents}
          selectedAgentId={selectedAgentId}
          chatFilterAgentId={chatFilterAgentId}
          onSelectAgent={(id) => {
            setSelectedAgentId(id);
            setChatFilterAgentId(id);
            setAgentsOpen(false);
          }}
          onSelectAll={() => {
            setChatFilterAgentId(null);
            setAgentsOpen(false);
          }}
          statusByAgent={statusByAgent}
          participants={participants}
          models={models}
          amHost={canManage}
          onAddAgent={() => {
            setAgentsOpen(false);
            setAddAgentOpen(true);
          }}
          onStopAgent={(id) => void handleStopAgent(id)}
          mobile
          onClose={() => setAgentsOpen(false)}
        />
      )}

      {changesOpen && (
        <SidePanel
          socket={socket}
          lastDiff={selectedDiff}
          runtime={runtime}
          cloudMeta={cloudMeta}
          prUrl={selectedAgent?.prUrl || roomInfo?.prUrl}
          agentId={selectedAgentId}
          mobile
          onClose={() => setChangesOpen(false)}
        />
      )}

      {memoryOpen && (
        <ContextPanel
          roomId={roomId}
          snapshot={roomContext}
          canEdit={canEditMemory}
          selectedAgentId={selectedAgentId}
          selectedAgentLabel={selectedAgent?.label}
          agentIdle={selectedStatus !== "running"}
          stale={contextStale}
          mobile
          onClose={() => setMemoryOpen(false)}
        />
      )}

      <RoomSettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        roomName={roomInfo?.name || roomId}
        roomId={roomId}
        myRole={myRole}
        controlMode={controlMode}
        approvalMode={approvalMode}
        autoMemory={autoMemory}
        canManage={canManage}
        amHost={amHost}
        selectedAgent={selectedAgent}
        slackConfigured={Boolean(roomInfo?.slackNotifyConfigured)}
        runtime={runtime}
        planModeBusy={togglingPlanMode}
        savingControlMode={savingControlMode}
        savingApprovalMode={savingApprovalMode}
        savingAutoMemory={savingAutoMemory}
        exporting={exporting}
        stopping={stopping}
        onControlModeChange={(mode) => void handleControlModeChange(mode)}
        onApprovalModeChange={(mode) => void handleApprovalModeChange(mode)}
        onAutoMemoryChange={(mode) => void handleAutoMemoryChange(mode)}
        onTogglePlanMode={() => void handleTogglePlanMode()}
        onOpenSlack={() => {
          setSettingsOpen(false);
          setSlackOpen(true);
        }}
        onOpenInvites={() => {
          setSettingsOpen(false);
          setInviteOpen(true);
        }}
        onExport={() => void handleExport()}
        onStopSession={() => void handleStopSession()}
        onLeave={() => {
          if (window.confirm("Leave this session?")) leaveRoom();
        }}
        onOpenAgents={() => {
          setSettingsOpen(false);
          setAgentsOpen(true);
        }}
        onOpenMemory={() => {
          setSettingsOpen(false);
          setMemoryOpen(true);
        }}
        onOpenChanges={() => {
          setSettingsOpen(false);
          setChangesOpen(true);
        }}
        onOpenMembers={() => {
          setSettingsOpen(false);
          setRosterOpen(true);
        }}
        onOpenFlag={
          canFlag
            ? () => {
                setSettingsOpen(false);
                setFlagOpen(true);
              }
            : undefined
        }
        splitAvailable={agents.length > 1}
        broadcastEnabled={broadcastEnabled}
        onBroadcastEnabledChange={handleBroadcastEnabledChange}
        splitAgents={splitPool}
        visibleAgentIds={visibleIds}
        statusByAgent={statusByAgent}
        onShowSplitAgent={handleShowSplitAgent}
        onHideSplitAgent={handleHideSplitAgent}
        onFocusSplitAgent={handleFocusSplitAgent}
      />

      <InvitePanel
        roomId={roomId}
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        canManage={canManage}
      />

      <FlagForReviewDialog
        open={flagOpen}
        onClose={() => setFlagOpen(false)}
        members={rosterMembers.length ? rosterMembers : liveMembers}
        myUserId={userId}
        slackConfigured={Boolean(roomInfo?.slackNotifyConfigured)}
        onFlag={(payload) => flagReview(payload)}
        onOpenSlack={() => {
          setFlagOpen(false);
          setSettingsOpen(true);
        }}
      />

      <SlackConnectModal
        roomId={roomId}
        open={slackOpen}
        onClose={() => setSlackOpen(false)}
        canManage={canManage}
        onUpdated={() => {
          void fetchOrJoinRoom(roomId).then(onRoomInfo).catch(() => {});
        }}
      />

      <MemberRoster
        roomId={roomId}
        open={rosterOpen}
        onClose={() => setRosterOpen(false)}
        canManage={canManage}
        myUserId={userId}
        liveMembers={rosterMembers.length ? rosterMembers : liveMembers}
        onMembersChange={setRosterMembers}
        agentLabels={Object.fromEntries(agents.map((a) => [a.id, a.label]))}
      />

      <AddAgentDialog
        open={addAgentOpen}
        onClose={() => setAddAgentOpen(false)}
        roomId={roomId}
        onSubmit={handleAddAgent}
        models={models}
        defaultModelId={selectedModelId}
        runtime={runtime}
        orgId={roomInfo?.orgId}
      />
    </>
  );
}
