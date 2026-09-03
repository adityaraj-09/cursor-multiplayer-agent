"use client";

import { createContext, useContext, type Dispatch, type RefObject, type SetStateAction } from "react";
import type { AppSocket } from "../../lib/socket";
import type { RoomAttention } from "../../../shared/roomAttention";
import type {
  AgentConflict,
  AgentConflictBlocked,
  AgentInfo,
  AgentRunStatus,
  ApprovalMode,
  ApprovalRequestInfo,
  ChatMessage,
  CloudMeta,
  ControlMode,
  FileLease,
  ModelInfo,
  Participant,
  PingInfo,
  RoomInfo,
  RoomMemberInfo,
  TypingUser,
} from "../../../shared/events";
import type { AutoMemoryMode, RoomContextSnapshot } from "../../../shared/roomContext";
import type { RoomRole } from "../../../shared/roomPermissions";

export type RoomVariant = "page" | "tile" | "focus";

export type RoomContextValue = {
  variant: RoomVariant;
  homeHref: string;
  onHome?: () => void;
  onExpand?: () => void;
  onRemove?: () => void;
  roomId: string;
  userName: string;
  roomInfo: RoomInfo | null;
  onRoomInfo: (info: RoomInfo) => void;
  userId?: string;
  socket: AppSocket | null;
  connected: boolean;
  participants: Participant[];
  liveMembers: RoomMemberInfo[];
  amDriver: boolean;
  mySocketId: string | null;
  messages: ChatMessage[];
  agents: AgentInfo[];
  statusByAgent: Record<string, AgentRunStatus>;
  errorByAgent: Record<string, string>;
  diffByAgent: Record<string, string>;
  conflicts: AgentConflict[];
  fileLocks: FileLease[];
  lastBlocked: AgentConflictBlocked | null;
  pendingApprovals: ApprovalRequestInfo[];
  openPings: PingInfo[];
  typingByAgent: Record<string, TypingUser[]>;
  agentStatus: AgentRunStatus;
  agentError: string;
  pendingRequest: { socketId: string; name: string; agentId?: string } | null;
  pendingOutgoingDrive: { agentId?: string } | null;
  lastDiff: string;
  cloudMeta: CloudMeta | null;
  sendSteer: (text: string, agentId?: string, attachmentIds?: string[]) => void;
  revertChanges: (opts?: {
    agentId?: string;
    filePaths?: string[];
    messageId?: string;
  }) => void;
  notifyTyping: (agentId: string) => void;
  notifyTypingStop: (agentId?: string) => void;
  requestDrive: (agentId?: string) => void;
  releaseDrive: (agentId?: string) => void;
  approvePlan: (messageId: string, agentId?: string) => void;
  dismissPlan: (messageId: string) => void;
  flagReview: (payload: { note?: string; targetUserIds?: string[] }) => void;
  ackReview: (pingId: string) => void;
  dismissReview: (pingId: string) => void;
  leaveRoom: () => void;
  dismissDriveRequest: () => void;
  drivingAgentIds: string[];
  roomContext: RoomContextSnapshot | null;
  contextStale: {
    agentId: string;
    usedVersion: number;
    currentVersion: number;
  } | null;
  autoMemoryNotice: { agentId: string; count: number } | null;
  runtime: "local" | "cloud";
  controlMode: ControlMode;
  approvalMode: ApprovalMode;
  autoMemory: AutoMemoryMode;
  myRole: RoomRole;
  amHost: boolean;
  canManage: boolean;
  canFlag: boolean;
  canEditMemory: boolean;
  models: ModelInfo[];
  modelError: string;
  savingModel: boolean;
  savingControlMode: boolean;
  savingApprovalMode: boolean;
  savingAutoMemory: boolean;
  togglingPlanMode: boolean;
  decidingApprovalId: string | null;
  flagOpen: boolean;
  setFlagOpen: Dispatch<SetStateAction<boolean>>;
  slackOpen: boolean;
  setSlackOpen: Dispatch<SetStateAction<boolean>>;
  settingsOpen: boolean;
  setSettingsOpen: Dispatch<SetStateAction<boolean>>;
  inviteOpen: boolean;
  setInviteOpen: Dispatch<SetStateAction<boolean>>;
  rosterOpen: boolean;
  setRosterOpen: Dispatch<SetStateAction<boolean>>;
  rosterMembers: RoomMemberInfo[];
  setRosterMembers: Dispatch<SetStateAction<RoomMemberInfo[]>>;
  exporting: boolean;
  agentsOpen: boolean;
  setAgentsOpen: Dispatch<SetStateAction<boolean>>;
  changesOpen: boolean;
  setChangesOpen: Dispatch<SetStateAction<boolean>>;
  memoryOpen: boolean;
  setMemoryOpen: Dispatch<SetStateAction<boolean>>;
  addAgentOpen: boolean;
  setAddAgentOpen: Dispatch<SetStateAction<boolean>>;
  cursorSessionError: string;
  savingCursorSession: boolean;
  actionError: string;
  stopping: boolean;
  aborting: boolean;
  selectedAgentId: string | null;
  setSelectedAgentId: Dispatch<SetStateAction<string | null>>;
  chatFilterAgentId: string | null;
  setChatFilterAgentId: Dispatch<SetStateAction<string | null>>;
  viewMode: "tabs" | "split";
  setViewMode: Dispatch<SetStateAction<"tabs" | "split">>;
  visibleIds: string[];
  setVisibleIds: Dispatch<SetStateAction<string[]>>;
  broadcastEnabled: boolean;
  splitViewMenuOpen: boolean;
  setSplitViewMenuOpen: Dispatch<SetStateAction<boolean>>;
  splitViewRef: RefObject<HTMLDivElement | null>;
  selectedAgent: AgentInfo | null;
  selectedBackend: string;
  selectedModelId: string;
  selectedStatus: AgentRunStatus;
  selectedDiff: string;
  amDrivingSelected: boolean;
  canSteerSelected: boolean;
  steerLockReason: string | null;
  showDriverControls: boolean;
  splitActive: boolean;
  splitPool: AgentInfo[];
  relevantPings: PingInfo[];
  attention: RoomAttention | null;
  unreadCount: number;
  handleBroadcastEnabledChange: (enabled: boolean) => void;
  handleShowSplitAgent: (id: string) => void;
  handleHideSplitAgent: (id: string) => void;
  handleFocusSplitAgent: (id: string) => void;
  handleBroadcast: (text: string) => void;
  handleModelChangeForAgent: (agentId: string, next: string) => Promise<void>;
  handleModelChange: (next: string) => Promise<void>;
  handleCursorSessionChange: (next: string | null) => Promise<void>;
  handleGrantDrive: () => void;
  handleStopSession: () => Promise<void>;
  handleAbortRun: () => Promise<void>;
  handleAddAgent: (data: {
    label: string;
    backend: "cursor" | "claude-code";
    scopePath?: string;
    modelId?: string;
    anthropicApiKey?: string;
    apiKey?: string;
    planMode?: boolean;
    seedContext?: boolean;
  }) => Promise<void>;
  handleStopAgent: (agentId: string) => Promise<void>;
  handleForceRelease: (path: string) => Promise<void>;
  handleControlModeChange: (mode: ControlMode) => Promise<void>;
  handleApprovalModeChange: (mode: ApprovalMode) => Promise<void>;
  handleAutoMemoryChange: (mode: AutoMemoryMode) => Promise<void>;
  handleTogglePlanMode: () => Promise<void>;
  handleDecideApproval: (requestId: string, approved: boolean) => void;
  handleExport: () => Promise<void>;
  handleAnswerQuestions: (
    messageId: string,
    answers: Record<string, string>,
  ) => void;
};

const RoomContext = createContext<RoomContextValue | null>(null);

export function RoomContextProvider({
  value,
  children,
}: {
  value: RoomContextValue;
  children: React.ReactNode;
}) {
  return <RoomContext.Provider value={value}>{children}</RoomContext.Provider>;
}

export function useRoomContext(): RoomContextValue {
  const ctx = useContext(RoomContext);
  if (!ctx) {
    throw new Error("useRoomContext must be used within RoomProvider");
  }
  return ctx;
}
