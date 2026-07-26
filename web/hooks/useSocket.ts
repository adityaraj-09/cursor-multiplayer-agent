"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { getSocket, disconnectSocket, type AppSocket } from "../lib/socket";
import type {
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
  agentStatus: AgentRunStatus;
  pendingRequest: string | null;
  lastDiff: string;
  cloudMeta: CloudMeta | null;
  modelId: string | null;
  sendSteer: (text: string) => void;
  requestDrive: () => void;
  releaseDrive: () => void;
  grantDrive: (toSocketId: string) => void;
}

export function useSocket(roomId: string, name: string): UseSocketReturn {
  const [socket, setSocket] = useState<AppSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [mySocketId, setMySocketId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [agentStatus, setAgentStatus] = useState<AgentRunStatus>("idle");
  const [pendingRequest, setPendingRequest] = useState<string | null>(null);
  const [lastDiff, setLastDiff] = useState("");
  const [cloudMeta, setCloudMeta] = useState<CloudMeta | null>(null);
  const [modelId, setModelId] = useState<string | null>(null);
  const socketRef = useRef<AppSocket | null>(null);

  const amDriver =
    mySocketId != null &&
    participants.some((p) => p.socketId === mySocketId && p.isDriver);

  useEffect(() => {
    if (!roomId || !name) return;

    const s = getSocket(roomId, name);
    socketRef.current = s;
    setSocket(s);

    const onConnect = () => {
      setConnected(true);
      setMySocketId(s.id ?? null);
    };

    const onDisconnect = () => setConnected(false);
    const onPresence = (p: Participant[]) => setParticipants(p);
    const onChatHistory = (history: ChatMessage[]) => setMessages(history);
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
    const onAgentStatus = (status: AgentRunStatus) => setAgentStatus(status);
    const onDriveRequested = (requesterName: string) => {
      setPendingRequest(requesterName);
    };
    const onDiffUpdate = (patch: string) => setLastDiff(patch);
    const onCloudMeta = (meta: CloudMeta) => setCloudMeta(meta);
    const onModelUpdated = (id: string) => setModelId(id);
    const onError = (message: string) => {
      console.warn("Server error:", message);
    };

    if (s.connected) onConnect();

    s.on("connect", onConnect);
    s.on("disconnect", onDisconnect);
    s.on("presence", onPresence);
    s.on("chat-history", onChatHistory);
    s.on("chat-message", onChatMessage);
    s.on("chat-delta", onChatDelta);
    s.on("agent-status", onAgentStatus);
    s.on("drive-requested", onDriveRequested);
    s.on("diff-update", onDiffUpdate);
    s.on("cloud-meta", onCloudMeta);
    s.on("model-updated", onModelUpdated);
    s.on("error", onError);

    return () => {
      s.off("connect", onConnect);
      s.off("disconnect", onDisconnect);
      s.off("presence", onPresence);
      s.off("chat-history", onChatHistory);
      s.off("chat-message", onChatMessage);
      s.off("chat-delta", onChatDelta);
      s.off("agent-status", onAgentStatus);
      s.off("drive-requested", onDriveRequested);
      s.off("diff-update", onDiffUpdate);
      s.off("cloud-meta", onCloudMeta);
      s.off("model-updated", onModelUpdated);
      s.off("error", onError);
      disconnectSocket();
      socketRef.current = null;
      setSocket(null);
      setConnected(false);
      setParticipants([]);
      setMessages([]);
      setLastDiff("");
      setCloudMeta(null);
      setModelId(null);
      setMySocketId(null);
      setAgentStatus("idle");
    };
  }, [roomId, name]);

  const sendSteer = useCallback((text: string) => {
    socketRef.current?.emit("steer-message", text);
  }, []);

  const requestDrive = useCallback(() => {
    socketRef.current?.emit("request-drive");
  }, []);

  const releaseDrive = useCallback(() => {
    socketRef.current?.emit("release-drive");
  }, []);

  const grantDrive = useCallback((toSocketId: string) => {
    socketRef.current?.emit("grant-drive", toSocketId);
    setPendingRequest(null);
  }, []);

  return {
    socket,
    connected,
    participants,
    amDriver,
    mySocketId,
    messages,
    agentStatus,
    pendingRequest,
    lastDiff,
    cloudMeta,
    modelId,
    sendSteer,
    requestDrive,
    releaseDrive,
    grantDrive,
  };
}
