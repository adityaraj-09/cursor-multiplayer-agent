import type {
  AgentRunStatus,
  ApprovalRequestInfo,
  PingInfo,
} from "./events.js";

export type AttentionKind =
  | "approval"
  | "ping"
  | "error"
  | "drive"
  | "running"
  | "unread";

export type RoomAttention = {
  kind: AttentionKind;
  label: string;
  count?: number;
};

export function computeRoomAttention({
  pendingApprovals,
  openPings,
  agentError,
  errorByAgent,
  agentStatus,
  statusByAgent,
  pendingDrive,
  unreadCount,
}: {
  pendingApprovals: ApprovalRequestInfo[];
  openPings: PingInfo[];
  agentError: string;
  errorByAgent: Record<string, string>;
  agentStatus: AgentRunStatus;
  statusByAgent: Record<string, AgentRunStatus>;
  pendingDrive: boolean;
  unreadCount: number;
}): RoomAttention | null {
  if (pendingApprovals.length > 0) {
    return {
      kind: "approval",
      label: pendingApprovals.length === 1 ? "Approval" : "Approvals",
      count: pendingApprovals.length,
    };
  }
  if (openPings.length > 0) {
    return {
      kind: "ping",
      label: openPings.length === 1 ? "Review ping" : "Review pings",
      count: openPings.length,
    };
  }
  const errors = Object.values(errorByAgent).filter(Boolean);
  if (agentError || errors.length) {
    return { kind: "error", label: "Error" };
  }
  if (pendingDrive) {
    return { kind: "drive", label: "Drive request" };
  }
  const running =
    agentStatus === "running" ||
    Object.values(statusByAgent).some((status) => status === "running");
  if (running) {
    return { kind: "running", label: "Running" };
  }
  if (unreadCount > 0) {
    return {
      kind: "unread",
      label: unreadCount === 1 ? "New message" : "New messages",
      count: unreadCount,
    };
  }
  return null;
}
