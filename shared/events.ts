export interface Participant {
  socketId: string;
  name: string;
  color: string;
  isDriver: boolean;
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
  error: (message: string) => void;
}

export interface ClientToServerEvents {
  "steer-message": (text: string) => void;
  "request-drive": () => void;
  "release-drive": () => void;
  "grant-drive": (toSocketId: string) => void;
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
