"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  Columns2,
  Eye,
  Home,
  LayoutList,
  Settings2,
  Square,
} from "lucide-react";
import { useSocket } from "../../../hooks/useSocket";
import { useAuth } from "../../../components/AuthProvider";
import {
  abortRoomRun,
  ackRoomPing,
  addRoomAgent,
  exportRoomTranscript,
  fetchOrJoinRoom,
  fetchRoomModels,
  forceReleaseFileLock,
  stopRoom,
  stopRoomAgent,
  updateRoomAgent,
  updateRoomCursorSession,
  updateRoomModel,
  updateRoomSettings,
} from "../../../lib/api";
import {
  FALLBACK_MODELS,
  getCachedModels,
  setCachedModels,
} from "../../../lib/modelsCache";
import ChatPanel from "../../../components/ChatPanel";
import ApprovalCard from "../../../components/ApprovalCard";
import SidePanel from "../../../components/SidePanel";
import PresenceBar from "../../../components/PresenceBar";
import SteerInput from "../../../components/SteerInput";
import CursorSessionPicker from "../../../components/CursorSessionPicker";
import DriverControls from "../../../components/DriverControls";
import InvitePanel from "../../../components/InvitePanel";
import MemberRoster from "../../../components/MemberRoster";
import AgentTabs from "../../../components/AgentTabs";
import AgentSplitGrid from "../../../components/AgentSplitGrid";
import SplitViewMenu from "../../../components/SplitViewMenu";
import AddAgentDialog from "../../../components/AddAgentDialog";
import ContextPanel from "../../../components/ContextPanel";
import ToolDetailPanel from "../../../components/ToolDetailPanel";
import LockPanel from "../../../components/LockPanel";
import FlagForReviewDialog from "../../../components/FlagForReviewDialog";
import ReviewPingBanner from "../../../components/ReviewPingBanner";
import RoomSettingsDialog from "../../../components/RoomSettingsDialog";
import SlackConnectModal from "../../../components/SlackConnectModal";
import type {
  ApprovalMode,
  ControlMode,
  ModelInfo,
  PingInfo,
  RoomInfo,
  ChatMessage,
  RoomMemberInfo,
} from "../../../../shared/events";
import {
  CLAUDE_MODELS,
  DEFAULT_CLAUDE_MODEL,
} from "../../../../shared/claudeModels";
import {
  formatTypingIndicator,
  formatTypingIndicatorAll,
} from "../../../../shared/typing";
import { parseAutoMemoryMode, type AutoMemoryMode } from "../../../../shared/roomContext";
import {
  canRequestDrive,
  canSteerWithRole,
  steerDeniedReason,
  type RoomRole,
} from "../../../../shared/roomPermissions";
import {
  closeVisibleId,
  pinVisibleId,
  readBroadcastEnabled,
  syncVisibleIds,
  writeBroadcastEnabled,
} from "../../../lib/splitViewSettings";

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
            href="/dashboard"
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
    members: liveMembers,
    amDriver,
    mySocketId,
    messages,
    agents,
    statusByAgent,
    diffByAgent,
    conflicts,
    fileLocks,
    lastBlocked,
    pendingApprovals,
    openPings,
    typingByAgent,
    agentStatus,
    agentError,
    pendingRequest,
    pendingOutgoingDrive,
    lastDiff,
    cloudMeta,
    modelId: liveModelId,
    sendSteer,
    revertChanges,
    notifyTyping,
    notifyTypingStop,
    requestDrive,
    releaseDrive,
    grantDrive,
    decideApproval,
    approvePlan,
    dismissPlan,
    flagReview,
    ackReview,
    dismissReview,
    leaveRoom,
    removeMember,
    dismissDriveRequest,
    drivingAgentIds,
    roomContext,
    contextStale,
    autoMemoryNotice,
  } = useSocket(roomId, userName);

  const { user } = useAuth();
  const runtime = roomInfo?.runtime || "local";
  const modelId = liveModelId || roomInfo?.modelId || "auto";
  const controlMode: ControlMode = roomInfo?.controlMode || "open";
  const approvalMode: ApprovalMode = roomInfo?.approvalMode || "off";
  const autoMemory: AutoMemoryMode = parseAutoMemoryMode(roomInfo?.autoMemory);
  const myRole: RoomRole =
    roomInfo?.myRole ||
    (user?.id && roomInfo?.ownerId && user.id === roomInfo.ownerId
      ? "owner"
      : "editor");
  const amHost = myRole === "owner";
  const canManage = Boolean(roomInfo?.myCanManage || amHost);
  const canFlag = myRole === "owner" || myRole === "editor";
  const canEditMemory = myRole === "owner" || myRole === "editor";
  const [models, setModels] = useState<ModelInfo[]>(FALLBACK_MODELS);
  const [modelError, setModelError] = useState("");
  const [savingModel, setSavingModel] = useState(false);
  const [savingControlMode, setSavingControlMode] = useState(false);
  const [savingApprovalMode, setSavingApprovalMode] = useState(false);
  const [savingAutoMemory, setSavingAutoMemory] = useState(false);
  const [togglingPlanMode, setTogglingPlanMode] = useState(false);
  const [decidingApprovalId, setDecidingApprovalId] = useState<string | null>(
    null,
  );
  const [flagOpen, setFlagOpen] = useState(false);
  const [slackOpen, setSlackOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const deepAckedRef = useRef<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [rosterOpen, setRosterOpen] = useState(false);
  const [rosterMembers, setRosterMembers] = useState<RoomMemberInfo[]>([]);
  const [exporting, setExporting] = useState(false);
  const [agentsOpen, setAgentsOpen] = useState(false);
  const [changesOpen, setChangesOpen] = useState(false);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [addAgentOpen, setAddAgentOpen] = useState(false);
  const [selectedToolMessageId, setSelectedToolMessageId] = useState<
    string | null
  >(null);
  const [cursorSessionError, setCursorSessionError] = useState("");
  const [savingCursorSession, setSavingCursorSession] = useState(false);
  const [actionError, setActionError] = useState("");
  const [stopping, setStopping] = useState(false);
  const [aborting, setAborting] = useState(false);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [chatFilterAgentId, setChatFilterAgentId] = useState<string | null>(
    null,
  );
  const [viewMode, setViewMode] = useState<"tabs" | "split">("split");
  const [visibleIds, setVisibleIds] = useState<string[]>([]);
  const [broadcastEnabled, setBroadcastEnabled] = useState(true);
  const [splitViewMenuOpen, setSplitViewMenuOpen] = useState(false);
  const splitViewRef = useRef<HTMLDivElement>(null);

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
  const selectedToolMessage =
    messages.find((m) => m.id === selectedToolMessageId && m.role === "tool") ||
    null;
  useEffect(() => {
    if (!selectedToolMessageId) return;
    if (!selectedToolMessage) {
      setSelectedToolMessageId(null);
      return;
    }
    if (
      chatFilterAgentId &&
      selectedToolMessage.agentId &&
      selectedToolMessage.agentId !== chatFilterAgentId
    ) {
      setSelectedToolMessageId(null);
    }
  }, [chatFilterAgentId, selectedToolMessage, selectedToolMessageId]);
  const amDrivingSelected =
    Boolean(selectedAgentId && drivingAgentIds.includes(selectedAgentId)) ||
    (agents.length <= 1 && amDriver);
  const canSteerSelected = canSteerWithRole({
    role: myRole,
    controlMode,
    isDrivingAgent: amDrivingSelected,
  });
  const steerLockReason = steerDeniedReason({
    role: myRole,
    controlMode,
    isDrivingAgent: amDrivingSelected,
  });
  const showDriverControls = canRequestDrive(myRole);
  const splitActive = viewMode === "split" && agents.length > 1;
  const splitPool = useMemo(() => {
    const live = agents.filter((a) => a.status !== "stopped");
    return live.length ? live : agents;
  }, [agents]);
  const splitPoolIds = useMemo(() => splitPool.map((a) => a.id), [splitPool]);

  useEffect(() => {
    queueMicrotask(() => setBroadcastEnabled(readBroadcastEnabled()));
  }, []);

  useEffect(() => {
    setVisibleIds((prev) => syncVisibleIds(prev, splitPoolIds));
  }, [splitPoolIds]);

  useEffect(() => {
    if (!splitActive) setSplitViewMenuOpen(false);
  }, [splitActive]);

  useEffect(() => {
    if (!splitViewMenuOpen) return;
    const onPointer = (event: PointerEvent) => {
      if (!splitViewRef.current?.contains(event.target as Node)) {
        setSplitViewMenuOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSplitViewMenuOpen(false);
    };
    window.addEventListener("pointerdown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, [splitViewMenuOpen]);

  const handleBroadcastEnabledChange = (enabled: boolean) => {
    setBroadcastEnabled(enabled);
    writeBroadcastEnabled(enabled);
  };

  const handleShowSplitAgent = (id: string) => {
    setVisibleIds((prev) => pinVisibleId(prev, id));
    setSelectedAgentId(id);
    setChatFilterAgentId(id);
  };

  const handleHideSplitAgent = (id: string) => {
    setVisibleIds((prev) => closeVisibleId(prev, id));
  };

  const handleFocusSplitAgent = (id: string) => {
    setSelectedAgentId(id);
    setChatFilterAgentId(id);
  };

  const handleBroadcast = (text: string) => {
    for (const id of visibleIds) {
      const driving = drivingAgentIds.includes(id);
      const canSteer = canSteerWithRole({
        role: myRole,
        controlMode,
        isDrivingAgent: driving,
      });
      if (!canSteer) continue;
      sendSteer(text, id);
    }
  };

  useEffect(() => {
    if (!socket || !roomInfo) return;
    const onControlMode = (mode: ControlMode) => {
      onRoomInfo({ ...roomInfo, controlMode: mode });
    };
    socket.on("control-mode-updated", onControlMode);
    return () => {
      socket.off("control-mode-updated", onControlMode);
    };
  }, [socket, roomInfo, onRoomInfo]);

  // Deep-link ack from Slack: /room/:id?ping=:pingId
  useEffect(() => {
    if (typeof window === "undefined" || !user?.id) return;
    const params = new URLSearchParams(window.location.search);
    const pingId = params.get("ping");
    if (!pingId) return;
    if (deepAckedRef.current === pingId) return;
    deepAckedRef.current = pingId;
    void ackRoomPing(roomId, pingId, userName)
      .catch((err) => {
        console.warn(
          "Failed to ack review ping:",
          err instanceof Error ? err.message : err,
        );
      })
      .finally(() => {
        params.delete("ping");
        const qs = params.toString();
        router.replace(qs ? `/room/${roomId}?${qs}` : `/room/${roomId}`, {
          scroll: false,
        });
      });
  }, [roomId, user?.id, userName, router]);

  const relevantPings: PingInfo[] = openPings.filter((ping) => {
    if (ping.targets === "everyone") return true;
    if (user?.id && ping.targets.includes(user.id)) return true;
    if (user?.id && ping.actorUserId === user.id) return true;
    return canManage;
  });
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

  const handleModelChangeForAgent = useCallback(
    async (agentId: string, next: string) => {
      const current =
        agents.find((a) => a.id === agentId)?.modelId || selectedModelId;
      if (!agentId || !next || next === current) return;
      setSavingModel(true);
      setModelError("");
      try {
        const updated = await updateRoomModel(roomId, next, agentId);
        onRoomInfo(updated);
      } catch (err) {
        setModelError(
          err instanceof Error ? err.message : "Failed to change model",
        );
      } finally {
        setSavingModel(false);
      }
    },
    [agents, selectedModelId, onRoomInfo, roomId],
  );

  const handleModelChange = useCallback(
    async (next: string) => {
      if (!selectedAgentId) return;
      await handleModelChangeForAgent(selectedAgentId, next);
    },
    [selectedAgentId, handleModelChangeForAgent],
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
      planMode?: boolean;
      seedContext?: boolean;
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

  const handleControlModeChange = useCallback(
    async (mode: ControlMode) => {
      if (!canManage || mode === controlMode) return;
      setSavingControlMode(true);
      setActionError("");
      try {
        const updated = await updateRoomSettings(roomId, { controlMode: mode });
        onRoomInfo(updated);
      } catch (err) {
        setActionError(
          err instanceof Error ? err.message : "Failed to update control mode",
        );
      } finally {
        setSavingControlMode(false);
      }
    },
    [canManage, controlMode, roomId, onRoomInfo],
  );

  const handleApprovalModeChange = useCallback(
    async (mode: ApprovalMode) => {
      if (!canManage || mode === approvalMode) return;
      setSavingApprovalMode(true);
      setActionError("");
      try {
        const updated = await updateRoomSettings(roomId, {
          approvalMode: mode,
        });
        onRoomInfo(updated);
      } catch (err) {
        setActionError(
          err instanceof Error ? err.message : "Failed to update approval mode",
        );
      } finally {
        setSavingApprovalMode(false);
      }
    },
    [canManage, approvalMode, roomId, onRoomInfo],
  );

  const handleAutoMemoryChange = useCallback(
    async (mode: AutoMemoryMode) => {
      if (!canManage || mode === autoMemory) return;
      setSavingAutoMemory(true);
      setActionError("");
      try {
        const updated = await updateRoomSettings(roomId, { autoMemory: mode });
        onRoomInfo(updated);
      } catch (err) {
        setActionError(
          err instanceof Error ? err.message : "Failed to update auto memory",
        );
      } finally {
        setSavingAutoMemory(false);
      }
    },
    [canManage, autoMemory, roomId, onRoomInfo],
  );

  const handleTogglePlanMode = useCallback(async () => {
    if (!canManage || !selectedAgentId || !selectedAgent) return;
    setTogglingPlanMode(true);
    setActionError("");
    try {
      await updateRoomAgent(roomId, selectedAgentId, {
        planMode: !selectedAgent.planMode,
      });
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Failed to toggle plan mode",
      );
    } finally {
      setTogglingPlanMode(false);
    }
  }, [canManage, selectedAgentId, selectedAgent, roomId]);

  const handleDecideApproval = useCallback(
    (requestId: string, approved: boolean) => {
      setDecidingApprovalId(requestId);
      decideApproval(requestId, approved);
      window.setTimeout(() => setDecidingApprovalId(null), 800);
    },
    [decideApproval],
  );

  useEffect(() => {
    if (liveMembers.length) setRosterMembers(liveMembers);
  }, [liveMembers]);

  const handleExport = useCallback(async () => {
    setExporting(true);
    setActionError("");
    try {
      const exported = await exportRoomTranscript(roomId);
      const blob = new Blob([exported.summary], {
        type: "text/markdown;charset=utf-8",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${(roomInfo?.name || "session").replace(/[^\w.-]+/g, "-")}-transcript.md`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Failed to export transcript",
      );
    } finally {
      setExporting(false);
    }
  }, [roomId, roomInfo?.name]);

  const activeMemoryCount = (roomContext?.entries || []).filter(
    (e) => e.status === "active",
  ).length;
  const proposedMemoryCount = (roomContext?.entries || []).filter(
    (e) => e.status === "proposed",
  ).length;

  return (
    <div className="room-shell fixed inset-0 h-[100dvh] max-h-[100dvh] w-full flex flex-col bg-[#111111] text-[#e4e4e4] overflow-hidden overscroll-none">
      <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(circle_at_20%_0%,rgba(77,159,255,0.07),transparent_28%),radial-gradient(circle_at_84%_12%,rgba(62,207,142,0.045),transparent_26%)]" />

      <header className="relative z-20 shrink-0 border-b border-[#2b2b2b]/90 bg-[#171717]/95 backdrop-blur-xl pt-[env(safe-area-inset-top)]">
        <div className="flex items-center justify-between gap-3 px-3 sm:px-4 h-12">
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            <Link
              href="/dashboard"
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#2b2b2b] bg-[#1f1f1f] text-[#a0a0a0] hover:text-[#e4e4e4] hover:border-[#3c3c3c] transition-colors shrink-0"
              aria-label="Go to dashboard"
            >
              <Home className="h-4 w-4" strokeWidth={1.75} />
            </Link>
            <h1 className="text-[13px] sm:text-[14px] font-medium text-[#f0f0f0] truncate min-w-0">
              {roomInfo?.name || roomId}
            </h1>
            {agents.length > 1 && (
              <div className="inline-flex items-center gap-1.5 shrink-0">
                <div className="inline-flex items-center rounded-lg border border-[#2b2b2b] bg-[#1a1a1a] p-0.5">
                  <button
                    type="button"
                    onClick={() => setViewMode("split")}
                    className={`inline-flex h-7 items-center gap-1 px-2 rounded-md text-[11px] ${
                      viewMode === "split"
                        ? "bg-[#252525] text-[#e4e4e4]"
                        : "text-[#8a8a8a] hover:text-[#c8c8c8]"
                    }`}
                    title="Split agents"
                  >
                    <Columns2 className="h-3.5 w-3.5" strokeWidth={1.75} />
                    Split
                  </button>
                  <button
                    type="button"
                    onClick={() => setViewMode("tabs")}
                    className={`inline-flex h-7 items-center gap-1 px-2 rounded-md text-[11px] ${
                      viewMode === "tabs"
                        ? "bg-[#252525] text-[#e4e4e4]"
                        : "text-[#8a8a8a] hover:text-[#c8c8c8]"
                    }`}
                    title="One agent at a time"
                  >
                    <LayoutList className="h-3.5 w-3.5" strokeWidth={1.75} />
                    Tabs
                  </button>
                </div>
                {splitActive && (
                  <div className="relative" ref={splitViewRef}>
                    <button
                      type="button"
                      onClick={() => setSplitViewMenuOpen((open) => !open)}
                      aria-expanded={splitViewMenuOpen}
                      aria-haspopup="dialog"
                      className={`inline-flex h-8 w-8 items-center justify-center rounded-lg border transition-colors ${
                        splitViewMenuOpen
                          ? "border-[#26405d] bg-[#17202a] text-[#8ec5ff]"
                          : "border-[#2b2b2b] bg-[#1f1f1f] text-[#a0a0a0] hover:text-[#e4e4e4] hover:border-[#3c3c3c]"
                      }`}
                      title="Visible agents"
                    >
                      <Eye className="h-3.5 w-3.5" strokeWidth={1.75} />
                    </button>
                    <SplitViewMenu
                      open={splitViewMenuOpen}
                      agents={splitPool}
                      visibleIds={visibleIds}
                      statusByAgent={statusByAgent}
                      broadcastEnabled={broadcastEnabled}
                      connected={connected}
                      onShow={handleShowSplitAgent}
                      onHide={handleHideSplitAgent}
                      onFocus={handleFocusSplitAgent}
                      onBroadcast={handleBroadcast}
                    />
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[#a0a0a0] hover:text-[#e4e4e4] border border-[#2b2b2b] hover:border-[#3c3c3c] bg-[#1f1f1f] transition-colors"
              title="Room settings"
            >
              <Settings2 className="h-3.5 w-3.5" strokeWidth={1.75} />
            </button>
            {selectedStatus === "running" && canSteerSelected && (
              <button
                type="button"
                onClick={() => void handleAbortRun()}
                disabled={aborting}
                className="inline-flex h-8 items-center gap-1.5 px-2.5 rounded-lg text-[11px] text-[#f07070] hover:text-[#ff8a8a] border border-[#3c2b2b] hover:border-[#5a3a3a] bg-[#1f1818] transition-colors disabled:opacity-50"
              >
                <Square className="h-3 w-3" strokeWidth={2} />
                <span className="hidden sm:inline">{aborting ? "Stopping…" : "Abort"}</span>
              </button>
            )}
            <PresenceBar
              onlyMe
              participants={participants}
              mySocketId={mySocketId}
              amHost={canManage}
            />
            {showDriverControls && (
              <DriverControls
                amDriver={amDrivingSelected}
                canGrant={canManage || amDrivingSelected}
                pendingRequest={
                  !pendingRequest?.agentId ||
                  pendingRequest.agentId === selectedAgentId
                    ? (pendingRequest?.name ?? null)
                    : null
                }
                pendingOutgoing={
                  Boolean(pendingOutgoingDrive) &&
                  (!pendingOutgoingDrive?.agentId ||
                    pendingOutgoingDrive.agentId === selectedAgentId)
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
            )}
          </div>
        </div>
      </header>

      <LockPanel
        conflicts={conflicts}
        fileLocks={fileLocks}
        agents={agents}
        currentAgentId={selectedAgentId}
        amHost={canManage}
        lastBlocked={lastBlocked}
        onForceRelease={handleForceRelease}
      />

      <main className="relative z-10 flex flex-1 min-h-0 min-w-0 overflow-hidden overscroll-none">
        {!splitActive && (
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
            amHost={canManage}
            onAddAgent={() => setAddAgentOpen(true)}
            onStopAgent={(id) => void handleStopAgent(id)}
          />
        )}

        <div className="flex-1 flex flex-col min-h-0 min-w-0 overflow-hidden bg-[#121212]/80">
          {relevantPings.length > 0 && (
            <div
              id="review-pings"
              className="shrink-0 border-b border-[#3a2a1c] bg-[#14110e] px-3 py-2 space-y-2 max-h-[35%] overflow-y-auto"
            >
              {relevantPings.map((ping) => (
                <ReviewPingBanner
                  key={ping.id}
                  ping={ping}
                  myUserId={user?.id}
                  canDismiss={
                    canManage || Boolean(user?.id && ping.actorUserId === user.id)
                  }
                  onAck={() => ackReview(ping.id)}
                  onDismiss={() => dismissReview(ping.id)}
                />
              ))}
            </div>
          )}
          {pendingApprovals.length > 0 && (
            <div className="shrink-0 border-b border-[#2e2a1c] bg-[#16140f] px-3 py-2 space-y-2 max-h-[40%] overflow-y-auto">
              {pendingApprovals.map((req) => {
                const drivingThis =
                  drivingAgentIds.includes(req.agentId) ||
                  (agents.length <= 1 && amDriver);
                const canDecide =
                  (myRole === "owner" || myRole === "editor") &&
                  (myRole === "owner" || !drivingThis);
                return (
                  <ApprovalCard
                    key={req.id}
                    request={req}
                    canDecide={canDecide}
                    deciding={decidingApprovalId === req.id}
                    onDecide={(approved) =>
                      handleDecideApproval(req.id, approved)
                    }
                  />
                );
              })}
            </div>
          )}
          {splitActive ? (
            <AgentSplitGrid
              agents={agents}
              messages={messages}
              roomId={roomId}
              statusByAgent={statusByAgent}
              typingByAgent={typingByAgent}
              drivingAgentIds={drivingAgentIds}
              myRole={myRole}
              controlMode={controlMode}
              connected={connected}
              models={models}
              canManage={canManage}
              savingModel={savingModel}
              selectedToolMessageId={selectedToolMessageId}
              onSelectToolMessage={(message: ChatMessage) =>
                setSelectedToolMessageId(message.id)
              }
              onSend={(text, agentId, attachmentIds) =>
                sendSteer(text, agentId, attachmentIds)
              }
              onTyping={notifyTyping}
              onTypingStop={notifyTypingStop}
              onModelChange={(agentId, modelId) =>
                void handleModelChangeForAgent(agentId, modelId)
              }
              onApprovePlan={(messageId, agentId) =>
                approvePlan(messageId, agentId)
              }
              onDismissPlan={(messageId) => dismissPlan(messageId)}
              onAnswerQuestions={(messageId, answers) => {
                const msg = messages.find((m) => m.id === messageId);
                if (!msg) return;
                const lines = Object.entries(answers)
                  .filter(([, v]) => v)
                  .map(([q, a]) => `**${q}**\n${a}`)
                  .join("\n\n");
                if (lines) {
                  sendSteer(lines, msg.agentId || undefined);
                }
              }}
              onRevertMessage={(messageId, agentId) => {
                revertChanges({ messageId, agentId });
              }}
              visibleIds={visibleIds}
              onVisibleIdsChange={setVisibleIds}
            />
          ) : (
            <ChatPanel
              messages={messages}
              agentStatus={selectedStatus}
              agents={agents}
              filterAgentId={
                agents.length > 1 ? chatFilterAgentId : null
              }
              roomId={roomId}
              canApprovePlan={canSteerSelected}
              onApprovePlan={(messageId, agentId) =>
                approvePlan(messageId, agentId)
              }
              onDismissPlan={(messageId) => dismissPlan(messageId)}
              selectedToolMessageId={selectedToolMessageId}
              onSelectToolMessage={(message: ChatMessage) =>
                setSelectedToolMessageId(message.id)
              }
              onAnswerQuestions={(messageId, answers) => {
                const msg = messages.find((m) => m.id === messageId);
                if (!msg) return;
                const lines = Object.entries(answers)
                  .filter(([, v]) => v)
                  .map(([q, a]) => `**${q}**\n${a}`)
                  .join("\n\n");
                if (lines) {
                  sendSteer(lines, msg.agentId || undefined);
                }
              }}
              onRevertMessage={(messageId, agentId) => {
                revertChanges({ messageId, agentId });
              }}
            />
          )}
        </div>

        {!splitActive && (
          <ToolDetailPanel
            message={selectedToolMessage}
            onClose={() => setSelectedToolMessageId(null)}
            onRevert={
              canManage &&
              selectedToolMessage?.diffPatch &&
              selectedToolMessage.status === "done" &&
              !selectedToolMessage.reverted
                ? () => {
                    if (
                      window.confirm(
                        "Revert this file change? This discards the LLM edits for this tool call.",
                      )
                    ) {
                      revertChanges({
                        messageId: selectedToolMessage.id,
                        agentId: selectedToolMessage.agentId,
                      });
                    }
                  }
                : undefined
            }
          />
        )}
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
          amHost={canManage}
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

      {selectedToolMessage && (
        <ToolDetailPanel
          message={selectedToolMessage}
          mobile
          onClose={() => setSelectedToolMessageId(null)}
          onRevert={
            canManage &&
            selectedToolMessage?.diffPatch &&
            selectedToolMessage.status === "done" &&
            !selectedToolMessage.reverted
              ? () => {
                  if (
                    window.confirm(
                      "Revert this file change? This discards the LLM edits for this tool call.",
                    )
                  ) {
                    revertChanges({
                      messageId: selectedToolMessage.id,
                      agentId: selectedToolMessage.agentId,
                    });
                  }
                }
              : undefined
          }
        />
      )}

      {memoryOpen && (
        <ContextPanel
          roomId={roomId}
          snapshot={roomContext}
          canEdit={canEditMemory}
          selectedAgentId={selectedAgentId}
          selectedAgentLabel={selectedAgent?.label}
          agentIdle={selectedStatus !== "running"}
          stale={contextStale}
          mobile
          onClose={() => setMemoryOpen(false)}
        />
      )}

      <RoomSettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        roomName={roomInfo?.name || roomId}
        roomId={roomId}
        myRole={myRole}
        controlMode={controlMode}
        approvalMode={approvalMode}
        autoMemory={autoMemory}
        canManage={canManage}
        amHost={amHost}
        selectedAgent={selectedAgent}
        slackConfigured={Boolean(roomInfo?.slackNotifyConfigured)}
        runtime={runtime}
        planModeBusy={togglingPlanMode}
        savingControlMode={savingControlMode}
        savingApprovalMode={savingApprovalMode}
        savingAutoMemory={savingAutoMemory}
        exporting={exporting}
        stopping={stopping}
        onControlModeChange={(mode) => void handleControlModeChange(mode)}
        onApprovalModeChange={(mode) => void handleApprovalModeChange(mode)}
        onAutoMemoryChange={(mode) => void handleAutoMemoryChange(mode)}
        onTogglePlanMode={() => void handleTogglePlanMode()}
        onOpenSlack={() => {
          setSettingsOpen(false);
          setSlackOpen(true);
        }}
        onOpenInvites={() => {
          setSettingsOpen(false);
          setInviteOpen(true);
        }}
        onExport={() => void handleExport()}
        onStopSession={() => void handleStopSession()}
        onLeave={() => {
          if (window.confirm("Leave this session?")) leaveRoom();
        }}
        onOpenAgents={() => {
          setSettingsOpen(false);
          setAgentsOpen(true);
        }}
        onOpenMemory={() => {
          setSettingsOpen(false);
          setMemoryOpen(true);
        }}
        onOpenChanges={() => {
          setSettingsOpen(false);
          setChangesOpen(true);
        }}
        onOpenMembers={() => {
          setSettingsOpen(false);
          setRosterOpen(true);
        }}
        onOpenFlag={
          canFlag
            ? () => {
                setSettingsOpen(false);
                setFlagOpen(true);
              }
            : undefined
        }
        splitAvailable={agents.length > 1}
        broadcastEnabled={broadcastEnabled}
        onBroadcastEnabledChange={handleBroadcastEnabledChange}
        splitAgents={splitPool}
        visibleAgentIds={visibleIds}
        statusByAgent={statusByAgent}
        onShowSplitAgent={handleShowSplitAgent}
        onHideSplitAgent={handleHideSplitAgent}
        onFocusSplitAgent={handleFocusSplitAgent}
      />

      <InvitePanel
        roomId={roomId}
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        canManage={canManage}
      />

      <FlagForReviewDialog
        open={flagOpen}
        onClose={() => setFlagOpen(false)}
        members={rosterMembers.length ? rosterMembers : liveMembers}
        myUserId={user?.id}
        slackConfigured={Boolean(roomInfo?.slackNotifyConfigured)}
        onFlag={(payload) => flagReview(payload)}
        onOpenSlack={() => {
          setFlagOpen(false);
          setSettingsOpen(true);
        }}
      />

      <SlackConnectModal
        roomId={roomId}
        open={slackOpen}
        onClose={() => setSlackOpen(false)}
        canManage={canManage}
        onUpdated={() => {
          void fetchOrJoinRoom(roomId).then(onRoomInfo).catch(() => {});
        }}
      />

      <MemberRoster
        roomId={roomId}
        open={rosterOpen}
        onClose={() => setRosterOpen(false)}
        canManage={canManage}
        myUserId={user?.id}
        liveMembers={rosterMembers.length ? rosterMembers : liveMembers}
        onMembersChange={setRosterMembers}
        agentLabels={Object.fromEntries(agents.map((a) => [a.id, a.label]))}
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

      {splitActive && (modelError || cursorSessionError || actionError || agentError) && (
        <p className="relative z-20 shrink-0 px-3 py-2 text-[11px] text-[#f07070] border-t border-[#2b2b2b] bg-[#171717]">
          {actionError || agentError || modelError || cursorSessionError}
        </p>
      )}
      {!splitActive && (
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
              canChange={canManage}
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
          onSend={(text, attachmentIds) =>
            sendSteer(text, selectedAgentId || undefined, attachmentIds)
          }
          roomId={roomId}
          planMode={Boolean(selectedAgent?.planMode)}
          agentBusy={selectedStatus === "running"}
          connected={connected}
          canSteer={canSteerSelected}
          steerLockReason={steerLockReason || undefined}
          models={models}
          modelId={selectedModelId}
          onModelChange={(id) => void handleModelChange(id)}
          modelDisabled={!canManage || savingModel}
          modelLockReason={
            !canManage
              ? "Only the host or a team admin can change the model"
              : savingModel
                ? "Saving…"
                : undefined
          }
          placeholder={
            !canSteerSelected
              ? steerLockReason || "View only"
              : selectedAgent
                ? `Message ${selectedAgent.label}…`
                : "Message the agent…"
          }
          agentName={selectedAgent?.label}
          agentId={selectedAgentId || undefined}
          onTyping={canSteerSelected ? notifyTyping : undefined}
          onTypingStop={canSteerSelected ? notifyTypingStop : undefined}
          typingIndicator={
            chatFilterAgentId === null && agents.length > 1
              ? formatTypingIndicatorAll(typingByAgent, agents)
              : selectedAgentId
                ? formatTypingIndicator(
                    (typingByAgent[selectedAgentId] || []).map((t) => t.name),
                    selectedAgent?.label || "Agent",
                  )
                : ""
          }
          contextHint={
            autoMemoryNotice
              ? `Saved ${autoMemoryNotice.count} auto memor${
                  autoMemoryNotice.count === 1 ? "y" : "ies"
                }`
              : contextStale &&
                selectedAgentId &&
                contextStale.agentId === selectedAgentId
              ? `Memory stale (v${contextStale.usedVersion} → v${contextStale.currentVersion})`
              : proposedMemoryCount
                ? `${proposedMemoryCount} memory proposal${proposedMemoryCount === 1 ? "" : "s"} to review`
                : activeMemoryCount
                  ? `Using ${activeMemoryCount} shared memor${activeMemoryCount === 1 ? "y" : "ies"}`
                  : roomContext?.map?.status === "ready"
                    ? "Repo map ready"
                    : "Room memory"
          }
          onOpenContext={() => setMemoryOpen(true)}
        />
      </footer>
      )}
    </div>
  );
}
