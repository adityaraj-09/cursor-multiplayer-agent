"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useAuth as useClerkAuth } from "@clerk/nextjs";
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
  const { getToken, isSignedIn } = useClerkAuth();
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
    if (!roomId || !name || !isSignedIn) return;

    let cancelled = false;
    let attached: AppSocket | null = null;

    const onConnect = () => {
      if (!attached) return;
      setConnected(true);
      setMySocketId(attached.id ?? null);
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

    void (async () => {
      const token = await getToken();
      if (cancelled || !token) return;

      const s = getSocket(roomId, name, token);
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
      s.on("drive-requested", onDriveRequested);
      s.on("diff-update", onDiffUpdate);
      s.on("cloud-meta", onCloudMeta);
      s.on("model-updated", onModelUpdated);
      s.on("error", onError);
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
        attached.off("drive-requested", onDriveRequested);
        attached.off("diff-update", onDiffUpdate);
        attached.off("cloud-meta", onCloudMeta);
        attached.off("model-updated", onModelUpdated);
        attached.off("error", onError);
      }
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
  }, [roomId, name, isSignedIn, getToken]);

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
