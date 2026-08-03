import type { AgentBackendKind } from "./backends/types.js";
import type { ControlMode, RoomRole } from "./roomPermissions.js";

export type { ControlMode, RoomInviteRole, RoomRole } from "./roomPermissions.js";

export interface Participant {
  socketId: string;
  name: string;
  color: string;
  isDriver: boolean;
  /** Agent ids this participant currently drives. */
  drivingAgentIds?: string[];
  userId?: string;
  isOwner?: boolean;
  /** Effective collaboration role in this room. */
  role?: RoomRole;
}

export interface SteerLogEntry {
  sender: string;
  color: string;
  text: string;
  ts: number;
}

export type ChatRole = "user" | "assistant" | "tool" | "system";
export type ChatStatus = "streaming" | "done" | "error";
export type AgentRuntime = "local" | "cloud";
/** cli = local Cursor login (no API key). server/byok require a Cursor API key. */
export type AuthMode = "cli" | "server" | "byok";

export type AgentStatus =
  | "idle"
  | "running"
  | "waiting_input"
  | "stopped"
  | "error";

export interface AgentInfo {
  id: string;
  roomId: string;
  backend: AgentBackendKind;
  label: string;
  scopePath?: string;
  sessionId?: string;
  modelId: string;
  status: AgentStatus;
  createdBy?: string;
  createdAt: number;
  sortOrder?: number;
  sdkAgentId?: string;
  branch?: string;
  prUrl?: string;
}

export interface AgentConflict {
  paths: string[];
  agentIds: string[];
}

export interface FileLease {
  roomId: string;
  path: string;
  agentId: string;
  callId?: string;
  acquiredAt: number;
  expiresAt: number;
}

export interface AgentConflictBlocked {
  agentId: string;
  path: string;
  holderAgentId: string;
  action: "aborted" | "queued";
}

/** Structured todo item from TodoWrite / todo tools. */
export interface AgentTodoItem {
  id: string;
  content: string;
  status: "pending" | "in_progress" | "completed" | "cancelled";
}

export interface ChatMessage {
  id: string;
  roomId: string;
  role: ChatRole;
  content: string;
  senderName?: string;
  senderColor?: string;
  toolName?: string;
  /** Unified diff when this message is a file edit. */
  diffPatch?: string;
  /** Full todo list when this message is a TodoWrite / todo tool call. */
  todos?: AgentTodoItem[];
  status: ChatStatus;
  ts: number;
  /** Room-level agent that produced or received this message. */
  agentId?: string;
}

export interface CloudMeta {
  repoUrl?: string;
  startingRef?: string;
  branch?: string;
  prUrl?: string;
  autoCreatePR?: boolean;
}

export interface RoomInfo {
  id: string;
  name: string;
  repoPath: string;
  agentCommand: string;
  participantCount: number;
  status: string;
  createdAt: number;
  runtime: AgentRuntime;
  authMode: AuthMode;
  modelId: string;
  /** Who may steer agents in this room. */
  controlMode: ControlMode;
  repoUrl?: string;
  startingRef?: string;
  prUrl?: string;
  autoCreatePR?: boolean;
  keyHint?: string;
  ownerId?: string;
  /** Organization that owns this session (null/undefined = personal). */
  orgId?: string;
  orgName?: string;
  inviteCode?: string;
  /** Active Cursor CLI chat id for the room's default agent (--resume). */
  cursorSessionId?: string;
  /** Agents in this room (populated when available). */
  agents?: AgentInfo[];
  /** Caller's effective role when requested with auth. */
  myRole?: RoomRole;
}

export interface UserInfo {
  id: string;
  email: string;
  name: string;
}

export interface WorkerInfo {
  id: string;
  name: string;
  status: "online" | "offline" | "busy";
  lastSeenAt: number;
}

export interface ModelInfo {
  id: string;
  displayName: string;
  description?: string;
}

/** Cursor CLI chat session stored under ~/.cursor/chats for a workspace. */
export interface CursorChatSession {
  id: string;
  createdAt: number;
  updatedAt: number;
  hasConversation: boolean;
}

export interface RepoInfo {
  url: string;
}

export type AgentRunStatus = "idle" | "running" | "error";

/** Someone drafting a message to a specific agent in the room. */
export interface TypingUser {
  socketId: string;
  name: string;
  agentId: string;
}

