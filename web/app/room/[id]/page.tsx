"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useSocket } from "../../../hooks/useSocket";
import { useAuth } from "../../../components/AuthProvider";
import {
  fetchOrJoinRoom,
  fetchRoomModels,
  updateRoomModel,
} from "../../../lib/api";
import {
  FALLBACK_MODELS,
  getCachedModels,
  setCachedModels,
} from "../../../lib/modelsCache";
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
  const userId = user?.id;
  const userNameHint = user?.name;

  const [roomInfo, setRoomInfo] = useState<RoomInfo | null>(null);
  const [userName, setUserName] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return localStorage.getItem("agent-session-name");
  });
  const [nameInput, setNameInput] = useState(
    () =>
      (typeof window !== "undefined" &&
        localStorage.getItem("agent-session-name")) ||
      "",
  );
  const [roomError, setRoomError] = useState("");
  const [loadingRoom, setLoadingRoom] = useState(true);
  const joinedRef = useRef<string | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (!userId) {
      router.replace(`/login?redirect=/room/${roomId}`);
      return;
    }

    if (joinedRef.current === roomId) {
      setLoadingRoom(false);
      return;
    }

    let cancelled = false;
    setLoadingRoom(true);
    setRoomError("");
    fetchOrJoinRoom(roomId)
      .then((info) => {
        if (cancelled) return;
        joinedRef.current = roomId;
        setRoomInfo(info);
        setUserName((prev) => {
          if (prev) return prev;
          const preferred =
            localStorage.getItem("agent-session-name") ||
            userNameHint ||
            "Guest";
          localStorage.setItem("agent-session-name", preferred);
          setNameInput(preferred);
          return preferred;
        });
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
  }, [roomId, userId, authLoading, router, userNameHint]);

  const handleJoin = () => {
    const name = nameInput.trim() || userNameHint || "Guest";
    localStorage.setItem("agent-session-name", name);
    setUserName(name);
  };

  if (authLoading || (userId && loadingRoom && !roomInfo && !roomError)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#141414]">
        <p className="text-[#6e6e6e] text-[13px]">Loading session…</p>
      </div>
    );
  }

  if (!userId) {
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
    leaveRoom,
    removeMember,
  } = useSocket(roomId, userName);

  const { user } = useAuth();
  const runtime = roomInfo?.runtime || "local";
  const modelId = liveModelId || roomInfo?.modelId || "auto";
  const amHost = Boolean(
    user?.id && roomInfo?.ownerId && user.id === roomInfo.ownerId,
  );
  const cacheKey = `room:${roomId}`;

  const [models, setModels] = useState<ModelInfo[]>(
    () => getCachedModels(cacheKey) || FALLBACK_MODELS,
  );
  const [modelError, setModelError] = useState("");
  const [savingModel, setSavingModel] = useState(false);
  const [dismissedRequest, setDismissedRequest] = useState(false);
  const [shareLabel, setShareLabel] = useState("Share");
  const [changesOpen, setChangesOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const cached = getCachedModels(cacheKey);
    if (cached?.length) setModels(cached);

    fetchRoomModels(roomId)
      .then((list) => {
        if (cancelled || !list.length) return;
        setCachedModels(cacheKey, list);
        setModels(list);
        setModelError("");
      })
      .catch((err) => {
        if (cancelled) return;
        // Keep cached / fallback models — don't block chatting
        if (!getCachedModels(cacheKey)?.length) {
          setModelError(
            err instanceof Error ? err.message : "Failed to load models",
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [roomId, cacheKey]);

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

  const fileCount = lastDiff
    ? (lastDiff.match(/^diff --git /gm) || []).length
    : 0;

  return (
    <div className="h-[100dvh] flex flex-col bg-[#141414] overflow-hidden">
      <header className="flex items-center justify-between gap-2 px-2 sm:px-3 h-11 sm:h-10 border-b border-[#2b2b2b] bg-[#1a1a1a] shrink-0 pt-[env(safe-area-inset-top)]">
        <div className="flex items-center gap-1.5 sm:gap-2.5 min-w-0 flex-1">
          <Link
            href="/"
            className="flex items-center gap-2 shrink-0 hover:opacity-80 transition-opacity"
            aria-label="Steer home"
          >
            <div className="w-5 h-5 rounded-[4px] bg-[#e4e4e4] flex items-center justify-center">
              <span className="text-[#141414] text-[9px] font-semibold">S</span>
            </div>
            <span className="hidden sm:inline text-[12px] text-[#a0a0a0]">
              Steer
            </span>
          </Link>
          <span className="text-[#2b2b2b] hidden sm:inline">/</span>
          <span className="text-[13px] text-[#e4e4e4] truncate min-w-0">
            {roomInfo?.name || roomId}
          </span>
          <span
            className={`w-1.5 h-1.5 rounded-full shrink-0 ${
              connected ? "bg-[#3ecf8e]" : "bg-[#f07070]"
            }`}
            title={connected ? "Connected" : "Disconnected"}
          />
          {agentStatus === "running" && (
            <span className="text-[11px] text-[#4d9fff] hidden xs:inline sm:inline">
              Running
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setChangesOpen(true)}
            className="lg:hidden h-7 px-2 rounded-md text-[11px] text-[#a0a0a0] hover:text-[#e4e4e4] border border-[#2b2b2b]"
          >
            Changes{fileCount > 0 ? ` · ${fileCount}` : ""}
          </button>
          <button
            type="button"
            onClick={() => void handleShare()}
            className="h-7 px-2 sm:px-2.5 rounded-md text-[11px] sm:text-[12px] text-[#a0a0a0] hover:text-[#e4e4e4] border border-[#2b2b2b] hover:border-[#3c3c3c] transition-colors"
          >
            {shareLabel}
          </button>
          {!amHost && (
            <button
              type="button"
              onClick={() => {
                if (window.confirm("Leave this session?")) leaveRoom();
              }}
              className="hidden sm:inline-flex h-7 px-2.5 rounded-md text-[12px] text-[#a0a0a0] hover:text-[#f07070] border border-[#2b2b2b] hover:border-[#3c3c3c] transition-colors"
            >
              Leave
            </button>
          )}
          <PresenceBar
            participants={participants}
            mySocketId={mySocketId}
            amHost={amHost}
            onRemoveMember={(uid) => {
              if (window.confirm("Remove this member from the session?")) {
                removeMember(uid);
              }
            }}
          />
          <div className="hidden sm:block w-px h-4 bg-[#2b2b2b]" />
          <span className="text-[11px] text-[#6e6e6e] hidden md:inline">
            {amHost ? "Host" : amDriver ? "Driving" : "Joined"}
          </span>
          <DriverControls
            amDriver={amDriver || amHost}
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

      {changesOpen && (
        <SidePanel
          socket={socket}
          lastDiff={lastDiff}
          runtime={runtime}
          cloudMeta={cloudMeta}
          prUrl={roomInfo?.prUrl}
          mobile
          onClose={() => setChangesOpen(false)}
        />
      )}

      <footer className="border-t border-[#2b2b2b] bg-[#1a1a1a] shrink-0 pb-[env(safe-area-inset-bottom)]">
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
            !amHost || savingModel || agentStatus === "running"
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
