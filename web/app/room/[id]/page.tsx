"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useSocket } from "../../../hooks/useSocket";
import { useAuth } from "../../../components/AuthProvider";
import {
  fetchOrJoinRoom,
  fetchRoomModels,
  updateRoomModel,
} from "../../../lib/api";
import ChatPanel from "../../../components/ChatPanel";
import SidePanel from "../../../components/SidePanel";
import PresenceBar from "../../../components/PresenceBar";
import SteerInput from "../../../components/SteerInput";
import DriverControls from "../../../components/DriverControls";
import type { ModelInfo, RoomInfo } from "../../../../shared/events";

export default function RoomPage() {
  const params = useParams();
  const roomId = params.id as string;
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();

  const [roomInfo, setRoomInfo] = useState<RoomInfo | null>(null);
  const [userName, setUserName] = useState<string | null>(null);
  const [nameInput, setNameInput] = useState("");
  const [roomError, setRoomError] = useState("");
  const [loadingRoom, setLoadingRoom] = useState(true);

  useEffect(() => {
    const saved = localStorage.getItem("agent-session-name");
    if (saved) setNameInput(saved);
  }, []);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      router.replace(`/login?redirect=/room/${roomId}`);
      return;
    }

    let cancelled = false;
    setLoadingRoom(true);
    setRoomError("");
    fetchOrJoinRoom(roomId)
      .then((info) => {
        if (cancelled) return;
        setRoomInfo(info);
        if (!nameInput.trim() && user.name) {
          setNameInput(user.name);
        }
      })
      .catch(() => {
        if (!cancelled) setRoomError("Room not found or you can’t join it");
      })
      .finally(() => {
        if (!cancelled) setLoadingRoom(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, user, authLoading, router]);

  const handleJoin = () => {
    const name = nameInput.trim() || user?.name || "Guest";
    localStorage.setItem("agent-session-name", name);
    setUserName(name);
  };

  if (authLoading || (user && loadingRoom && !roomError)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#141414]">
        <p className="text-[#6e6e6e] text-[13px]">Loading session…</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#141414]">
        <p className="text-[#6e6e6e] text-[13px]">Redirecting to sign in…</p>
      </div>
    );
  }

  if (roomError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#141414]">
        <div className="text-center">
          <p className="text-[#a0a0a0] text-[14px] mb-3">{roomError}</p>
          <Link
            href="/"
            className="text-[13px] text-[#4d9fff] hover:underline"
          >
            ← Back to sessions
          </Link>
        </div>
      </div>
    );
  }

  if (!userName) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#141414]">
        <div className="w-full max-w-sm px-6">
          <div className="mb-6 text-center">
            <div className="w-8 h-8 rounded-md bg-[#e4e4e4] flex items-center justify-center mx-auto mb-4">
              <span className="text-[#141414] text-[13px] font-semibold">S</span>
            </div>
            <h2 className="text-[18px] font-medium text-[#e4e4e4] mb-1">
              Join session
            </h2>
            <p className="text-[13px] text-[#6e6e6e]">
              {roomInfo?.name || "Loading…"}
            </p>
          </div>
          <input
            type="text"
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleJoin()}
            placeholder="Your name"
            maxLength={30}
            autoFocus
            className="w-full h-10 px-3 mb-3 bg-[#252525] border border-[#2b2b2b] rounded-md text-[13px] text-[#e4e4e4] placeholder:text-[#6e6e6e] outline-none focus:border-[#4d9fff] transition-colors"
          />
          <button
            onClick={handleJoin}
            className="w-full h-9 rounded-md bg-[#e4e4e4] text-[#141414] text-[13px] font-medium hover:bg-white transition-colors"
          >
            Join
          </button>
        </div>
      </div>
    );
  }

  return (
    <LiveRoom
      roomId={roomId}
      userName={userName}
      roomInfo={roomInfo}
      onRoomInfo={setRoomInfo}
    />
  );
}

