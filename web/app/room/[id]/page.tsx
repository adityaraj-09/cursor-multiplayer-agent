"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  Activity,
  Bot,
  Cloud,
  Home,
  PanelLeftOpen,
  PanelRightOpen,
  Share2,
  Square,
  StopCircle,
  Wifi,
  WifiOff,
} from "lucide-react";
import { useSocket } from "../../../hooks/useSocket";
import { useAuth } from "../../../components/AuthProvider";
import {
  abortRoomRun,
  addRoomAgent,
  fetchOrJoinRoom,
  fetchRoomModels,
  forceReleaseFileLock,
  stopRoom,
  stopRoomAgent,
  updateRoomCursorSession,
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
import CursorSessionPicker from "../../../components/CursorSessionPicker";
import DriverControls from "../../../components/DriverControls";
import InvitePanel from "../../../components/InvitePanel";
import AgentTabs from "../../../components/AgentTabs";
import AddAgentDialog from "../../../components/AddAgentDialog";
import LockPanel from "../../../components/LockPanel";
import type { ModelInfo, RoomInfo } from "../../../../shared/events";
import {
  CLAUDE_MODELS,
  DEFAULT_CLAUDE_MODEL,
} from "../../../../shared/claudeModels";
import { formatTypingIndicator } from "../../../../shared/typing";

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
  const router = useRouter();
  const {
    socket,
    connected,
    participants,
    amDriver,
    mySocketId,
    messages,
    agents,
    statusByAgent,
    diffByAgent,
    conflicts,
    fileLocks,
    lastBlocked,
    typingByAgent,
    agentStatus,
    agentError,
    pendingRequest,
    lastDiff,
    cloudMeta,
    modelId: liveModelId,
    sendSteer,
    notifyTyping,
    notifyTypingStop,
    requestDrive,
    releaseDrive,
    grantDrive,
    leaveRoom,
    removeMember,
    dismissDriveRequest,
    drivingAgentIds,
  } = useSocket(roomId, userName);

  const { user } = useAuth();
  const runtime = roomInfo?.runtime || "local";
  const modelId = liveModelId || roomInfo?.modelId || "auto";
  const amHost = Boolean(
    user?.id && roomInfo?.ownerId && user.id === roomInfo.ownerId,
  );
  const [models, setModels] = useState<ModelInfo[]>(FALLBACK_MODELS);
  const [modelError, setModelError] = useState("");
  const [savingModel, setSavingModel] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [agentsOpen, setAgentsOpen] = useState(false);
  const [changesOpen, setChangesOpen] = useState(false);
  const [addAgentOpen, setAddAgentOpen] = useState(false);
  const [cursorSessionError, setCursorSessionError] = useState("");
  const [savingCursorSession, setSavingCursorSession] = useState(false);
  const [actionError, setActionError] = useState("");
  const [stopping, setStopping] = useState(false);
  const [aborting, setAborting] = useState(false);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [chatFilterAgentId, setChatFilterAgentId] = useState<string | null>(
    null,
  );

  // Auto-select first agent when agents arrive
  useEffect(() => {
    if (!agents.length) return;
    if (
      !selectedAgentId ||
      !agents.some((a) => a.id === selectedAgentId)
    ) {
      const first =
        agents.find((a) => a.status !== "stopped") || agents[0];
      const frame = requestAnimationFrame(() => setSelectedAgentId(first.id));
      return () => cancelAnimationFrame(frame);
    }
  }, [agents, selectedAgentId]);

  const selectedAgent =
    agents.find((a) => a.id === selectedAgentId) || agents[0] || null;
  const selectedBackend = selectedAgent?.backend || "cursor";
  const selectedModelId =
    selectedAgent?.modelId ||
    (selectedBackend === "claude-code" ? DEFAULT_CLAUDE_MODEL : modelId);
  const modelsCacheKey = `room:${roomId}:agent:${selectedAgent?.id || "default"}:${selectedBackend}`;
  const selectedStatus: typeof agentStatus =
    (selectedAgentId && statusByAgent[selectedAgentId]) ||
    (selectedAgent?.status === "running"
      ? "running"
      : selectedAgent?.status === "error"
        ? "error"
        : agentStatus);
  const selectedDiff =
    (selectedAgentId && diffByAgent[selectedAgentId]) || lastDiff;
  const amDrivingSelected =
    Boolean(selectedAgentId && drivingAgentIds.includes(selectedAgentId)) ||
    (agents.length <= 1 && (amDriver || amHost));

  useEffect(() => {
    if (!socket || !roomInfo) return;
    const onCursorSession = (
      sessionIdOrAgentId: string | null,
      sessionId?: string | null,
    ) => {
      // New: (agentId, sessionId); legacy: (sessionId)
      const next =
        sessionId !== undefined ? sessionId : sessionIdOrAgentId;
      onRoomInfo({
        ...roomInfo,
        cursorSessionId: next ?? undefined,
      });
    };
    socket.on("cursor-session-updated", onCursorSession);
    return () => {
      socket.off("cursor-session-updated", onCursorSession);
    };
  }, [socket, roomInfo, onRoomInfo]);

  useEffect(() => {
    let cancelled = false;
    if (selectedBackend === "claude-code") {
      setCachedModels(modelsCacheKey, CLAUDE_MODELS);
      const frame = requestAnimationFrame(() => {
        setModels(CLAUDE_MODELS);
        setModelError("");
      });
      return () => cancelAnimationFrame(frame);
    }

    const cached = getCachedModels(modelsCacheKey);
    const initialModels = cached?.length ? cached : FALLBACK_MODELS;
    const initialModelsFrame = requestAnimationFrame(() => {
      setModels(initialModels);
    });

    fetchRoomModels(roomId, selectedAgent?.id)
      .then((list) => {
        if (cancelled || !list.length) return;
        setCachedModels(modelsCacheKey, list);
        setModels(list);
        setModelError("");
      })
      .catch((err) => {
        if (cancelled) return;
        // Keep cached / fallback models — don't block chatting
        if (!getCachedModels(modelsCacheKey)?.length) {
          setModelError(
            err instanceof Error ? err.message : "Failed to load models",
          );
        }
      });
    return () => {
      cancelled = true;
      cancelAnimationFrame(initialModelsFrame);
    };
  }, [roomId, modelsCacheKey, selectedBackend, selectedAgent?.id]);

  const handleModelChange = useCallback(
    async (next: string) => {
      if (!selectedAgentId || !next || next === selectedModelId) return;
      setSavingModel(true);
      setModelError("");
      try {
        const updated = await updateRoomModel(
          roomId,
          next,
          selectedAgentId,
        );
        onRoomInfo(updated);
      } catch (err) {
        setModelError(
          err instanceof Error ? err.message : "Failed to change model",
        );
      } finally {
        setSavingModel(false);
      }
    },
    [selectedAgentId, selectedModelId, onRoomInfo, roomId],
  );

  const handleCursorSessionChange = useCallback(
    async (next: string | null) => {
      if (next === (selectedAgent?.sessionId || roomInfo?.cursorSessionId || null))
        return;
      setSavingCursorSession(true);
      setCursorSessionError("");
      try {
        const updated = await updateRoomCursorSession(
          roomId,
          next,
          selectedAgentId || undefined,
        );
        onRoomInfo(updated);
      } catch (err) {
        setCursorSessionError(
          err instanceof Error ? err.message : "Failed to switch Cursor chat",
        );
      } finally {
        setSavingCursorSession(false);
      }
    },
    [
      selectedAgent?.sessionId,
      roomInfo?.cursorSessionId,
      selectedAgentId,
      onRoomInfo,
      roomId,
    ],
  );

  const handleGrantDrive = useCallback(() => {
    if (!pendingRequest) return;
    grantDrive(
      pendingRequest.socketId,
      pendingRequest.agentId || selectedAgentId || undefined,
    );
  }, [pendingRequest, grantDrive, selectedAgentId]);

  const handleStopSession = useCallback(async () => {
    if (
      !window.confirm(
        "Stop this session? Everyone will be disconnected and the room will close.",
      )
    ) {
      return;
    }
    setStopping(true);
    setActionError("");
    try {
      await stopRoom(roomId);
      router.push("/dashboard?notice=" + encodeURIComponent("Session stopped"));
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Failed to stop session",
      );
      setStopping(false);
    }
  }, [roomId, router]);

  const handleAbortRun = useCallback(async () => {
    setAborting(true);
    setActionError("");
    try {
      await abortRoomRun(roomId, selectedAgentId || undefined);
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Failed to abort run",
      );
    } finally {
      setAborting(false);
    }
  }, [roomId, selectedAgentId]);

  const handleAddAgent = useCallback(
    async (data: {
      label: string;
      backend: "cursor" | "claude-code";
      scopePath?: string;
      modelId?: string;
      anthropicApiKey?: string;
      apiKey?: string;
    }) => {
      const agent = await addRoomAgent(roomId, data);
      setSelectedAgentId(agent.id);
      setChatFilterAgentId(agent.id);
    },
    [roomId],
  );

  const handleStopAgent = useCallback(
    async (agentId: string) => {
      if (!window.confirm("Stop this agent?")) return;
      try {
        await stopRoomAgent(roomId, agentId);
      } catch (err) {
        setActionError(
          err instanceof Error ? err.message : "Failed to stop agent",
        );
      }
    },
    [roomId],
  );

  const handleForceRelease = useCallback(
    async (path: string) => {
      try {
        await forceReleaseFileLock(roomId, path);
      } catch (err) {
        setActionError(
          err instanceof Error ? err.message : "Failed to release lock",
        );
      }
    },
    [roomId],
  );

  const fileCount = selectedDiff
    ? (selectedDiff.match(/^diff --git /gm) || []).length
    : 0;
  const visibleMessageCount =
    agents.length > 1 && chatFilterAgentId
      ? messages.filter((m) => !m.agentId || m.agentId === chatFilterAgentId)
          .length
      : messages.length;

  return (
    <div className="room-shell fixed inset-0 h-[100dvh] max-h-[100dvh] w-full flex flex-col bg-[#111111] text-[#e4e4e4] overflow-hidden overscroll-none">
      <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(circle_at_20%_0%,rgba(77,159,255,0.07),transparent_28%),radial-gradient(circle_at_84%_12%,rgba(62,207,142,0.045),transparent_26%)]" />

      <header className="relative z-20 shrink-0 border-b border-[#2b2b2b]/90 bg-[#171717]/95 backdrop-blur-xl pt-[env(safe-area-inset-top)]">
        <div className="flex items-center justify-between gap-3 px-3 sm:px-4 h-14">
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
          <Link
            href="/"
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#2b2b2b] bg-[#1f1f1f] text-[#a0a0a0] hover:text-[#e4e4e4] hover:border-[#3c3c3c] transition-colors shrink-0"
            aria-label="Steer home"
          >
            <Home className="h-4 w-4" strokeWidth={1.75} />
          </Link>
            <div className="min-w-0">
              <div className="flex items-center gap-2 min-w-0">
                <h1 className="text-[13px] sm:text-[14px] font-medium text-[#f0f0f0] truncate min-w-0">
                  {roomInfo?.name || roomId}
                </h1>
                <span
                  className={`hidden sm:inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium border ${
                    connected
                      ? "border-[#234337] bg-[#17251f] text-[#3ecf8e]"
                      : "border-[#4a2d2d] bg-[#241818] text-[#f07070]"
                  }`}
                  title={connected ? "Connected" : "Disconnected"}
                >
                  {connected ? (
                    <Wifi className="h-3 w-3" strokeWidth={1.8} />
                  ) : (
                    <WifiOff className="h-3 w-3" strokeWidth={1.8} />
                  )}
                  {connected ? "Live" : "Offline"}
                </span>
              </div>
              <div className="hidden sm:flex items-center gap-2 mt-0.5 text-[11px] text-[#6e6e6e]">
                <span className="inline-flex items-center gap-1">
                  {runtime === "cloud" ? (
                    <Cloud className="h-3 w-3" strokeWidth={1.75} />
                  ) : (
                    <Bot className="h-3 w-3" strokeWidth={1.75} />
                  )}
                  {runtime === "cloud" ? "Cloud room" : "Local room"}
                </span>
                <span className="text-[#3c3c3c]">•</span>
                <span>{agents.length || 1} agent{(agents.length || 1) === 1 ? "" : "s"}</span>
                <span className="text-[#3c3c3c]">•</span>
                <span>{visibleMessageCount} message{visibleMessageCount === 1 ? "" : "s"}</span>
                {selectedStatus === "running" && (
                  <>
                    <span className="text-[#3c3c3c]">•</span>
                    <span className="inline-flex items-center gap-1 text-[#4d9fff]">
                      <Activity className="h-3 w-3 animate-pulse" strokeWidth={1.75} />
                      Running
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setAgentsOpen(true)}
              className="lg:hidden inline-flex h-8 items-center gap-1.5 px-2.5 rounded-lg text-[11px] text-[#a0a0a0] hover:text-[#e4e4e4] border border-[#2b2b2b] hover:border-[#3c3c3c] bg-[#1f1f1f] transition-colors"
            >
              <PanelLeftOpen className="h-3.5 w-3.5" strokeWidth={1.75} />
              Agents{agents.length ? ` · ${agents.length}` : ""}
            </button>
            <button
              type="button"
              onClick={() => setChangesOpen(true)}
              className="lg:hidden inline-flex h-8 items-center gap-1.5 px-2.5 rounded-lg text-[11px] text-[#a0a0a0] hover:text-[#e4e4e4] border border-[#2b2b2b] hover:border-[#3c3c3c] bg-[#1f1f1f] transition-colors"
            >
              <PanelRightOpen className="h-3.5 w-3.5" strokeWidth={1.75} />
              {runtime === "cloud"
                ? "Cloud"
                : `Changes${fileCount > 0 ? ` · ${fileCount}` : ""}`}
            </button>
            <button
              type="button"
              onClick={() => setInviteOpen(true)}
              className="inline-flex h-8 items-center gap-1.5 px-2.5 sm:px-3 rounded-lg text-[11px] sm:text-[12px] text-[#a0a0a0] hover:text-[#e4e4e4] border border-[#2b2b2b] hover:border-[#3c3c3c] bg-[#1f1f1f] transition-colors"
            >
              <Share2 className="h-3.5 w-3.5" strokeWidth={1.75} />
              <span className="hidden sm:inline">Invite</span>
            </button>
            {selectedStatus === "running" && (
              <button
                type="button"
                onClick={() => void handleAbortRun()}
                disabled={aborting}
                className="inline-flex h-8 items-center gap-1.5 px-2.5 sm:px-3 rounded-lg text-[11px] sm:text-[12px] text-[#f07070] hover:text-[#ff8a8a] border border-[#3c2b2b] hover:border-[#5a3a3a] bg-[#1f1818] transition-colors disabled:opacity-50"
              >
                <Square className="h-3 w-3" strokeWidth={2} />
                <span className="hidden sm:inline">{aborting ? "Stopping…" : "Abort"}</span>
              </button>
            )}
            {amHost && (
              <button
                type="button"
                onClick={() => void handleStopSession()}
                disabled={stopping}
                className="hidden sm:inline-flex h-8 items-center gap-1.5 px-3 rounded-lg text-[12px] text-[#a0a0a0] hover:text-[#f07070] border border-[#2b2b2b] hover:border-[#3c3c3c] bg-[#1f1f1f] transition-colors disabled:opacity-50"
              >
                <StopCircle className="h-3.5 w-3.5" strokeWidth={1.75} />
                {stopping ? "Stopping…" : "Stop"}
              </button>
            )}
            {!amHost && (
              <button
                type="button"
                onClick={() => {
                  if (window.confirm("Leave this session?")) leaveRoom();
                }}
                className="hidden sm:inline-flex h-8 items-center px-3 rounded-lg text-[12px] text-[#a0a0a0] hover:text-[#f07070] border border-[#2b2b2b] hover:border-[#3c3c3c] bg-[#1f1f1f] transition-colors"
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
            <DriverControls
              amDriver={amDrivingSelected || amHost}
              pendingRequest={
                !pendingRequest?.agentId ||
                pendingRequest.agentId === selectedAgentId
                  ? (pendingRequest?.name ?? null)
                  : null
              }
              onRequestDrive={() =>
                requestDrive(selectedAgentId || undefined)
              }
              onReleaseDrive={() =>
                releaseDrive(selectedAgentId || undefined)
              }
              onGrantDrive={handleGrantDrive}
              onDismissRequest={dismissDriveRequest}
            />
          </div>
        </div>
      </header>

      <LockPanel
        conflicts={conflicts}
        fileLocks={fileLocks}
        agents={agents}
        currentAgentId={selectedAgentId}
        amHost={amHost}
        lastBlocked={lastBlocked}
        onForceRelease={handleForceRelease}
      />

      <main className="relative z-10 flex flex-1 min-h-0 min-w-0 overflow-hidden overscroll-none">
        <AgentTabs
          agents={agents}
          selectedAgentId={selectedAgentId}
          chatFilterAgentId={chatFilterAgentId}
          onSelectAgent={(id) => {
            setSelectedAgentId(id);
            setChatFilterAgentId(id);
          }}
          onSelectAll={() => setChatFilterAgentId(null)}
          statusByAgent={statusByAgent}
          participants={participants}
          models={models}
          amHost={amHost}
          onAddAgent={() => setAddAgentOpen(true)}
          onStopAgent={(id) => void handleStopAgent(id)}
        />

        <div className="flex-1 flex flex-col min-h-0 min-w-0 overflow-hidden bg-[#121212]/80">
          <ChatPanel
            messages={messages}
            agentStatus={selectedStatus}
            agents={agents}
            filterAgentId={
              agents.length > 1 ? chatFilterAgentId : null
            }
          />
        </div>

        <SidePanel
          socket={socket}
          lastDiff={selectedDiff}
          runtime={runtime}
          cloudMeta={cloudMeta}
          prUrl={selectedAgent?.prUrl || roomInfo?.prUrl}
          agentId={selectedAgentId}
        />
      </main>

      {agentsOpen && (
        <AgentTabs
          agents={agents}
          selectedAgentId={selectedAgentId}
          chatFilterAgentId={chatFilterAgentId}
          onSelectAgent={(id) => {
            setSelectedAgentId(id);
            setChatFilterAgentId(id);
            setAgentsOpen(false);
          }}
          onSelectAll={() => {
            setChatFilterAgentId(null);
            setAgentsOpen(false);
          }}
          statusByAgent={statusByAgent}
          participants={participants}
          models={models}
          amHost={amHost}
          onAddAgent={() => {
            setAgentsOpen(false);
            setAddAgentOpen(true);
          }}
          onStopAgent={(id) => void handleStopAgent(id)}
          mobile
          onClose={() => setAgentsOpen(false)}
        />
      )}

      {changesOpen && (
        <SidePanel
          socket={socket}
          lastDiff={selectedDiff}
          runtime={runtime}
          cloudMeta={cloudMeta}
          prUrl={selectedAgent?.prUrl || roomInfo?.prUrl}
          agentId={selectedAgentId}
          mobile
          onClose={() => setChangesOpen(false)}
        />
      )}

      <InvitePanel
        roomId={roomId}
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        canManage={amHost}
      />

      <AddAgentDialog
        open={addAgentOpen}
        onClose={() => setAddAgentOpen(false)}
        roomId={roomId}
        onSubmit={handleAddAgent}
        models={models}
        defaultModelId={selectedModelId}
        runtime={runtime}
        orgId={roomInfo?.orgId}
      />

      <footer className="relative z-20 border-t border-[#2b2b2b]/90 bg-[#171717]/95 backdrop-blur-xl shrink-0 overflow-hidden pb-[env(safe-area-inset-bottom)] shadow-[0_-20px_60px_rgba(0,0,0,0.24)]">
        {(modelError || cursorSessionError || actionError || agentError) && (
          <p className="px-3 pt-2 text-[11px] text-[#f07070]">
            {actionError || agentError || modelError || cursorSessionError}
          </p>
        )}
        {runtime === "local" &&
          roomInfo?.authMode === "cli" &&
          roomInfo.repoPath &&
          selectedBackend !== "claude-code" && (
          <div className="px-2 sm:px-3 pt-2">
            <CursorSessionPicker
              roomId={roomId}
              repoPath={roomInfo.repoPath}
              cursorSessionId={
                selectedAgent?.sessionId || roomInfo.cursorSessionId
              }
              disabled={selectedStatus === "running" || savingCursorSession}
              canChange={amHost}
              onSessionChange={(id) => void handleCursorSessionChange(id)}
            />
            <p className="text-[10px] text-[#6e6e6e] mt-1 px-0.5">
              {selectedAgent?.sessionId || roomInfo.cursorSessionId
                ? "Next message resumes this agent’s Cursor chat."
                : "First message starts a new Cursor chat; reopening this Steer session resumes it."}
            </p>
          </div>
        )}
        {runtime === "local" &&
          selectedBackend === "claude-code" &&
          selectedAgent?.sessionId && (
          <p className="px-3 pt-2 text-[10px] text-[#6e6e6e]">
            Claude Code resumes session {selectedAgent.sessionId.slice(0, 12)}…
            automatically on the next message.
          </p>
        )}
        <SteerInput
          onSend={(text) => sendSteer(text, selectedAgentId || undefined)}
          agentBusy={selectedStatus === "running"}
          connected={connected}
          models={models}
          modelId={selectedModelId}
          onModelChange={(id) => void handleModelChange(id)}
          modelDisabled={!amHost || savingModel}
          modelLockReason={
            !amHost
              ? "Only the host can change the model"
              : savingModel
                ? "Saving…"
                : undefined
          }
          placeholder={
            selectedAgent
              ? `Message ${selectedAgent.label}…`
              : "Message the agent…"
          }
          agentName={selectedAgent?.label}
          agentId={selectedAgentId || undefined}
          onTyping={notifyTyping}
          onTypingStop={notifyTypingStop}
          typingIndicator={
            selectedAgentId
              ? formatTypingIndicator(
                  (typingByAgent[selectedAgentId] || []).map((t) => t.name),
                  selectedAgent?.label || "Agent",
                )
              : ""
          }
        />
      </footer>
    </div>
  );
}
