"use client";

import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { useAuth as useClerkAuth } from "@clerk/nextjs";
import { getSocket, disconnectSocket, type AppSocket } from "../lib/socket";
import type {
  AgentConflict,
  AgentInfo,
  AgentRunStatus,
  ChatMessage,
  CloudMeta,
  Participant,
} from "../../shared/events";

interface UseSocketReturn {
  socket: AppSocket | null;
  connected: boolean;
  participants: Participant[];
  amDriver: boolean;
  mySocketId: string | null;
  messages: ChatMessage[];
  agents: AgentInfo[];
  statusByAgent: Record<string, AgentRunStatus>;
  errorByAgent: Record<string, string>;
  diffByAgent: Record<string, string>;
  conflicts: AgentConflict[];
  /** Legacy single-agent status (default / selected agent). */
  agentStatus: AgentRunStatus;
  agentError: string;
  pendingRequest: {
    socketId: string;
    name: string;
    agentId?: string;
  } | null;
  lastDiff: string;
  cloudMeta: CloudMeta | null;
  modelId: string | null;
  sendSteer: (text: string, agentId?: string) => void;
  requestDrive: (agentId?: string) => void;
  releaseDrive: (agentId?: string) => void;
  grantDrive: (toSocketId: string, agentId?: string) => void;
  leaveRoom: () => void;
  removeMember: (userId: string) => void;
  dismissDriveRequest: () => void;
  drivingAgentIds: string[];
}

function parseAgentStatus(
  statusOrAgentId: string,
  detailOrStatus?: string,
  detail?: string,
): { agentId: string | null; status: AgentRunStatus; detail?: string } {
  if (
    statusOrAgentId === "idle" ||
    statusOrAgentId === "running" ||
    statusOrAgentId === "error"
  ) {
    return {
      agentId: null,
      status: statusOrAgentId,
      detail: detailOrStatus,
    };
  }
  const status = (detailOrStatus || "idle") as AgentRunStatus;
  return { agentId: statusOrAgentId, status, detail };
}

