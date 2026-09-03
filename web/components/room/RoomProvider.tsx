"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useSocket } from "../../hooks/useSocket";
import { useAuth } from "../AuthProvider";
import {
  abortRoomRun,
  ackRoomPing,
  addRoomAgent,
  exportRoomTranscript,
  fetchRoomModels,
  forceReleaseFileLock,
  stopRoom,
  stopRoomAgent,
  updateRoomAgent,
  updateRoomCursorSession,
  updateRoomModel,
  updateRoomSettings,
} from "../../lib/api";
import {
  FALLBACK_MODELS,
  getCachedModels,
  setCachedModels,
} from "../../lib/modelsCache";
import { computeRoomAttention } from "../../../shared/roomAttention";
import {
  closeVisibleId,
  pinVisibleId,
  readBroadcastEnabled,
  syncVisibleIds,
  writeBroadcastEnabled,
} from "../../lib/splitViewSettings";
import type {
  ApprovalMode,
  ControlMode,
  ModelInfo,
  PingInfo,
  RoomInfo,
  RoomMemberInfo,
} from "../../../shared/events";
import {
  CLAUDE_MODELS,
  DEFAULT_CLAUDE_MODEL,
} from "../../../shared/claudeModels";
import { parseAutoMemoryMode, type AutoMemoryMode } from "../../../shared/roomContext";
import {
  canRequestDrive,
  canSteerWithRole,
  steerDeniedReason,
  type RoomRole,
} from "../../../shared/roomPermissions";
import {
  RoomContextProvider,
  type RoomVariant,
} from "./RoomContext";