export interface ServerToClientEvents {
  "chat-history": (messages: ChatMessage[]) => void;
  "chat-message": (message: ChatMessage) => void;
  "chat-delta": (id: string, content: string, status?: ChatStatus) => void;
  /** @deprecated Prefer agents snapshot + agent-status(agentId, …). Kept for single-agent rooms. */
  "agent-status": (
    statusOrAgentId: AgentRunStatus | string,
    detailOrStatus?: string | AgentRunStatus,
    detail?: string,
  ) => void;
  "cloud-meta": (meta: CloudMeta) => void;
  "model-updated": (modelId: string, agentId?: string) => void;
  "cursor-session-updated": (
    sessionIdOrAgentId: string | null,
    sessionId?: string | null,
  ) => void;
  presence: (participants: Participant[]) => void;
  /** Full-repo or per-agent concatenated patch. Second arg is agentId when multi-agent. */
  "diff-update": (patch: string, agentId?: string) => void;
  "steer-log": (entry: SteerLogEntry) => void;
  "steer-history": (entries: SteerLogEntry[]) => void;
  "drive-requested": (payload: {
    socketId: string;
    name: string;
    agentId?: string;
  }) => void;
  "drive-granted": (agentId?: string) => void;
  "drive-released": (agentId?: string) => void;
  agents: (agents: AgentInfo[]) => void;
  "agent-conflicts": (conflicts: AgentConflict[]) => void;
  "file-locks": (leases: FileLease[]) => void;
  "agent-conflict-blocked": (payload: AgentConflictBlocked) => void;
  /** Peer started / refreshed typing toward an agent. */
  typing: (payload: TypingUser) => void;
  /** Peer stopped typing (omit agentId to clear all agents for that socket). */
  "typing-stop": (payload: { socketId: string; agentId?: string }) => void;
  kicked: (reason: string) => void;
  /** Host changed room collaboration settings. */
  "control-mode-updated": (mode: ControlMode) => void;
  error: (message: string) => void;
}

export interface ClientToServerEvents {
  "steer-message": (textOrAgentId: string, text?: string) => void;
  /** Announce that this user is typing to an agent (clients should throttle). */
  typing: (agentId: string) => void;
  /** Stop typing indicator for one agent, or all agents when omitted. */
  "typing-stop": (agentId?: string) => void;
  "request-drive": (agentId?: string) => void;
  "release-drive": (agentId?: string) => void;
  "grant-drive": (toSocketIdOrAgentId: string, toSocketId?: string) => void;
  "leave-room": () => void;
  "remove-member": (userId: string) => void;
}

/** Worker ↔ Server events (Socket.IO /worker namespace) */
export interface WorkerToServerEvents {
  "worker:ready": (info: {
    workerId: string;
    machineName: string;
    activeRoomId?: string | null;
    busy?: boolean;
    /** Protocol 2+: concurrent multi-agent support. */
    protocol?: number;
    activeRuns?: Array<{ roomId: string; agentId: string }>;
  }) => void;
  "worker:agent-event": (data: {
    roomId: string;
    agentId?: string;
    event: AgentStreamEventPayload;
  }) => void;
  "worker:file-diff": (data: {
    roomId: string;
    agentId?: string;
    /** Tool call id — server maps to the chat tool message via toolMsgIds */
    callId: string;
    toolName: string;
    path: string;
    patch: string;
  }) => void;
  "worker:folder-picked": (data: {
    requestId: string;
    path: string | null;
    error?: string;
  }) => void;
  "worker:models-listed": (data: {
    requestId: string;
    models?: Array<{ id: string; displayName: string }>;
    error?: string;
  }) => void;
  "worker:sessions-listed": (data: {
    requestId: string;
    sessions?: CursorChatSession[];
    error?: string;
  }) => void;
  "worker:acquire-lock": (data: {
    requestId: string;
    roomId: string;
    agentId: string;
    path: string;
    callId?: string;
  }) => void;
  "worker:release-lock": (data: {
    roomId: string;
    agentId: string;
    path: string;
  }) => void;
}

export interface ServerToWorkerEvents {
  "worker:run-prompt": (data: {
    roomId: string;
    agentId?: string;
    prompt: string;
    repoPath: string;
    /** Scope-resolved working directory (defaults to repoPath). */
    cwd?: string;
    modelId: string;
    sessionId?: string | null;
    /** Agent CLI backend — defaults to cursor when omitted. */
    backend?: AgentBackendKind;
  }) => void;
  "worker:abort": (data: { roomId: string; agentId?: string }) => void;
  "worker:pick-folder": (data: { requestId: string }) => void;
  "worker:list-models": (data: { requestId: string }) => void;
  "worker:list-sessions": (data: {
    requestId: string;
    repoPath: string;
  }) => void;
  "worker:error": (message: string) => void;
  "worker:lock-result": (data: {
    requestId: string;
    granted: boolean;
    holderAgentId?: string;
  }) => void;
}

export interface AgentStreamEventPayload {
  kind: string;
  sessionId?: string;
  text?: string;
  callId?: string;
  name?: string;
  detail?: string;
  path?: string;
  /** Unified diff for edit tools (local git or synthetic from tool args). */
  diffPatch?: string;
  /** Structured todos for TodoWrite / todo tools. */
  todos?: AgentTodoItem[];
  message?: string;
  result?: string;
  parentCallId?: string;
  status?: string;
}

export const AVATAR_COLORS = [
  "#4d9fff",
  "#3ecf8e",
  "#e8a23a",
  "#c084fc",
  "#f07070",
  "#38bdf8",
  "#a3e635",
  "#fb7185",
];

export type { AgentBackendKind };