export function useSocket(roomId: string, name: string): UseSocketReturn {
  const { getToken, isSignedIn } = useClerkAuth();
  const getTokenRef = useRef(getToken);
  getTokenRef.current = getToken;

  const [socket, setSocket] = useState<AppSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [mySocketId, setMySocketId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [statusByAgent, setStatusByAgent] = useState<
    Record<string, AgentRunStatus>
  >({});
  const [errorByAgent, setErrorByAgent] = useState<Record<string, string>>(
    {},
  );
  const [diffByAgent, setDiffByAgent] = useState<Record<string, string>>({});
  const [conflicts, setConflicts] = useState<AgentConflict[]>([]);
  const [agentStatus, setAgentStatus] = useState<AgentRunStatus>("idle");
  const [agentError, setAgentError] = useState("");
  const [pendingRequest, setPendingRequest] = useState<{
    socketId: string;
    name: string;
    agentId?: string;
  } | null>(null);
  const [lastDiff, setLastDiff] = useState("");
  const [cloudMeta, setCloudMeta] = useState<CloudMeta | null>(null);
  const [modelId, setModelId] = useState<string | null>(null);
  const socketRef = useRef<AppSocket | null>(null);

  const drivingAgentIds = useMemo(() => {
    if (!mySocketId) return [];
    const me = participants.find((p) => p.socketId === mySocketId);
    return me?.drivingAgentIds || (me?.isDriver ? agents.map((a) => a.id) : []);
  }, [participants, mySocketId, agents]);

  const amDriver =
    mySocketId != null &&
    (drivingAgentIds.length > 0 ||
      participants.some((p) => p.socketId === mySocketId && p.isDriver));

  useEffect(() => {
    if (!roomId || !name || !isSignedIn) return;

    let cancelled = false;
    let attached: AppSocket | null = null;
    let gotHistory = false;

    const onConnect = () => {
      if (!attached) return;
      setConnected(true);
      setMySocketId(attached.id ?? null);
    };
    const onDisconnect = () => setConnected(false);
    const onPresence = (p: Participant[]) => setParticipants(p);
    const onChatHistory = (history: ChatMessage[]) => {
      if (gotHistory && history.length === 0) return;
      gotHistory = true;
      setMessages(history);
    };
    const onChatMessage = (msg: ChatMessage) => {
      setMessages((prev) => {
        const idx = prev.findIndex((m) => m.id === msg.id);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = { ...next[idx], ...msg };
          return next;
        }
        return [...prev, msg];
      });
    };
    const onChatDelta = (
      id: string,
      content: string,
      status?: ChatMessage["status"],
    ) => {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === id
            ? { ...m, content, status: status ?? "streaming" }
            : m,
        ),
      );
    };
    const onAgentStatus = (
      statusOrAgentId: string,
      detailOrStatus?: string,
      detail?: string,
    ) => {
      const parsed = parseAgentStatus(
        statusOrAgentId,
        detailOrStatus,
        detail,
      );
      if (parsed.agentId) {
        setStatusByAgent((prev) => ({
          ...prev,
          [parsed.agentId!]: parsed.status,
        }));
        setAgents((prev) =>
          prev.map((a) =>
            a.id === parsed.agentId
              ? {
                  ...a,
                  status:
                    parsed.status === "running"
                      ? "running"
                      : parsed.status === "error"
                        ? "error"
                        : "idle",
                }
              : a,
          ),
        );
        if (parsed.status === "error" && parsed.detail) {
          setErrorByAgent((prev) => ({
            ...prev,
            [parsed.agentId!]: parsed.detail!,
          }));
        } else if (parsed.status === "running") {
          setErrorByAgent((prev) => {
            const next = { ...prev };
            delete next[parsed.agentId!];
            return next;
          });
        }
      }
      setAgentStatus(parsed.status);
      if (parsed.status === "error" && parsed.detail) {
        setAgentError(parsed.detail);
      } else if (parsed.status === "running") {
        setAgentError("");
      }
    };
    const onAgents = (list: AgentInfo[]) => setAgents(list);
    const onConflicts = (c: AgentConflict[]) => setConflicts(c);
    const onDriveRequested = (payload: {
      socketId: string;
      name: string;
      agentId?: string;
    }) => {
      setPendingRequest(payload);
    };
    const onDiffUpdate = (patch: string, agentId?: string) => {
      if (agentId) {
        setDiffByAgent((prev) => ({ ...prev, [agentId]: patch }));
      }
      setLastDiff(patch);
    };
    const onCloudMeta = (meta: CloudMeta) => setCloudMeta(meta);
    const onModelUpdated = (id: string) => setModelId(id);
    const onError = (message: string) => {
      console.warn("Server error:", message);
    };
    const onKicked = (reason: string) => {
      console.warn("Kicked:", reason);
      window.location.href = `/dashboard?notice=${encodeURIComponent(reason || "Left session")}`;
    };

    void (async () => {
      let token: string | null = null;
      for (let i = 0; i < 10 && !cancelled; i++) {
        try {
          token = (await getTokenRef.current()) || null;
        } catch {
          token = null;
        }
        if (token) break;
        await new Promise((r) => setTimeout(r, 75 * Math.min(i + 1, 4)));
      }
      if (cancelled || !token) return;

      const s = getSocket(roomId, name, () => getTokenRef.current());
      attached = s;
      socketRef.current = s;
      setSocket(s);

      if (s.connected) onConnect();

      s.on("connect", onConnect);
      s.on("disconnect", onDisconnect);
      s.on("presence", onPresence);
      s.on("chat-history", onChatHistory);
      s.on("chat-message", onChatMessage);
      s.on("chat-delta", onChatDelta);
      s.on("agent-status", onAgentStatus);
      s.on("agents", onAgents);
      s.on("agent-conflicts", onConflicts);
      s.on("drive-requested", onDriveRequested);
      s.on("diff-update", onDiffUpdate);
      s.on("cloud-meta", onCloudMeta);
      s.on("model-updated", onModelUpdated);
      s.on("error", onError);
      s.on("kicked", onKicked);
    })();

    return () => {
      cancelled = true;
      if (attached) {
        attached.off("connect", onConnect);
        attached.off("disconnect", onDisconnect);
        attached.off("presence", onPresence);
        attached.off("chat-history", onChatHistory);
        attached.off("chat-message", onChatMessage);
        attached.off("chat-delta", onChatDelta);
        attached.off("agent-status", onAgentStatus);
        attached.off("agents", onAgents);
        attached.off("agent-conflicts", onConflicts);
        attached.off("drive-requested", onDriveRequested);
        attached.off("diff-update", onDiffUpdate);
        attached.off("cloud-meta", onCloudMeta);
        attached.off("model-updated", onModelUpdated);
        attached.off("error", onError);
        attached.off("kicked", onKicked);
      }
      disconnectSocket();
      socketRef.current = null;
      setSocket(null);
      setConnected(false);
      setParticipants([]);
      setLastDiff("");
      setCloudMeta(null);
      setMySocketId(null);
      setAgentStatus("idle");
      setAgentError("");
      setAgents([]);
      setStatusByAgent({});
      setErrorByAgent({});
      setDiffByAgent({});
      setConflicts([]);
    };
  }, [roomId, name, isSignedIn]);

  useEffect(() => {
    setMessages([]);
    setModelId(null);
    setPendingRequest(null);
  }, [roomId]);

  const sendSteer = useCallback((text: string, agentId?: string) => {
    if (agentId) {
      socketRef.current?.emit("steer-message", agentId, text);
    } else {
      socketRef.current?.emit("steer-message", text);
    }
  }, []);

  const requestDrive = useCallback((agentId?: string) => {
    socketRef.current?.emit("request-drive", agentId);
  }, []);

  const releaseDrive = useCallback((agentId?: string) => {
    socketRef.current?.emit("release-drive", agentId);
  }, []);

  const grantDrive = useCallback((toSocketId: string, agentId?: string) => {
    if (agentId) {
      socketRef.current?.emit("grant-drive", agentId, toSocketId);
    } else {
      socketRef.current?.emit("grant-drive", toSocketId);
    }
    setPendingRequest(null);
  }, []);

  const dismissDriveRequest = useCallback(() => {
    setPendingRequest(null);
  }, []);

  const leaveRoom = useCallback(() => {
    socketRef.current?.emit("leave-room");
  }, []);

  const removeMember = useCallback((userId: string) => {
    socketRef.current?.emit("remove-member", userId);
  }, []);

  return {
    socket,
    connected,
    participants,
    amDriver,
    mySocketId,
    messages,
    agents,
    statusByAgent,
    errorByAgent,
    diffByAgent,
    conflicts,
    agentStatus,
    agentError,
    pendingRequest,
    lastDiff,
    cloudMeta,
    modelId,
    sendSteer,
    requestDrive,
    releaseDrive,
    grantDrive,
    dismissDriveRequest,
    leaveRoom,
    removeMember,
    drivingAgentIds,
  };
}