export default function RoomProvider({
  roomId,
  userName,
  roomInfo,
  onRoomInfo,
  variant = "page",
  homeHref = "/dashboard",
  onHome,
  onExpand,
  onRemove,
  onKicked,
  children,
}: {
  roomId: string;
  userName: string;
  roomInfo: RoomInfo | null;
  onRoomInfo: (info: RoomInfo) => void;
  variant?: RoomVariant;
  homeHref?: string;
  onHome?: () => void;
  onExpand?: () => void;
  onRemove?: () => void;
  onKicked?: (reason: string) => void;
  children: React.ReactNode;
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
    errorByAgent,
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
    dismissDriveRequest,
    drivingAgentIds,
    roomContext,
    contextStale,
    autoMemoryNotice,
  } = useSocket(roomId, userName, {
    onKicked: (reason) => {
      if (onKicked) {
        onKicked(reason);
        return;
      }
      window.location.href = `/dashboard?notice=${encodeURIComponent(reason || "Left session")}`;
    },
  });

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
  const [seenMessageCount, setSeenMessageCount] = useState(0);
  const historyPrimedRef = useRef(false);

  useEffect(() => {
    if (!agents.length) return;
    if (!selectedAgentId || !agents.some((a) => a.id === selectedAgentId)) {
      const first = agents.find((a) => a.status !== "stopped") || agents[0];
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
  const selectedStatus =
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
  const splitActive = variant !== "tile" && viewMode === "split" && agents.length > 1;
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

  useEffect(() => {
    if (variant !== "tile") {
      setSeenMessageCount(messages.length);
      historyPrimedRef.current = true;
      return;
    }
    if (!historyPrimedRef.current && messages.length) {
      historyPrimedRef.current = true;
      setSeenMessageCount(messages.length);
    }
  }, [variant, messages.length]);

  const unreadCount =
    variant === "tile" ? Math.max(0, messages.length - seenMessageCount) : 0;

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

  useEffect(() => {
    if (typeof window === "undefined" || !user?.id || variant === "tile") return;
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
  }, [roomId, user?.id, userName, router, variant]);

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
      const next = sessionId !== undefined ? sessionId : sessionIdOrAgentId;
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
      if (onRemove) {
        onRemove();
        return;
      }
      router.push("/dashboard?notice=" + encodeURIComponent("Session stopped"));
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Failed to stop session",
      );
      setStopping(false);
    }
  }, [roomId, router, onRemove]);

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

  const handleAnswerQuestions = useCallback(
    (messageId: string, answers: Record<string, string>) => {
      const msg = messages.find((m) => m.id === messageId);
      if (!msg) return;
      const lines = Object.entries(answers)
        .filter(([, v]) => v)
        .map(([q, a]) => `**${q}**\n${a}`)
        .join("\n\n");
      if (lines) sendSteer(lines, msg.agentId || undefined);
    },
    [messages, sendSteer],
  );

  const canRevertSelectedTool = Boolean(
    canManage &&
      selectedToolMessage?.diffPatch &&
      selectedToolMessage.status === "done" &&
      !selectedToolMessage.reverted,
  );

  const handleRevertToolMessage = useCallback(() => {
    if (!selectedToolMessage || !canRevertSelectedTool) return;
    if (
      !window.confirm(
        "Revert this file change? This discards the LLM edits for this tool call.",
      )
    ) {
      return;
    }
    revertChanges({
      messageId: selectedToolMessage.id,
      agentId: selectedToolMessage.agentId,
    });
  }, [canRevertSelectedTool, revertChanges, selectedToolMessage]);

  const attention = computeRoomAttention({
    pendingApprovals,
    openPings: relevantPings,
    agentError,
    errorByAgent,
    agentStatus,
    statusByAgent,
    pendingDrive: Boolean(pendingRequest),
    unreadCount,
  });

  return (
    <RoomContextProvider
      value={{
        variant,
        homeHref,
        onHome,
        onExpand,
        onRemove,
        roomId,
        userName,
        roomInfo,
        onRoomInfo,
        userId: user?.id,
        socket,
        connected,
        participants,
        liveMembers,
        amDriver,
        mySocketId,
        messages,
        agents,
        statusByAgent,
        errorByAgent,
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
        sendSteer,
        revertChanges,
        notifyTyping,
        notifyTypingStop,
        requestDrive,
        releaseDrive,
        approvePlan,
        dismissPlan,
        flagReview,
        ackReview,
        dismissReview,
        leaveRoom,
        dismissDriveRequest,
        drivingAgentIds,
        roomContext,
        contextStale,
        autoMemoryNotice,
        runtime,
        controlMode,
        approvalMode,
        autoMemory,
        myRole,
        amHost,
        canManage,
        canFlag,
        canEditMemory,
        models,
        modelError,
        savingModel,
        savingControlMode,
        savingApprovalMode,
        savingAutoMemory,
        togglingPlanMode,
        decidingApprovalId,
        flagOpen,
        setFlagOpen,
        slackOpen,
        setSlackOpen,
        settingsOpen,
        setSettingsOpen,
        inviteOpen,
        setInviteOpen,
        rosterOpen,
        setRosterOpen,
        rosterMembers,
        setRosterMembers,
        exporting,
        agentsOpen,
        setAgentsOpen,
        changesOpen,
        setChangesOpen,
        memoryOpen,
        setMemoryOpen,
        addAgentOpen,
        setAddAgentOpen,
        selectedToolMessageId,
        setSelectedToolMessageId,
        cursorSessionError,
        savingCursorSession,
        actionError,
        stopping,
        aborting,
        selectedAgentId,
        setSelectedAgentId,
        chatFilterAgentId,
        setChatFilterAgentId,
        viewMode,
        setViewMode,
        visibleIds,
        setVisibleIds,
        broadcastEnabled,
        splitViewMenuOpen,
        setSplitViewMenuOpen,
        splitViewRef,
        selectedAgent,
        selectedBackend,
        selectedModelId,
        selectedStatus,
        selectedDiff,
        selectedToolMessage,
        amDrivingSelected,
        canSteerSelected,
        steerLockReason,
        showDriverControls,
        splitActive,
        splitPool,
        relevantPings,
        attention,
        unreadCount,
        handleBroadcastEnabledChange,
        handleShowSplitAgent,
        handleHideSplitAgent,
        handleFocusSplitAgent,
        handleBroadcast,
        handleModelChangeForAgent,
        handleModelChange,
        handleCursorSessionChange,
        handleGrantDrive,
        handleStopSession,
        handleAbortRun,
        handleAddAgent,
        handleStopAgent,
        handleForceRelease,
        handleControlModeChange,
        handleApprovalModeChange,
        handleAutoMemoryChange,
        handleTogglePlanMode,
        handleDecideApproval,
        handleExport,
        handleAnswerQuestions,
        handleRevertToolMessage,
        canRevertSelectedTool,
      }}
    >
      {children}
    </RoomContextProvider>
  );
}
