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

export interface RoomInfo {
  id: string;
  name: string;
  repoPath: string;
  agentCommand: string;
  participantCount: number;
  status: string;
  createdAt: number;
}

export interface ServerToClientEvents {
  scrollback: (data: string) => void;
  "pty-output": (data: string) => void;
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
  "pty-input": (data: string) => void;
  "steer-message": (text: string) => void;
  "request-drive": () => void;
  "release-drive": () => void;
  "grant-drive": (toSocketId: string) => void;
  resize: (cols: number, rows: number) => void;
  /** Scroll tmux history so everyone can review past messages/responses. */
  "scroll-history": (direction: "up" | "down", lines?: number) => void;
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
