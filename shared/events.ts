export interface Participant {
  socketId: string;
  name: string;
  color: string;
  isDriver: boolean;
  userId?: string;
  isOwner?: boolean;
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
  status: ChatStatus;
  ts: number;
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
  repoUrl?: string;
  startingRef?: string;
  prUrl?: string;
  autoCreatePR?: boolean;
  keyHint?: string;
  ownerId?: string;
  inviteCode?: string;
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

export interface RepoInfo {
  url: string;
}

export type AgentRunStatus = "idle" | "running" | "error";

export interface ServerToClientEvents {
  "chat-history": (messages: ChatMessage[]) => void;
  "chat-message": (message: ChatMessage) => void;
  "chat-delta": (id: string, content: string, status?: ChatStatus) => void;
  "agent-status": (status: AgentRunStatus, detail?: string) => void;
  "cloud-meta": (meta: CloudMeta) => void;
  "model-updated": (modelId: string) => void;
  presence: (participants: Participant[]) => void;
  "diff-update": (patch: string) => void;
  "steer-log": (entry: SteerLogEntry) => void;
  "steer-history": (entries: SteerLogEntry[]) => void;
  "drive-requested": (requesterName: string) => void;
  "drive-granted": () => void;
  "drive-released": () => void;
  kicked: (reason: string) => void;
  error: (message: string) => void;
}

export interface ClientToServerEvents {
  "steer-message": (text: string) => void;
  "request-drive": () => void;
  "release-drive": () => void;
  "grant-drive": (toSocketId: string) => void;
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
  }) => void;
  "worker:agent-event": (data: {
    roomId: string;
    event: AgentStreamEventPayload;
  }) => void;
  "worker:file-diff": (data: {
    roomId: string;
    msgId: string;
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
}

export interface ServerToWorkerEvents {
  "worker:run-prompt": (data: {
    roomId: string;
    prompt: string;
    repoPath: string;
    modelId: string;
    sessionId?: string | null;
  }) => void;
  "worker:abort": (data: { roomId: string }) => void;
  "worker:pick-folder": (data: { requestId: string }) => void;
  "worker:list-models": (data: { requestId: string }) => void;
  "worker:error": (message: string) => void;
}

export interface AgentStreamEventPayload {
  kind: string;
  sessionId?: string;
  text?: string;
  callId?: string;
  name?: string;
  detail?: string;
  path?: string;
  message?: string;
  result?: string;
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
