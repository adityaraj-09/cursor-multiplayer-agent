"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { getSocket, disconnectSocket, type AppSocket } from "../lib/socket";
import type { Participant, SteerLogEntry } from "../../shared/events";
import { sanitizeTerminalOutput } from "../../shared/terminalFilter";

interface UseSocketReturn {
  socket: AppSocket | null;
  connected: boolean;
  participants: Participant[];
  amDriver: boolean;
  mySocketId: string | null;
  steerLog: SteerLogEntry[];
  pendingRequest: string | null;
  scrollback: string;
  lastDiff: string;
  sendSteer: (text: string) => void;
  sendPtyInput: (data: string) => void;
  requestDrive: () => void;
  releaseDrive: () => void;
  grantDrive: (toSocketId: string) => void;
  sendResize: (cols: number, rows: number) => void;
  sendScrollHistory: (direction: "up" | "down", lines?: number) => void;
}

export function useSocket(roomId: string, name: string): UseSocketReturn {
  const [socket, setSocket] = useState<AppSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [mySocketId, setMySocketId] = useState<string | null>(null);
  const [steerLog, setSteerLog] = useState<SteerLogEntry[]>([]);
  const [pendingRequest, setPendingRequest] = useState<string | null>(null);
  const [scrollback, setScrollback] = useState("");
  const [lastDiff, setLastDiff] = useState("");
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
    const onSteerLog = (entry: SteerLogEntry) => {
      setSteerLog((prev) => [...prev, entry]);
    };
    const onSteerHistory = (entries: SteerLogEntry[]) => {
      setSteerLog(entries);
    };
    const onDriveRequested = (requesterName: string) => {
      setPendingRequest(requesterName);
    };
    const onScrollback = (data: string) =>
      setScrollback(sanitizeTerminalOutput(data));
    const onDiffUpdate = (patch: string) => setLastDiff(patch);
    const onError = (message: string) => {
      console.warn("Server error:", message);
    };

    if (s.connected) onConnect();

    s.on("connect", onConnect);
    s.on("disconnect", onDisconnect);
    s.on("presence", onPresence);
    s.on("steer-log", onSteerLog);
    s.on("steer-history", onSteerHistory);
    s.on("drive-requested", onDriveRequested);
    s.on("scrollback", onScrollback);
    s.on("diff-update", onDiffUpdate);
    s.on("error", onError);

    return () => {
      s.off("connect", onConnect);
      s.off("disconnect", onDisconnect);
      s.off("presence", onPresence);
      s.off("steer-log", onSteerLog);
      s.off("steer-history", onSteerHistory);
      s.off("drive-requested", onDriveRequested);
      s.off("scrollback", onScrollback);
      s.off("diff-update", onDiffUpdate);
      s.off("error", onError);
      disconnectSocket();
      socketRef.current = null;
      setSocket(null);
      setConnected(false);
      setParticipants([]);
      setSteerLog([]);
      setScrollback("");
      setLastDiff("");
      setMySocketId(null);
    };
  }, [roomId, name]);

  const sendSteer = useCallback((text: string) => {
    socketRef.current?.emit("steer-message", text);
  }, []);

  const sendPtyInput = useCallback((data: string) => {
    socketRef.current?.emit("pty-input", data);
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

  const sendResize = useCallback((cols: number, rows: number) => {
    socketRef.current?.emit("resize", cols, rows);
  }, []);

  const sendScrollHistory = useCallback(
    (direction: "up" | "down", lines?: number) => {
      socketRef.current?.emit("scroll-history", direction, lines);
    },
    [],
  );

  return {
    socket,
    connected,
    participants,
    amDriver,
    mySocketId,
    steerLog,
    pendingRequest,
    scrollback,
    lastDiff,
    sendSteer,
    sendPtyInput,
    requestDrive,
    releaseDrive,
    grantDrive,
    sendResize,
    sendScrollHistory,
  };
}
