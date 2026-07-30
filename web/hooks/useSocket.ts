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
  pendingRequest: { socketId: string; name: string } | null;
  lastDiff: string;
  cloudMeta: CloudMeta | null;
  modelId: string | null;
  sendSteer: (text: string) => void;
  requestDrive: () => void;
  releaseDrive: () => void;
  grantDrive: (toSocketId: string) => void;
  leaveRoom: () => void;
  removeMember: (userId: string) => void;
  dismissDriveRequest: () => void;
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
  const [agentStatus, setAgentStatus] = useState<AgentRunStatus>("idle");
  const [pendingRequest, setPendingRequest] = useState<{
    socketId: string;
    name: string;
  } | null>(null);
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
    let gotHistory = false;

    const onConnect = () => {
      if (!attached) return;
      setConnected(true);
      setMySocketId(attached.id ?? null);
    };
    const onDisconnect = () => setConnected(false);
    const onPresence = (p: Participant[]) => setParticipants(p);
    const onChatHistory = (history: ChatMessage[]) => {
      // Only replace from server history once per connection lifecycle —
      // avoids wiping in-flight UI on spurious reconnects if history is empty.
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
    const onAgentStatus = (status: AgentRunStatus) => setAgentStatus(status);
    const onDriveRequested = (payload: { socketId: string; name: string }) => {
      // Always surface a new request — dismissing one must not block later ones.
      setPendingRequest(payload);
    };
    const onDiffUpdate = (patch: string) => setLastDiff(patch);
    const onCloudMeta = (meta: CloudMeta) => setCloudMeta(meta);
    const onModelUpdated = (id: string) => setModelId(id);
    const onError = (message: string) => {
      console.warn("Server error:", message);
    };
    const onKicked = (reason: string) => {
      console.warn("Kicked:", reason);
      window.location.href = `/?notice=${encodeURIComponent(reason || "Left session")}`;
    };

    void (async () => {
      const token = await getTokenRef.current();
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
      // Keep messages across effect re-runs for same room; clear only via
      // room/name change by resetting when deps change (below state is
      // component-local and remounts LiveRoom only when name/room changes).
      setParticipants([]);
      setLastDiff("");
      setCloudMeta(null);
      setMySocketId(null);
      setAgentStatus("idle");
    };
  }, [roomId, name, isSignedIn]);

  // Clear chat when switching rooms (not on token refreshes).
  useEffect(() => {
    setMessages([]);
    setModelId(null);
    setPendingRequest(null);
  }, [roomId]);

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
    agentStatus,
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
  };
}