function LiveRoom({
  roomId,
  userName,
  roomInfo,
  onRoomInfo,
}: {
  roomId: string;
  userName: string;
  roomInfo: RoomInfo | null;
  onRoomInfo: (info: RoomInfo) => void;
}) {
  const {
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
    modelId: liveModelId,
    sendSteer,
    requestDrive,
    releaseDrive,
    grantDrive,
  } = useSocket(roomId, userName);

  const runtime = roomInfo?.runtime || "local";
  const authMode = roomInfo?.authMode || "cli";
  const modelId = liveModelId || roomInfo?.modelId || "auto";

  const [models, setModels] = useState<ModelInfo[]>([]);
  const [modelError, setModelError] = useState("");
  const [savingModel, setSavingModel] = useState(false);
  const [dismissedRequest, setDismissedRequest] = useState(false);
  const [shareLabel, setShareLabel] = useState("Share");

  useEffect(() => {
    let cancelled = false;
    fetchRoomModels(roomId)
      .then((list) => {
        if (!cancelled) setModels(list);
      })
      .catch((err) => {
        if (!cancelled) {
          setModelError(
            err instanceof Error ? err.message : "Failed to load models",
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [roomId]);

  const handleModelChange = useCallback(
    async (next: string) => {
      if (!next || next === modelId) return;
      setSavingModel(true);
      setModelError("");
      try {
        const updated = await updateRoomModel(roomId, next);
        onRoomInfo(updated);
      } catch (err) {
        setModelError(
          err instanceof Error ? err.message : "Failed to change model",
        );
      } finally {
        setSavingModel(false);
      }
    },
    [modelId, onRoomInfo, roomId],
  );

  const handleGrantDrive = useCallback(() => {
    const requester = participants.find((p) => p.name === pendingRequest);
    if (requester) {
      grantDrive(requester.socketId);
    }
    setDismissedRequest(false);
  }, [participants, pendingRequest, grantDrive]);

  const handleShare = useCallback(async () => {
    const url = `${window.location.origin}/room/${roomId}`;
    try {
      await navigator.clipboard.writeText(url);
      setShareLabel("Copied");
      setTimeout(() => setShareLabel("Share"), 1500);
    } catch {
      window.prompt("Copy this link:", url);
    }
  }, [roomId]);

  const activePendingRequest =
    pendingRequest && !dismissedRequest ? pendingRequest : null;

  return (
    <div className="h-screen flex flex-col bg-[#141414]">
      <header className="flex items-center justify-between px-3 h-10 border-b border-[#2b2b2b] bg-[#1a1a1a] shrink-0">
        <div className="flex items-center gap-2.5 min-w-0">
          <Link
            href="/"
            className="flex items-center gap-2 shrink-0 hover:opacity-80 transition-opacity"
          >
            <div className="w-5 h-5 rounded-[4px] bg-[#e4e4e4] flex items-center justify-center">
              <span className="text-[#141414] text-[9px] font-semibold">S</span>
            </div>
          </Link>
          <span className="text-[#2b2b2b]">/</span>
          <span className="text-[13px] text-[#e4e4e4] truncate">
            {roomInfo?.name || roomId}
          </span>
          <span
            className={`w-1.5 h-1.5 rounded-full shrink-0 ${
              connected ? "bg-[#3ecf8e]" : "bg-[#f07070]"
            }`}
            title={connected ? "Connected" : "Disconnected"}
          />
          <span className="hidden md:inline text-[11px] text-[#6e6e6e] px-1.5 py-0.5 rounded bg-[#252525] border border-[#2b2b2b]">
            {runtime === "cloud" ? "Cloud" : "Local"}
          </span>
          <span className="hidden lg:inline text-[11px] text-[#6e6e6e] px-1.5 py-0.5 rounded bg-[#252525] border border-[#2b2b2b]">
            {authMode === "cli"
              ? "Local login"
              : authMode === "byok"
                ? "BYOK"
                : "Server key"}
          </span>
          {agentStatus === "running" && (
            <span className="text-[11px] text-[#4d9fff] hidden sm:inline">
              Running
            </span>
          )}
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => void handleShare()}
            className="h-7 px-2.5 rounded-md text-[12px] text-[#a0a0a0] hover:text-[#e4e4e4] border border-[#2b2b2b] hover:border-[#3c3c3c] transition-colors"
          >
            {shareLabel}
          </button>
          <PresenceBar participants={participants} mySocketId={mySocketId} />
          <div className="w-px h-4 bg-[#2b2b2b]" />
          <span className="text-[11px] text-[#6e6e6e] hidden sm:inline">
            {amDriver ? "Host" : "Joined"}
          </span>
          <DriverControls
            amDriver={amDriver}
            pendingRequest={activePendingRequest}
            onRequestDrive={requestDrive}
            onReleaseDrive={releaseDrive}
            onGrantDrive={handleGrantDrive}
            onDismissRequest={() => setDismissedRequest(true)}
          />
        </div>
      </header>

      <main className="flex flex-1 min-h-0 min-w-0 overflow-hidden">
        <div className="flex-1 flex flex-col min-h-0 min-w-0 overflow-hidden">
          <div className="flex items-center px-3 h-8 border-b border-[#2b2b2b] bg-[#1a1a1a] shrink-0">
            <span className="text-[11px] text-[#6e6e6e] uppercase tracking-wide">
              Conversation
            </span>
          </div>
          <ChatPanel messages={messages} agentStatus={agentStatus} />
        </div>

        <SidePanel
          socket={socket}
          lastDiff={lastDiff}
          runtime={runtime}
          cloudMeta={cloudMeta}
          prUrl={roomInfo?.prUrl}
        />
      </main>

      <footer className="border-t border-[#2b2b2b] bg-[#1a1a1a] shrink-0">
        {modelError && (
          <p className="px-3 pt-2 text-[11px] text-[#f07070]">{modelError}</p>
        )}
        <SteerInput
          onSend={sendSteer}
          disabled={agentStatus === "running"}
          models={models}
          modelId={modelId}
          onModelChange={(id) => void handleModelChange(id)}
          modelDisabled={
            savingModel || agentStatus === "running" || models.length === 0
          }
          placeholder={
            agentStatus === "running"
              ? "Agent is working…"
              : "Message the agent…"
          }
        />
      </footer>
    </div>
  );
}
