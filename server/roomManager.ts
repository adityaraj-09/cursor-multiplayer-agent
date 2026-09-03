import { Server, Socket } from "socket.io";
import { nanoid } from "nanoid";
import { resolve } from "path";
import { existsSync } from "fs";
import { AgentRunner } from "./agentRunner.js";
import {
  SdkAgentSession,
  listModelsForKey,
  type SdkStreamEvent,
} from "./sdkAgent.js";
import {
  ClaudeSandboxSession,
  isClaudeSandboxConfigured,
} from "./claudeSandbox.js";
import {
  commentOnPullRequest,
  ensurePullRequest,
  githubTokenFromEnv,
  parseGithubRepoUrl,
} from "./githubPr.js";
import {
  buildIntegratePrompt,
  buildIntegrationPrBody,
  buildIntegrationPrComment,
  featureAgentSnapshots,
  integrationBranchName,
} from "./integration.js";
import {
  dequeueNextIntegrationJob,
  enqueueIntegrationJob,
  getActiveIntegrationLock,
  listIntegrationQueue,
  newIntegrationJobId,
  releaseIntegrationLock,
  tryAcquireIntegrationLock,
} from "./integrationLock.js";
import {
  resolveAnthropicApiKey,
  setUserAnthropicByokKey,
} from "./userAnthropicByok.js";
import {
  CLAUDE_MODELS,
  DEFAULT_CLAUDE_MODEL,
} from "../shared/claudeModels.js";
import { DiffWatcher } from "./diffWatcher.js";
import { extractToolPath, getFileDiff, isEditTool, revertFiles, getUncommittedFiles } from "./gitDiff.js";
import { isTodoTool } from "../shared/backends/cursor.js";import type { NormalizedAgentEvent } from "../shared/backends/index.js";
import { listCliModels } from "./cliModels.js";
import { WorkerRelay } from "./workerRelay.js";
import * as db from "./db.js";
import {
  approvalActionKey,
  parseApprovalMode,
  requiresApproval,
  type ApprovalMode,
  type ApprovalRequestInfo,
} from "../shared/approvals.js";
import { attributionPromptSuffix, type SteerAuthor } from "../shared/attribution.js";
import { looksLikePlan, planImplementPrompt } from "../shared/plans.js";
import { extractAutoMemories } from "./repoContext/extract.js";
import {
  buildAgentBriefing,
  buildHandoffDraft,
  buildRoomContextSnapshot,
  createSanitizedMemory,
  toMemoryInfo,
  toReceiptInfo,
} from "./repoContext/briefing.js";
import { ensureRoomRepoMap, toRepoMapInfo } from "./repoContext/store.js";
import { prependPackedContext } from "./repoContext/pack.js";
import type {
  HandoffDraft,
  MemoryEntryInfo,
  MemoryKind,
  MemoryStatus,
  RepoMapInfo,
  RoomContextSnapshot,
} from "../shared/roomContext.js";
import {
  MEMORY_CONTENT_MAX,
  MEMORY_TITLE_MAX,
  parseAutoMemoryMode,
  sanitizeMemoryText,
} from "../shared/roomContext.js";
import { attachmentWorkspaceRelPath } from "../shared/uploads.js";
import type { WorkerPromptAttachment } from "../shared/uploads.js";
import {
  buildAttachmentPromptSuffix,
  materializeUploadsForAgent,
  resolveUploads,
  toAttachment,
  toPromptImages,
  toWorkerAttachments,
  type PromptImage,
} from "./uploads.js";
import {
  APP_ORIGIN,
  DEFAULT_AGENT_COMMAND,
  DEFAULT_MODEL,
  DEFAULT_REPO_PATH,
} from "./config.js";
import {
  decryptApiKey,
  encryptApiKey,
  encryptionConfigured,
  maskApiKey,
} from "./keyCrypto.js";
import { getServerApiKey } from "./serverKey.js";
import { getUserByokKey, setUserByokKey } from "./userByok.js";
import { getOrgCursorKey } from "./orgKeys.js";
import {
  canAbortWithRole,
  canEditMemory,
  canRequestDrive,
  canSteerWithRole,
  defaultControlModeForRuntime,
  normalizeRoomRole,
  parseControlMode,
  parseRoomInviteRole,
  steerDeniedReason,
  type ControlMode,
  type RoomInviteRole,
  type RoomRole,
} from "../shared/roomPermissions.js";
import { detectAgentConflicts, resolveAgentCwd, findScopeOverlap, formatScopeOverlapError } from "./agentConflicts.js";
import { FileLockRegistry, broadcastFileLocks } from "./fileLocks.js";
import {
  envSlackWebhookConfigured,
  notifyEvent,
  notifyReviewFlag,
  sendSlackTestMessage,
} from "./notify.js";
import { userCanManageRoom as userCanManageRoomAccess } from "./roomAccess.js";
import type {
  AgentInfo,
  AgentConflict,
  AgentConflictBlocked,
  AgentBackendKind,
  AgentStatus,
  AgentRuntime,
  AuthMode,
  AgentStreamEventPayload,
  ChatMessage,
  CloudMeta,
  ModelInfo,
  Participant,
  PingInfo,
  RoomMemberInfo,
  RoomInfo,
  ServerToClientEvents,
  ClientToServerEvents,
} from "../shared/events.js";
import {
  AVATAR_COLORS,
  isIntegratorAgent,
  type IntegrationJobInfo,
} from "../shared/events.js";

const MAX_NAME_LENGTH = 30;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ParticipantInfo {
  name: string;
  color: string;
  userId: string;
}

export interface CreateRoomRequest {
  name: string;
  runtime: AgentRuntime;
  authMode: AuthMode;
  modelId?: string;
  repoPath?: string;
  repoUrl?: string;
  startingRef?: string;
  autoCreatePR?: boolean;
  apiKey?: string;
  ownerId?: string;
  /** Organization that owns this session (null = personal). */
  orgId?: string;
  /** Primary agent backend. Defaults to cursor. */
  backend?: AgentBackendKind;
  /** Anthropic API key when backend is claude-code (cloud). Saved as user BYOK. */
  anthropicApiKey?: string;
  /** Collaboration control mode. Defaults by runtime (local → driver, cloud → open). */
  controlMode?: ControlMode;
  /** Start the default agent in read-only plan mode. */
  planMode?: boolean;
  /** Human approval gate for high-blast-radius tools. Defaults to "off". */
  approvalMode?: string;
}

type AgentBackend = AgentRunner | SdkAgentSession | ClaudeSandboxSession;

type AgentPrompt = string | { text: string; images: PromptImage[] };

function promptText(prompt: AgentPrompt): string {
  return typeof prompt === "string" ? prompt : prompt.text;
}

interface AgentState {
  row: db.AgentRow;
  backend: AgentBackend;
  cwd: string;
  diffWatcher: DiffWatcher | null;
  ownsDiffWatcher: boolean;
  toolMsgIds: Map<string, string>;
  toolPaths: Map<string, string>;
  /** Most recent tool chat message for this agent — fallback when callId is missing. */
  lastToolMsgId: string | null;
  /**
   * Single live todos card for this agent. Successive TodoWrite / todo tool
   * calls update this message in place instead of stacking 2→3→4 cards.
   */
  todoMsgId: string | null;
  workerRunActive: boolean;
  workerRunCleanups: (() => void)[];
  driverSocketId: string | null;
  pendingDriveRequest: { socketId: string; name: string } | null;
  filePatches: Map<string, string>;
  touchedPaths: Set<string>;
  /**
   * Incremented at the start of each run and on abort.
   * In-flight runAgent / worker handlers ignore events when this no longer matches.
   */
  runGeneration: number;
  /**
   * Approval gate action keys the room has already signed off on — lets the
   * exact same tool call resume without re-prompting on the next turn.
   */
  preApprovedActions: Set<string>;
  /** Human who most recently steered this agent (for git attribution). */
  lastSteeredBy: SteerAuthor | null;
  /**
   * When false, the agent's first run skips the repo-map + memory briefing.
   * Flipped to true after that first run (or when the Add Agent checkbox is on).
   */
  seedContext: boolean;
  /** Wall clock when the current run started — bounds auto-memory extraction. */
  runStartedAt: number | null;
}

interface RoomState {
  id: string;
  row: db.RoomRow;
  participants: Map<string, ParticipantInfo>;
  colorIndex: number;
  cleanups: (() => void)[];
  cloudMeta: CloudMeta;
  agents: Map<string, AgentState>;
  /** Legacy room-level driver — prefer per-agent drivers. Kept as fallback for single-agent rooms. */
  driverSocketId: string | null;
  pendingDriveRequest: { socketId: string; name: string } | null;
  /** socketId → agent ids they are currently typing toward. */
  typingBySocket: Map<string, Set<string>>;
  /** Auto-expire typing if the client goes quiet (`socketId:agentId` → timer). */
  typingTimeouts: Map<string, ReturnType<typeof setTimeout>>;
}

// ---------------------------------------------------------------------------
// Diff watcher pool — agents sharing a cwd share one watcher
// ---------------------------------------------------------------------------

const diffWatcherPool = new Map<
  string,
  { watcher: DiffWatcher; refs: number; unsubs: Map<string, () => void> }
>();

function acquireDiffWatcher(
  absCwd: string,
  roomId: string,
  agentId: string,
  onDiff: (patch: string) => void,
): { watcher: DiffWatcher; unsub: () => void; isOwner: boolean } {
  let entry = diffWatcherPool.get(absCwd);
  let isOwner = false;
  if (!entry) {
    const watcher = new DiffWatcher(absCwd);
    watcher
      .start()
      .catch((err) =>
        console.error(`DiffWatcher error for ${absCwd}:`, err),
      );
    entry = { watcher, refs: 0, unsubs: new Map() };
    diffWatcherPool.set(absCwd, entry);
    isOwner = true;
  }
  entry.refs++;
  const key = `${roomId}:${agentId}`;
  const unsub = entry.watcher.onDiff(onDiff);
  entry.unsubs.set(key, unsub);
  return {
    watcher: entry.watcher,
    unsub: () => releaseDiffWatcher(absCwd, key),
    isOwner,
  };
}

function releaseDiffWatcher(absCwd: string, key: string): void {
  const entry = diffWatcherPool.get(absCwd);
  if (!entry) return;
  const unsub = entry.unsubs.get(key);
  if (unsub) {
    unsub();
    entry.unsubs.delete(key);
  }
  entry.refs--;
  if (entry.refs <= 0) {
    void entry.watcher.stop();
    diffWatcherPool.delete(absCwd);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizeAuthMode(
  runtime: AgentRuntime,
  raw: AuthMode | string | undefined,
): AuthMode {
  if (runtime === "local" && (raw === "cli" || !raw)) return "cli";
  if (raw === "byok") return "byok";
  if (raw === "cli") {
    if (runtime === "cloud") {
      throw new Error("CLI login auth is only available for local runtime");
    }
    return "cli";
  }
  return "server";
}

/**
 * Resolve a Cursor API key for SDK agents / model listing.
 * Order: room BYOK → org shared key → server CURSOR_API_KEY → user BYOK.
 */
function resolveApiKey(row: db.RoomRow, userId?: string): string {
  if (row.auth_mode === "cli") {
    throw new Error("CLI auth does not use an API key");
  }
  if (row.key_ciphertext) {
    try {
      const key = decryptApiKey(row.key_ciphertext);
      if (key) return key;
    } catch (err) {
      console.error(
        `Failed to decrypt room BYOK key for ${row.id}:`,
        err,
      );
      if (row.auth_mode === "byok") {
        throw new Error("BYOK room has an invalid encrypted API key");
      }
    }
  }
  if (row.auth_mode === "byok") {
    throw new Error("BYOK room is missing encrypted API key");
  }
  if (row.org_id) {
    const orgKey = getOrgCursorKey(row.org_id);
    if (orgKey) return orgKey;
  }
  const serverKey = getServerApiKey();
  if (serverKey) return serverKey;

  const uid = userId || row.owner_id || undefined;
  if (uid) {
    const userKey = getUserByokKey(uid);
    if (userKey) return userKey;
  }

  throw new Error(
    row.org_id
      ? "No Cursor API key configured — set an org shared key in Team settings, or paste a BYOK key"
      : "No Cursor API key configured — paste a Cursor API key (saved from previous sessions) or set CURSOR_API_KEY on the server",
  );
}

/** Persist a Cursor BYOK key onto the room so later agents / model lists can reuse it. */
function attachRoomCursorByok(row: db.RoomRow, apiKey: string): void {
  if (!encryptionConfigured()) {
    throw new Error(
      "KEY_ENCRYPTION_SECRET is required to store a Cursor API key",
    );
  }
  const ciphertext = encryptApiKey(apiKey);
  const hint = maskApiKey(apiKey);
  db.setRoomByokKey(row.id, ciphertext, hint);
  row.key_ciphertext = ciphertext;
  row.key_hint = hint;
}

// ---------------------------------------------------------------------------
// RoomManager
// ---------------------------------------------------------------------------

export class RoomManager {
  private rooms = new Map<string, RoomState>();
  private socketRooms = new Map<string, string>();
  readonly fileLocks: FileLockRegistry;

  constructor(
    private io: Server<ClientToServerEvents, ServerToClientEvents>,
    private workerRelay?: WorkerRelay,
    fileLocks?: FileLockRegistry,
  ) {
    this.fileLocks =
      fileLocks ??
      new FileLockRegistry((roomId) => {
        const room = this.rooms.get(roomId);
        if (room) this.broadcastFileLocks(room);
      });
    this.fileLocks.setOnChange((roomId) => {
      const room = this.rooms.get(roomId);
      if (room) this.broadcastFileLocks(room);
    });

    this.restoreRooms();

    this.workerRelay?.onRunsDisconnected((runs) => {
      for (const { roomId, agentId } of runs) {
        this.handleWorkerSoftDisconnect(roomId, agentId);
      }
    });

    this.workerRelay?.onRunsLost((runs) => {
      for (const { roomId, agentId } of runs) {
        this.handleWorkerLost(roomId, agentId);
      }
    });

    this.workerRelay?.setDefaultAgentResolver((roomId) => {
      const agents = db.listAgents(roomId);
      return (
        agents.find((a) => !isIntegratorAgent(a))?.id ?? agents[0]?.id ?? null
      );
    });
  }

  // -----------------------------------------------------------------------
  // Restore
  // -----------------------------------------------------------------------

  private restoreRooms(): void {
    for (const row of db.listRooms()) {
      if (row.status !== "active") continue;
      try {
        this.initRoomState(row);
        console.log(`Restored room "${row.name}" (${row.id})`);
      } catch (err) {
        console.error(`Failed to restore room ${row.id}:`, err);
        db.updateRoomStatus(row.id, "stopped");
      }
    }
    for (const room of this.rooms.values()) {
      this.recoverIntegrationLock(room);
    }
  }

  // -----------------------------------------------------------------------
  // createRoom
  // -----------------------------------------------------------------------

  async createRoom(req: CreateRoomRequest): Promise<RoomInfo> {
    const name = req.name.trim();
    if (!name) throw new Error("name is required");

    const runtime: AgentRuntime = req.runtime === "cloud" ? "cloud" : "local";
    const backendKind: AgentBackendKind =
      req.backend === "claude-code" ? "claude-code" : "cursor";
    const ownerId = req.ownerId?.trim() || null;

    // Claude Code local always uses the Steer CLI worker (user's machine).
    let authMode = normalizeAuthMode(runtime, req.authMode);
    if (backendKind === "claude-code" && runtime === "local") {
      authMode = "cli";
    }

    const defaultModel =
      backendKind === "claude-code"
        ? DEFAULT_CLAUDE_MODEL
        : authMode === "cli"
          ? "auto"
          : DEFAULT_MODEL;
    const modelId = (req.modelId || defaultModel).trim() || defaultModel;

    let keyCiphertext: string | null = null;
    let keyHint: string | null = null;
    let apiKey = "";
    let anthropicApiKey = "";

    if (backendKind === "claude-code") {
      if (runtime === "cloud") {
        if (!isClaudeSandboxConfigured()) {
          throw new Error(
            "Claude Code cloud sessions require E2B_API_KEY on the server",
          );
        }
        // Cloud Claude does not need a Cursor API key. Persist Anthropic BYOK.
        authMode = "server";
        const pasted = req.anthropicApiKey?.trim() || "";
        if (pasted) {
          if (!encryptionConfigured()) {
            throw new Error(
              "KEY_ENCRYPTION_SECRET is required to store an Anthropic API key",
            );
          }
          if (!ownerId) {
            throw new Error("Sign in required to save an Anthropic API key");
          }
          setUserAnthropicByokKey(ownerId, pasted);
          anthropicApiKey = pasted;
        } else {
          anthropicApiKey = resolveAnthropicApiKey(
            ownerId,
            null,
            req.orgId?.trim() || null,
          );
        }
        if (!anthropicApiKey) {
          throw new Error(
            req.orgId?.trim()
              ? "Set a shared Anthropic key in Team settings, paste your key, or set ANTHROPIC_API_KEY on the server"
              : "Paste your Anthropic API key for Claude Code (or set ANTHROPIC_API_KEY on the server)",
          );
        }
      } else if (!ownerId) {
        throw new Error("Sign in required to create a local Claude Code session");
      }
    } else if (authMode === "byok") {
      const pasted = req.apiKey?.trim() || "";
      const raw = pasted || (ownerId ? getUserByokKey(ownerId) : "");
      if (!raw) {
        throw new Error(
          "apiKey is required for BYOK — paste a Cursor API key (it will be saved for next time)",
        );
      }
      if (!encryptionConfigured()) {
        throw new Error("KEY_ENCRYPTION_SECRET is not configured on the server");
      }
      keyCiphertext = encryptApiKey(raw);
      keyHint = maskApiKey(raw);
      apiKey = raw;
      if (ownerId && pasted) {
        setUserByokKey(ownerId, pasted);
      }
    } else if (authMode === "server") {
      const orgId = req.orgId?.trim() || "";
      apiKey =
        (orgId ? getOrgCursorKey(orgId) : "") || getServerApiKey();
      if (!apiKey) {
        throw new Error(
          orgId
            ? "Org shared Cursor key is not configured — set it in Team settings"
            : "Server key is not configured — set CURSOR_API_KEY or pick one up in Create session",
        );
      }
    }

    let repoPath = DEFAULT_REPO_PATH;
    let repoUrl: string | null = null;
    let startingRef: string | null = null;
    const autoCreatePR = Boolean(req.autoCreatePR);

    if (runtime === "local") {
      const raw = req.repoPath?.trim() || DEFAULT_REPO_PATH;
      repoPath = raw.startsWith("/") || /^[A-Za-z]:[\\/]/.test(raw)
        ? raw
        : resolve(raw);
      if (authMode !== "cli" && !existsSync(repoPath)) {
        throw new Error(`Repo path does not exist: ${repoPath}`);
      }
      if (authMode === "cli" && !repoPath) {
        throw new Error("Select a repository folder");
      }
    } else {
      repoUrl = req.repoUrl?.trim() || "";
      if (!repoUrl) throw new Error("repoUrl is required for cloud runtime");
      if (!/^https:\/\/github\.com\//i.test(repoUrl)) {
        throw new Error("Cloud repoUrl must be an https://github.com/... URL");
      }
      startingRef = req.startingRef?.trim() || "main";
      repoPath = "";
    }

    const id = nanoid(10);
    let cursorAgentId: string | null = null;
    let existingBackend: AgentBackend | null = null;

    if (backendKind === "claude-code") {
      // Backend is constructed in initRoomState / below after the agent row exists.
    } else if (authMode === "cli") {
      // Cursor CLI worker — backend created in initRoomState.
    } else {
      const sdk = new SdkAgentSession({
        runtime,
        apiKey,
        model: { id: modelId },
        name,
        localCwd: runtime === "local" ? repoPath : undefined,
        repoUrl: runtime === "cloud" ? repoUrl! : undefined,
        startingRef: startingRef || undefined,
        autoCreatePR,
        mode: req.planMode ? "plan" : "agent",
      });
      cursorAgentId = await sdk.ensureStarted();
      existingBackend = sdk;
    }

    if (authMode === "cli" && !ownerId) {
      throw new Error("Sign in required to create a local CLI session");
    }

    const orgId = req.orgId?.trim() || null;
    if (orgId && ownerId && !db.isOrganizationMember(orgId, ownerId)) {
      throw new Error("Not a member of that organization");
    }

    const controlMode = parseControlMode(
      req.controlMode,
      defaultControlModeForRuntime(runtime),
    );

    const row = db.createRoom({
      id,
      name,
      repoPath: repoPath || repoUrl || "",
      agentCommand: DEFAULT_AGENT_COMMAND,
      runtime,
      authMode,
      modelId,
      repoUrl,
      startingRef,
      cursorAgentId,
      cursorSessionId: null,
      autoCreatePR,
      keyCiphertext,
      keyHint,
      ownerId,
      orgId,
      controlMode,
      approvalMode: parseApprovalMode(req.approvalMode),
    });

    if (ownerId) {
      try {
        db.addRoomMember(id, ownerId, "owner");
      } catch {
        // ignore duplicate membership
      }
    }

    const agentRow = db.createAgent({
      roomId: id,
      backend: backendKind,
      label: "Agent 1",
      sessionId: null,
      sdkAgentId: cursorAgentId,
      modelId,
      createdBy: ownerId,
      planMode: Boolean(req.planMode),
    });

    const existingByAgentId = new Map<string, AgentBackend>();
    if (existingBackend) {
      existingByAgentId.set(agentRow.id, existingBackend);
    } else if (backendKind === "claude-code" && runtime === "cloud") {
      existingByAgentId.set(
        agentRow.id,
        this.createClaudeSandboxBackend(row, agentRow, anthropicApiKey),
      );
    }

    this.initRoomState(row, existingByAgentId);
    console.log(
      `Created ${runtime}/${authMode}/${backendKind} room "${name}" (${id}) model=${modelId} control=${controlMode}`,
    );
    return this.toRoomInfo(row, 0, ownerId || undefined);
  }

  // -----------------------------------------------------------------------
  // initRoomState
  // -----------------------------------------------------------------------

  private initRoomState(
    row: db.RoomRow,
    existingByAgentId?: Map<string, AgentBackend>,
  ): void {
    let agentRows = db.listAgents(row.id);

    // Safety: if no agents exist (legacy / corrupted), create one default
    if (agentRows.length === 0) {
      const created = db.createAgent({
        roomId: row.id,
        backend: "cursor",
        label: "Agent 1",
        sessionId: row.cursor_session_id,
        sdkAgentId: row.cursor_agent_id,
        modelId: row.model_id || "auto",
        createdBy: row.owner_id,
        sortOrder: 0,
      });
      agentRows = [created];
    }

    const agents = new Map<string, AgentState>();
    const cleanups: (() => void)[] = [];

    for (const agentRow of agentRows) {
      let backend: AgentBackend;
      const existing = existingByAgentId?.get(agentRow.id);

      if (existing) {
        backend = existing;
      } else if (
        agentRow.backend === "claude-code" &&
        row.runtime === "cloud"
      ) {
        backend = this.createClaudeSandboxBackend(row, agentRow);
      } else if (row.auth_mode === "cli" || agentRow.backend === "claude-code") {
        const cwd = resolveAgentCwd(row.repo_path, agentRow.scope_path);
        backend = new AgentRunner(
          cwd,
          agentRow.session_id,
          agentRow.model_id || "auto",
          agentRow.backend === "claude-code" ? "claude-code" : "cursor",
        );
      } else {
        const apiKey = resolveApiKey(row, row.owner_id || undefined);
        const cwd = row.runtime === "local"
          ? resolveAgentCwd(row.repo_path, agentRow.scope_path)
          : "";
        backend = new SdkAgentSession({
          runtime: row.runtime === "cloud" ? "cloud" : "local",
          apiKey,
          model: { id: agentRow.model_id || DEFAULT_MODEL },
          name: row.name,
          agentId: agentRow.sdk_agent_id,
          localCwd: row.runtime === "local" ? cwd : undefined,
          repoUrl: row.repo_url || undefined,
          startingRef: row.starting_ref || undefined,
          autoCreatePR:
            Boolean(row.auto_create_pr) || isIntegratorAgent(agentRow),
        });
      }

      const cwd = row.runtime === "local"
        ? resolveAgentCwd(row.repo_path, agentRow.scope_path)
        : "";

      let diffWatcher: DiffWatcher | null = null;
      let ownsDiffWatcher = false;

      const canWatchLocally =
        row.runtime === "local" &&
        row.auth_mode !== "cli" &&
        Boolean(cwd) &&
        existsSync(cwd);

      if (canWatchLocally) {
        const poolResult = acquireDiffWatcher(
          cwd,
          row.id,
          agentRow.id,
          (patch) => {
            this.io.to(row.id).emit("diff-update", patch, agentRow.id);
          },
        );
        diffWatcher = poolResult.watcher;
        ownsDiffWatcher = poolResult.isOwner;
        cleanups.push(poolResult.unsub);
      }

      agents.set(agentRow.id, {
        row: agentRow,
        backend,
        cwd,
        diffWatcher,
        ownsDiffWatcher,
        toolMsgIds: new Map(),
        toolPaths: new Map(),
        lastToolMsgId: null,
        todoMsgId: null,
        workerRunActive: false,
        workerRunCleanups: [],
        driverSocketId: null,
        pendingDriveRequest: null,
        filePatches: new Map(),
        touchedPaths: new Set(),
        runGeneration: 0,
        preApprovedActions: new Set(),
        lastSteeredBy: null,
        seedContext: true,
        runStartedAt: null,
      });

      this.applyBackendMode(agents.get(agentRow.id)!);
    }

    this.rooms.set(row.id, {
      id: row.id,
      row,
      participants: new Map(),
      colorIndex: 0,
      cleanups,
      cloudMeta: {
        repoUrl: row.repo_url || undefined,
        startingRef: row.starting_ref || undefined,
        prUrl: row.pr_url || undefined,
        autoCreatePR: Boolean(row.auto_create_pr),
      },
      agents,
      driverSocketId: null,
      pendingDriveRequest: null,
      typingBySocket: new Map(),
      typingTimeouts: new Map(),
    });
  }

  // -----------------------------------------------------------------------
  // Agent helpers
  // -----------------------------------------------------------------------

  private getDefaultAgent(room: RoomState): AgentState {
    // First by sort_order (agentRows come sorted from DB). Skip the Integrator.
    let first: AgentState | undefined;
    let fallback: AgentState | undefined;
    for (const a of room.agents.values()) {
      if (!fallback || a.row.sort_order < fallback.row.sort_order) {
        fallback = a;
      }
      if (isIntegratorAgent(a.row)) continue;
      if (!first || a.row.sort_order < first.row.sort_order) {
        first = a;
      }
    }
    const pick = first || fallback;
    if (!pick) throw new Error("Room has no agents");
    return pick;
  }

  private getAgentState(
    room: RoomState,
    agentId: string,
  ): AgentState | undefined {
    return room.agents.get(agentId);
  }

  toAgentInfo(row: db.AgentRow): AgentInfo {
    return {
      id: row.id,
      roomId: row.room_id,
      backend: row.backend,
      label: row.label,
      scopePath: row.scope_path || undefined,
      sessionId: row.session_id || undefined,
      modelId: row.model_id,
      status: row.status,
      createdBy: row.created_by || undefined,
      createdAt: row.created_at,
      sortOrder: row.sort_order,
      sdkAgentId: row.sdk_agent_id || undefined,
      branch: row.branch || undefined,
      prUrl: row.pr_url || undefined,
      planMode: Boolean(row.plan_mode),
      kind: row.kind === "integrator" ? "integrator" : "feature",
    };
  }

  /** Push the agent's persisted plan/agent mode onto its live backend. */
  private applyBackendMode(agent: AgentState): void {
    const mode: "agent" | "plan" = agent.row.plan_mode ? "plan" : "agent";
    const backend = agent.backend as { setMode?: (mode: "agent" | "plan") => void };
    backend.setMode?.(mode);
  }

  private approvalRowToInfo(row: db.ApprovalRequestRow): ApprovalRequestInfo {
    return {
      id: row.id,
      roomId: row.room_id,
      agentId: row.agent_id,
      callId: row.call_id,
      toolName: row.tool_name,
      detail: row.detail,
      path: row.path || undefined,
      status: row.status,
      createdAt: row.created_at,
      decidedAt: row.decided_at || undefined,
      decidedByUserId: row.decided_by_user_id || undefined,
      decidedByName: row.decided_by_name || undefined,
    };
  }

  private parsePingTargets(raw: string): PingInfo["targets"] {
    if (!raw || raw === "everyone") return "everyone";
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.filter((x): x is string => typeof x === "string");
      }
    } catch {
      // ignore
    }
    return "everyone";
  }

  private pingRowToInfo(row: db.RoomPingRow): PingInfo {
    const acks = db.listRoomPingAcks(row.id).map((a) => ({
      userId: a.user_id,
      name: a.user_name,
      ts: a.acked_at,
    }));
    return {
      id: row.id,
      roomId: row.room_id,
      actorUserId: row.actor_user_id,
      actorName: row.actor_name,
      note: row.note || undefined,
      targets: this.parsePingTargets(row.targets),
      status: row.status,
      createdAt: row.created_at,
      acks,
    };
  }

  private decryptRoomSlackWebhook(row: db.RoomRow): string | undefined {
    const cipher = row.slack_webhook_ciphertext?.trim();
    if (!cipher || !encryptionConfigured()) return undefined;
    try {
      return decryptApiKey(cipher);
    } catch (err) {
      console.warn(
        "[slack-webhook] decrypt failed",
        err instanceof Error ? err.message : err,
      );
      return undefined;
    }
  }

  /** Cloud Claude Code via E2B sandbox (E2B_API_KEY server-side; Anthropic key BYOK). */
  private createClaudeSandboxBackend(
    row: db.RoomRow,
    agentRow: db.AgentRow,
    anthropicApiKey?: string,
  ): ClaudeSandboxSession {
    const apiKey =
      anthropicApiKey?.trim() ||
      resolveAnthropicApiKey(row.owner_id, null, row.org_id) ||
      "";
    const agentId = agentRow.id;
    const roomId = row.id;
    return new ClaudeSandboxSession({
      apiKey,
      model: agentRow.model_id || DEFAULT_CLAUDE_MODEL,
      name: `${row.name}/${agentRow.label}`,
      repoUrl: row.repo_url?.trim() || "",
      startingRef: row.starting_ref || "main",
      autoCreatePR:
        Boolean(row.auto_create_pr) || isIntegratorAgent(agentRow),
      sessionId: agentRow.session_id,
      sandboxId: agentRow.sdk_agent_id,
      branch: agentRow.branch,
      prUrl: agentRow.pr_url,
      mode: agentRow.plan_mode ? "plan" : "agent",
      githubToken: githubTokenFromEnv(),
      onReady: ({ sandboxId, branch }) => {
        // Persist sandbox identity as soon as the E2B box is up (not only on done).
        if (sandboxId) {
          db.setAgentSdkId(agentId, sandboxId);
          const def = db.listAgents(roomId)[0];
          if (def?.id === agentId) {
            db.setCursorAgentId(roomId, sandboxId);
          }
        }
        if (branch) {
          const existing = db.getAgent(agentId);
          db.setAgentPr(agentId, existing?.pr_url ?? null, branch);
        }
        const room = this.rooms.get(roomId);
        const agent = room?.agents.get(agentId);
        if (room && agent) {
          if (sandboxId) {
            agent.row.sdk_agent_id = sandboxId;
            if (this.getDefaultAgent(room).row.id === agentId) {
              room.row.cursor_agent_id = sandboxId;
            }
          }
          if (branch) agent.row.branch = branch;
          this.broadcastAgents(room);
        }
      },
    });
  }

  listAgentInfos(roomId: string): AgentInfo[] {
    const room = this.rooms.get(roomId);
    if (room) {
      return [...room.agents.values()].map((a) => this.toAgentInfo(a.row));
    }
    return db.listAgents(roomId).map((r) => this.toAgentInfo(r));
  }

  private assertCanManage(roomId: string, actorUserId?: string): void {
    if (!actorUserId) return;
    if (!this.userCanManageRoom(roomId, actorUserId)) {
      throw new Error("Only the host or a team admin can manage this room");
    }
  }

  updateAgentMeta(
    roomId: string,
    agentId: string,
    opts: { label?: string; scopePath?: string | null },
    actorUserId?: string,
  ): AgentInfo {
    const row = db.getRoom(roomId);
    if (!row || row.status !== "active") throw new Error("Room not found");
    this.assertCanManage(roomId, actorUserId);
    const room = this.rooms.get(roomId);
    const agent = room?.agents.get(agentId);
    const agentRow = agent?.row || db.getAgent(agentId);
    if (!agentRow || agentRow.room_id !== roomId) {
      throw new Error("Agent not found");
    }
    if (opts.label !== undefined) {
      db.setAgentLabel(agentId, opts.label.trim() || agentRow.label);
      agentRow.label = opts.label.trim() || agentRow.label;
    }
    if (opts.scopePath !== undefined) {
      const scopeCheck = this.validateAgentScope(
        roomId,
        opts.scopePath,
        agentId,
      );
      if (!scopeCheck.ok) throw new Error(scopeCheck.error);
      if (row.runtime === "local" && opts.scopePath) {
        resolveAgentCwd(row.repo_path, opts.scopePath);
      }
      db.setAgentScope(agentId, opts.scopePath);
      agentRow.scope_path = opts.scopePath;
      if (agent && row.runtime === "local") {
        agent.cwd = resolveAgentCwd(row.repo_path, opts.scopePath);
      }
    }
    if (agent) agent.row = agentRow;
    if (room) {
      this.broadcastAgents(room);
      this.broadcastConflicts(room);
    }
    return this.toAgentInfo(agentRow);
  }

  setAgentPlanMode(
    roomId: string,
    agentId: string,
    planMode: boolean,
    actorUserId?: string,
  ): AgentInfo {
    const row = db.getRoom(roomId);
    if (!row || row.status !== "active") throw new Error("Room not found");
    this.assertCanManage(roomId, actorUserId);
    const room = this.rooms.get(roomId);
    const agent = room?.agents.get(agentId);
    const agentRow = agent?.row || db.getAgent(agentId);
    if (!agentRow || agentRow.room_id !== roomId) {
      throw new Error("Agent not found");
    }
    db.setAgentPlanMode(agentId, planMode);
    agentRow.plan_mode = planMode ? 1 : 0;
    if (agent) {
      agent.row = agentRow;
      this.applyBackendMode(agent);
    }
    if (room) this.broadcastAgents(room);
    return this.toAgentInfo(agentRow);
  }

  private broadcastAgents(room: RoomState): void {
    const infos: AgentInfo[] = [];
    for (const a of room.agents.values()) {
      infos.push(this.toAgentInfo(a.row));
    }
    this.io.to(room.id).emit("agents", infos);
  }

  getRoomContextSnapshot(roomId: string): RoomContextSnapshot {
    try {
      return buildRoomContextSnapshot(roomId);
    } catch (err) {
      console.warn(
        "[RoomManager] room context snapshot failed:",
        err instanceof Error ? err.message : err,
      );
      return {
        memoryVersion: 0,
        map: null,
        entries: [],
        lastReceiptByAgent: {},
      };
    }
  }

  broadcastRoomContext(roomId: string): void {
    this.io.to(roomId).emit("room-context", this.getRoomContextSnapshot(roomId));
  }

  private broadcastMemoryUpdated(roomId: string, entry: MemoryEntryInfo): void {
    this.io
      .to(roomId)
      .emit("memory-updated", entry, db.getRoomMemoryVersion(roomId));
  }

  userCanEditMemory(roomId: string, userId: string): boolean {
    return canEditMemory(this.resolveUserRoomRole(roomId, userId));
  }

  private assertCanEditMemory(roomId: string, userId: string): void {
    if (!this.userCanAccessRoom(roomId, userId)) {
      throw new Error("Room not found");
    }
    if (!this.userCanEditMemory(roomId, userId)) {
      throw new Error("Not allowed");
    }
  }

  listRoomMemory(roomId: string, actorUserId: string): MemoryEntryInfo[] {
    if (!this.userCanAccessRoom(roomId, actorUserId)) {
      throw new Error("Room not found");
    }
    return db
      .listMemoryEntries(roomId, { includeProposed: true })
      .map(toMemoryInfo);
  }

  createRoomMemory(
    roomId: string,
    actorUserId: string,
    input: {
      kind: unknown;
      title: unknown;
      content: unknown;
      pinned?: boolean;
      agentId?: string;
      sourceMessageId?: string | null;
      sourcePath?: string | null;
    },
  ): MemoryEntryInfo {
    this.assertCanEditMemory(roomId, actorUserId);
    const fromAgent = Boolean(input.agentId);
    if (fromAgent) {
      const agent = db.getAgent(String(input.agentId));
      if (!agent || agent.room_id !== roomId) {
        throw new Error("Agent not found");
      }
    }
    const entry = createSanitizedMemory({
      roomId,
      kind: input.kind,
      title: input.title,
      content: input.content,
      status: fromAgent ? "proposed" : "active",
      pinned: Boolean(input.pinned) && !fromAgent,
      createdByUserId: actorUserId,
      createdByAgentId: fromAgent ? String(input.agentId) : null,
      sourceMessageId: input.sourceMessageId,
      sourcePath: input.sourcePath,
      source: fromAgent ? "agent_proposed" : "human",
    });
    this.broadcastMemoryUpdated(roomId, entry);
    this.broadcastRoomContext(roomId);
    return entry;
  }

  updateRoomMemory(
    roomId: string,
    entryId: string,
    actorUserId: string,
    input: {
      expectedRevision: number;
      title?: unknown;
      content?: unknown;
      pinned?: boolean;
    },
  ): MemoryEntryInfo {
    this.assertCanEditMemory(roomId, actorUserId);
    const current = db.getMemoryEntry(entryId);
    if (!current || current.room_id !== roomId) {
      throw new Error("Memory entry not found");
    }
    const title =
      input.title === undefined
        ? undefined
        : sanitizeMemoryText(input.title, MEMORY_TITLE_MAX);
    const content =
      input.content === undefined
        ? undefined
        : sanitizeMemoryText(input.content, MEMORY_CONTENT_MAX);
    if (input.title !== undefined && !title) {
      throw new Error("Title is required");
    }
    if (input.content !== undefined && !content) {
      throw new Error("Content is required");
    }
    const updated = db.updateMemoryEntry({
      id: entryId,
      expectedRevision: input.expectedRevision,
      title,
      content,
      pinned: input.pinned,
      actorUserId,
    });
    if (!updated) throw new Error("Memory entry not found");
    const info = toMemoryInfo(updated);
    this.broadcastMemoryUpdated(roomId, info);
    this.broadcastRoomContext(roomId);
    return info;
  }

  acceptRoomMemory(
    roomId: string,
    entryId: string,
    actorUserId: string,
    expectedRevision?: number,
  ): MemoryEntryInfo {
    this.assertCanEditMemory(roomId, actorUserId);
    const current = db.getMemoryEntry(entryId);
    if (!current || current.room_id !== roomId) {
      throw new Error("Memory entry not found");
    }
    if (current.status !== "proposed") {
      throw new Error("Only proposed memories can be accepted");
    }
    const updated = db.updateMemoryEntry({
      id: entryId,
      expectedRevision: expectedRevision ?? current.current_revision,
      status: "active" as MemoryStatus,
      actorUserId,
    });
    if (!updated) throw new Error("Memory entry not found");
    const info = toMemoryInfo(updated);
    this.broadcastMemoryUpdated(roomId, info);
    this.broadcastRoomContext(roomId);
    return info;
  }

  archiveRoomMemory(
    roomId: string,
    entryId: string,
    actorUserId: string,
    expectedRevision?: number,
  ): MemoryEntryInfo {
    this.assertCanEditMemory(roomId, actorUserId);
    const current = db.getMemoryEntry(entryId);
    if (!current || current.room_id !== roomId) {
      throw new Error("Memory entry not found");
    }
    const updated = db.updateMemoryEntry({
      id: entryId,
      expectedRevision: expectedRevision ?? current.current_revision,
      status: "archived" as MemoryStatus,
      actorUserId,
    });
    if (!updated) throw new Error("Memory entry not found");
    const info = toMemoryInfo(updated);
    this.broadcastMemoryUpdated(roomId, info);
    this.broadcastRoomContext(roomId);
    return info;
  }

  refreshRepoMap(roomId: string, actorUserId: string): RepoMapInfo {
    this.assertCanEditMemory(roomId, actorUserId);
    const row = db.getRoom(roomId);
    if (!row) throw new Error("Room not found");
    const info = ensureRoomRepoMap(row, { force: true });
    this.io.to(roomId).emit("repo-map-updated", info);
    this.broadcastRoomContext(roomId);
    return info;
  }

  getRepoMapInfo(roomId: string, actorUserId: string): RepoMapInfo | null {
    if (!this.userCanAccessRoom(roomId, actorUserId)) {
      throw new Error("Room not found");
    }
    const row = db.getRepoMap(roomId);
    return row ? toRepoMapInfo(row) : null;
  }

  getHandoffDraft(
    roomId: string,
    agentId: string,
    actorUserId: string,
  ): HandoffDraft {
    if (!this.userCanAccessRoom(roomId, actorUserId)) {
      throw new Error("Room not found");
    }
    const room = this.rooms.get(roomId);
    const row = db.getRoom(roomId);
    const agentRow = db.getAgent(agentId);
    if (!row || !agentRow || agentRow.room_id !== roomId) {
      throw new Error("Agent not found");
    }
    const live = room?.agents.get(agentId);
    const lastAssistant = [...db.getMessages(roomId, 200)]
      .reverse()
      .find((m) => m.agentId === agentId && m.role === "assistant");
    const todos = lastAssistant?.todos
      ? lastAssistant.todos
          .filter((t) => t.status === "pending" || t.status === "in_progress")
          .map((t) => `- [${t.status}] ${t.content}`)
      : [];
    const extraNote = todos.length
      ? `\nRemaining todos:\n${todos.join("\n")}`
      : "";
    const draft = buildHandoffDraft(row, agentRow, {
      touchedPaths: live ? [...live.touchedPaths] : [],
      lastAssistant: lastAssistant
        ? `${lastAssistant.content}${extraNote}`
        : extraNote || null,
    });
    return draft;
  }

  captureHandoffDraft(
    roomId: string,
    agentId: string,
    actorUserId: string,
    opts?: { title?: string; content?: string; asProposal?: boolean },
  ): MemoryEntryInfo {
    this.assertCanEditMemory(roomId, actorUserId);
    const draft = this.getHandoffDraft(roomId, agentId, actorUserId);
    const entry = createSanitizedMemory({
      roomId,
      kind: "handoff" as MemoryKind,
      title: opts?.title || draft.title,
      content: opts?.content || draft.content,
      status: opts?.asProposal ? "proposed" : "active",
      createdByUserId: actorUserId,
      createdByAgentId: agentId,
      sourcePath: draft.sourcePath ?? null,
      source: "human",
    });
    this.broadcastMemoryUpdated(roomId, entry);
    this.broadcastRoomContext(roomId);
    return entry;
  }

  private broadcastConflicts(room: RoomState): void {
    const agentData = [...room.agents.values()].map((a) => ({
      id: a.row.id,
      status: a.row.status,
      scopePath: a.row.scope_path,
      touchedPaths: a.touchedPaths,
    }));
    const conflicts = detectAgentConflicts(agentData);
    this.io.to(room.id).emit("agent-conflicts", conflicts);
  }

  private broadcastFileLocks(room: RoomState): void {
    broadcastFileLocks(this.io, room.id, this.fileLocks);
  }

  private agentScopeCandidates(roomId: string): Array<{
    id: string;
    label: string;
    status: string;
    scopePath?: string | null;
  }> {
    const room = this.rooms.get(roomId);
    if (room) {
      return [...room.agents.values()].map((a) => ({
        id: a.row.id,
        label: a.row.label,
        status: a.row.status,
        scopePath: a.row.scope_path,
      }));
    }
    return db.listAgents(roomId).map((a) => ({
      id: a.id,
      label: a.label,
      status: a.status,
      scopePath: a.scope_path,
    }));
  }

  validateAgentScope(
    roomId: string,
    proposedScope: string | null | undefined,
    excludeAgentId?: string,
  ): { ok: true } | { ok: false; error: string } {
    const overlap = findScopeOverlap(
      this.agentScopeCandidates(roomId),
      proposedScope,
      excludeAgentId,
    );
    if (!overlap) return { ok: true };
    return { ok: false, error: formatScopeOverlapError(overlap) };
  }

  private agentLabel(room: RoomState, agentId: string): string {
    const agent = room.agents.get(agentId);
    if (agent) return agent.row.label;
    const row = db.getAgent(agentId);
    return row?.label || agentId.slice(0, 6);
  }

  private emitConflictBlocked(
    room: RoomState,
    agentId: string,
    path: string,
    holderAgentId: string,
  ): void {
    const payload: AgentConflictBlocked = {
      agentId,
      path,
      holderAgentId,
      action: "aborted",
    };
    this.io.to(room.id).emit("agent-conflict-blocked", payload);
  }

  private tryAcquireEditLock(
    room: RoomState,
    agent: AgentState,
    toolName: string | undefined,
    path: string | undefined,
    callId?: string,
  ): boolean {
    if (!path || !toolName || !isEditTool(toolName)) return true;
    const result = this.fileLocks.tryAcquire(
      room.id,
      agent.row.id,
      path,
      callId,
    );
    if (result.ok) return true;
    this.emitConflictBlocked(room, agent.row.id, path, result.holderAgentId);
    return false;
  }

  private releaseEditLock(
    room: RoomState,
    agent: AgentState,
    toolName: string | undefined,
    path: string | undefined,
  ): void {
    if (!path || !toolName || !isEditTool(toolName)) return;
    this.fileLocks.release(room.id, agent.row.id, path);
  }

  /** True when this tool event should land on the agent's single todos card. */
  private isTodoToolEvent(
    toolName: string | undefined,
    todos?: ChatMessage["todos"],
  ): boolean {
    return Boolean(todos?.length) || Boolean(toolName && isTodoTool(toolName));
  }

  /**
   * Insert or update a tool chat row. Todo tools always reuse `agent.todoMsgId`
   * so successive TodoWrite calls (2 → 3 → 4 items) update one card.
   */
  private upsertAgentToolMessage(
    room: RoomState,
    agent: AgentState,
    opts: {
      callId?: string;
      name: string;
      content: string;
      path?: string;
      todos?: ChatMessage["todos"];
      questions?: ChatMessage["questions"];
      status: "streaming" | "done" | "error";
      diffPatch?: string;
      /** When true, allow falling back to lastToolMsgId for non-todo tools. */
      allowLastToolFallback?: boolean;
    },
  ): string | null {
    const isTodo = this.isTodoToolEvent(opts.name, opts.todos);
    const existingId =
      (opts.callId ? agent.toolMsgIds.get(opts.callId) : undefined) ||
      (isTodo ? agent.todoMsgId || undefined : undefined) ||
      (opts.allowLastToolFallback && !isTodo
        ? agent.lastToolMsgId || undefined
        : undefined);

    // Create a row even for orphan tool_done (completed without a prior start)
    // so results/diffs are never silently dropped.
    const id = existingId || nanoid(12);
    const msg: ChatMessage = {
      id,
      roomId: room.id,
      role: "tool",
      content: opts.content,
      toolName: opts.name || "tool",
      status: opts.status,
      ts: Date.now(),
      agentId: agent.row.id,
    };
    if (opts.todos?.length) msg.todos = opts.todos;
    if (opts.questions?.length) msg.questions = opts.questions;
    if (opts.diffPatch) msg.diffPatch = opts.diffPatch;

    if (existingId) {
      // Always persist content + status on completion; attach diff/todos/questions when present.
      if (
        opts.diffPatch ||
        opts.todos?.length ||
        opts.questions?.length ||
        opts.status === "done" ||
        opts.status === "error"
      ) {
        db.updateMessageTool(id, opts.content, opts.status, {
          diffPatch: opts.diffPatch,
          todos: opts.todos,
          questions: opts.questions,
        });
      } else {
        db.updateMessageContent(id, opts.content, opts.status);
      }
    } else {
      db.insertMessage(msg);
    }

    if (opts.callId) {
      agent.toolMsgIds.set(opts.callId, id);
      if (opts.path) agent.toolPaths.set(opts.callId, opts.path);
    }
    agent.lastToolMsgId = id;
    if (isTodo) agent.todoMsgId = id;

    this.io.to(room.id).emit("chat-message", msg);
    return id;
  }

  forceReleaseFileLock(
    roomId: string,
    rawPath: string,
    actorUserId: string,
  ): boolean {
    const row = db.getRoom(roomId);
    if (!row || row.status !== "active") {
      throw new Error("Room not found");
    }
    this.assertCanManage(roomId, actorUserId);
    const released = this.fileLocks.forceRelease(roomId, rawPath);
    broadcastFileLocks(this.io, roomId, this.fileLocks);
    return released;
  }

  private lockConflictMessage(
    room: RoomState,
    path: string,
    holderAgentId: string,
  ): string {
    const holder = this.agentLabel(room, holderAgentId);
    return `\`${path}\` is locked by ${holder}. Wait for the other agent to finish or ask the host to release the lock.`;
  }

  private emitAgentStatus(
    room: RoomState,
    agentId: string,
    status: string,
    detail?: string,
  ): void {
    // Multi-agent: emit (agentId, status, detail)
    if (detail) {
      this.io.to(room.id).emit("agent-status", agentId, status, detail);
    } else {
      this.io.to(room.id).emit("agent-status", agentId, status);
    }
    // Single-agent compat: also emit legacy (status, detail)
    if (room.agents.size <= 1) {
      if (detail) {
        this.io.to(room.id).emit("agent-status", status, detail);
      } else {
        this.io.to(room.id).emit("agent-status", status);
      }
    }
  }

  private persistAgentSession(
    room: RoomState,
    agent: AgentState,
    sessionId: string | null,
  ): void {
    const next = sessionId?.trim() || null;
    if (next === agent.row.session_id) return;
    db.setAgentSessionId(agent.row.id, next);
    agent.row.session_id = next;

    // Update room-level cursor_session_id if this is the default agent
    const defaultAgent = this.getDefaultAgent(room);
    if (agent.row.id === defaultAgent.row.id) {
      if (next) db.setCursorSessionId(room.id, next);
      else db.setCursorSessionId(room.id, "");
      room.row.cursor_session_id = next;
    }

    this.io
      .to(room.id)
      .emit("cursor-session-updated", agent.row.id, next);
  }

  private noteTouchedPath(
    room: RoomState,
    agent: AgentState,
    path: string,
  ): void {
    agent.touchedPaths.add(path);
    this.broadcastConflicts(room);
  }

  private emitAgentDiff(room: RoomState, agent: AgentState): void {
    const parts: string[] = [];
    for (const patch of agent.filePatches.values()) {
      if (patch) parts.push(patch);
    }
    const combined = parts.join("\n");
    if (combined) {
      this.io.to(room.id).emit("diff-update", combined, agent.row.id);
    }
  }

  // -----------------------------------------------------------------------
  // Approval gates — pause high-blast-radius tools for human sign-off
  // -----------------------------------------------------------------------

  /**
   * Checks whether a tool call needs human approval under the room's
   * approval mode. When it does — and the exact action hasn't already been
   * pre-approved — aborts the in-flight run, records a pending approval
   * request, and notifies the room. Returns true when the caller should
   * stop processing this tool event (approval already handled).
   */
  private gateDangerousTool(
    room: RoomState,
    agent: AgentState,
    event: { callId: string; name: string; detail: string; path?: string },
    abort: () => void,
  ): boolean {
    const mode = parseApprovalMode(room.row.approval_mode);
    if (
      !requiresApproval({
        mode,
        toolName: event.name,
        detail: event.detail,
        path: event.path,
        isEditTool,
      })
    ) {
      return false;
    }

    const key = approvalActionKey(event.name, event.detail, event.path);
    if (agent.preApprovedActions.has(key)) {
      agent.preApprovedActions.delete(key);
      return false;
    }

    abort();

    const approvalRow = db.createApprovalRequest({
      roomId: room.id,
      agentId: agent.row.id,
      callId: event.callId,
      toolName: event.name,
      detail: event.detail,
      path: event.path || null,
    });
    const info = this.approvalRowToInfo(approvalRow);

    const pathSuffix = event.path ? ` on \`${event.path}\`` : "";
    const sysMsg: ChatMessage = {
      id: nanoid(12),
      roomId: room.id,
      role: "system",
      content: `${agent.row.label} wants to run **${event.name}**${pathSuffix}: ${event.detail || ""}\n\nWaiting for approval.`,
      status: "done",
      ts: Date.now(),
      agentId: agent.row.id,
      approval: info,
    };
    db.insertMessage(sysMsg);
    this.io.to(room.id).emit("chat-message", sysMsg);
    this.io.to(room.id).emit("tool-approval-requested", info);

    this.emitAgentStatus(room, agent.row.id, "idle");

    return true;
  }

  // -----------------------------------------------------------------------
  // joinRoom
  // -----------------------------------------------------------------------

  joinRoom(roomId: string, socket: Socket, userId: string): boolean {
    const room = this.rooms.get(roomId);
    if (!room) return false;

    const rawName = (socket.handshake.query.name as string) || "Anonymous";
    const name = rawName.trim().slice(0, MAX_NAME_LENGTH) || "Anonymous";
    const color = AVATAR_COLORS[room.colorIndex % AVATAR_COLORS.length];
    room.colorIndex++;

    room.participants.set(socket.id, { name, color, userId });
    this.socketRooms.set(socket.id, roomId);
    (socket.data as { userId?: string }).userId = userId;
    socket.join(roomId);

    // Only take the driver seat when vacant
    const driverStillPresent =
      room.driverSocketId != null &&
      room.participants.has(room.driverSocketId);
    if (!driverStillPresent) {
      room.driverSocketId = socket.id;
    }

    socket.emit("chat-history", db.getMessages(roomId, 500));

    // Emit agents snapshot and conflicts
    const agentInfos: AgentInfo[] = [];
    for (const a of room.agents.values()) {
      agentInfos.push(this.toAgentInfo(a.row));

      if (a.diffWatcher) {
        const lastPatch = a.diffWatcher.getLastPatch();
        if (lastPatch) socket.emit("diff-update", lastPatch, a.row.id);
      }
    }
    socket.emit("agents", agentInfos);

    const conflictData = [...room.agents.values()].map((a) => ({
      id: a.row.id,
      status: a.row.status,
      scopePath: a.row.scope_path,
      touchedPaths: a.touchedPaths,
    }));
    socket.emit("agent-conflicts", detectAgentConflicts(conflictData));
    socket.emit("file-locks", this.fileLocks.list(roomId));
    socket.emit(
      "tool-approvals",
      db.listPendingApprovals(roomId).map((r) => this.approvalRowToInfo(r)),
    );
    socket.emit(
      "room-pings",
      db.listOpenRoomPings(roomId).map((r) => this.pingRowToInfo(r)),
    );
    socket.emit("room-context", this.getRoomContextSnapshot(roomId));

    if (room.row.runtime === "cloud") {
      socket.emit("cloud-meta", room.cloudMeta);
    }

    // Emit per-agent status
    for (const [agentId, agent] of room.agents) {
      const status =
        agent.workerRunActive || agent.backend.isBusy() ? "running" : "idle";
      socket.emit("agent-status", agentId, status);
    }

    // Legacy single-agent compat
    if (room.agents.size <= 1) {
      const defaultAgent = this.getDefaultAgent(room);
      const status =
        defaultAgent.workerRunActive || defaultAgent.backend.isBusy()
          ? "running"
          : "idle";
      socket.emit("agent-status", status);
    }

    this.broadcastPresence(room);
    this.broadcastMembers(roomId);
    socket.emit("members-updated", this.listMembers(roomId));
    db.updateRoomActivity(roomId);
    console.log(`${name} joined room ${roomId} (${socket.id})`);
    return true;
  }

  // -----------------------------------------------------------------------
  // leaveRoom
  // -----------------------------------------------------------------------

  leaveRoom(socket: Socket): void {
    const roomId = this.socketRooms.get(socket.id);
    if (!roomId) return;
    const room = this.rooms.get(roomId);
    if (!room) return;

    const p = room.participants.get(socket.id);
    this.clearTypingForSocket(room, socket.id);
    room.participants.delete(socket.id);
    this.socketRooms.delete(socket.id);

    // Room-level driver fallback
    if (socket.id === room.driverSocketId) {
      room.driverSocketId = null;
      if (
        room.pendingDriveRequest &&
        room.participants.has(room.pendingDriveRequest.socketId)
      ) {
        room.driverSocketId = room.pendingDriveRequest.socketId;
        const granted = this.io.sockets.sockets.get(room.driverSocketId);
        if (granted) granted.emit("drive-granted");
        room.pendingDriveRequest = null;
      } else {
        for (const [sid] of room.participants) {
          room.driverSocketId = sid;
          break;
        }
      }
    }

    if (
      room.pendingDriveRequest &&
      room.pendingDriveRequest.socketId === socket.id
    ) {
      room.pendingDriveRequest = null;
    }

    // Per-agent driver cleanup
    for (const [agentId, agent] of room.agents) {
      if (agent.driverSocketId === socket.id) {
        agent.driverSocketId = null;
        db.clearAgentDriver(agentId);
        if (
          agent.pendingDriveRequest &&
          room.participants.has(agent.pendingDriveRequest.socketId)
        ) {
          agent.driverSocketId = agent.pendingDriveRequest.socketId;
          const nextP = room.participants.get(agent.driverSocketId!);
          if (nextP?.userId) db.setAgentDriver(agentId, nextP.userId);
          this.io.sockets.sockets
            .get(agent.driverSocketId!)
            ?.emit("drive-granted", agent.row.id);
          agent.pendingDriveRequest = null;
        }
      }
      if (
        agent.pendingDriveRequest &&
        agent.pendingDriveRequest.socketId === socket.id
      ) {
        agent.pendingDriveRequest = null;
      }
    }

    this.broadcastPresence(room);
    console.log(`${p?.name || "Unknown"} left room ${roomId}`);
  }

  handleLeaveRoom(socket: Socket): void {
    const room = this.getRoomForSocket(socket.id);
    if (!room) return;
    const p = room.participants.get(socket.id);
    const userId = p?.userId;
    if (!userId) return;

    if (room.row.owner_id === userId) {
      socket.emit("error", "Host cannot leave — stop the session instead");
      return;
    }

    db.removeRoomMember(room.id, userId);
    socket.emit("kicked", "You left the session");
    this.leaveRoom(socket);
    this.broadcastMembers(room.id);
    socket.disconnect(true);
  }

  handleRemoveMember(socket: Socket, targetUserIdRaw: string): void {
    const room = this.getRoomForSocket(socket.id);
    if (!room) return;
    const actor = room.participants.get(socket.id);
    if (!actor?.userId || !this.userCanManageRoom(room.id, actor.userId)) {
      socket.emit("error", "Only the host or a team admin can remove members");
      return;
    }

    const targetUserId = String(targetUserIdRaw || "").trim();
    if (!targetUserId) return;
    if (targetUserId === actor.userId || targetUserId === room.row.owner_id) {
      socket.emit("error", "Cannot remove the host");
      return;
    }

    db.removeRoomMember(room.id, targetUserId);

    for (const [sid, p] of [...room.participants.entries()]) {
      if (p.userId !== targetUserId) continue;
      const targetSocket = this.io.sockets.sockets.get(sid);
      if (targetSocket) {
        targetSocket.emit("kicked", "Removed from the session");
        this.leaveRoom(targetSocket);
        targetSocket.disconnect(true);
      }
    }
    this.broadcastPresence(room);
    this.broadcastMembers(room.id);
  }

  isRoomOwner(roomId: string, userId: string): boolean {
    const row = db.getRoom(roomId);
    return Boolean(row && row.owner_id === userId);
  }

  // -----------------------------------------------------------------------
  // Typing indicators (per agent)
  // -----------------------------------------------------------------------

  private typingKey(socketId: string, agentId: string): string {
    return `${socketId}:${agentId}`;
  }

  private clearTypingTimer(room: RoomState, socketId: string, agentId: string): void {
    const key = this.typingKey(socketId, agentId);
    const timer = room.typingTimeouts.get(key);
    if (timer) {
      clearTimeout(timer);
      room.typingTimeouts.delete(key);
    }
  }

  private clearTypingForSocket(room: RoomState, socketId: string): void {
    const agents = room.typingBySocket.get(socketId);
    if (!agents?.size) {
      room.typingBySocket.delete(socketId);
      return;
    }
    for (const agentId of agents) {
      this.clearTypingTimer(room, socketId, agentId);
    }
    room.typingBySocket.delete(socketId);
    this.io.to(room.id).emit("typing-stop", { socketId });
  }

  private stopTypingAgent(
    room: RoomState,
    socketId: string,
    agentId: string,
  ): void {
    const agents = room.typingBySocket.get(socketId);
    if (!agents?.has(agentId)) {
      this.clearTypingTimer(room, socketId, agentId);
      return;
    }
    agents.delete(agentId);
    this.clearTypingTimer(room, socketId, agentId);
    if (agents.size === 0) room.typingBySocket.delete(socketId);
    this.io.to(room.id).emit("typing-stop", { socketId, agentId });
  }

  handleTyping(socket: Socket, agentIdRaw: string): void {
    const room = this.getRoomForSocket(socket.id);
    if (!room) return;
    const p = room.participants.get(socket.id);
    if (!p) return;

    const agentId = String(agentIdRaw || "").trim();
    if (!agentId || !room.agents.has(agentId)) return;

    let agents = room.typingBySocket.get(socket.id);
    if (!agents) {
      agents = new Set();
      room.typingBySocket.set(socket.id, agents);
    }
    const wasTyping = agents.has(agentId);
    agents.add(agentId);

    this.clearTypingTimer(room, socket.id, agentId);
    const key = this.typingKey(socket.id, agentId);
    room.typingTimeouts.set(
      key,
      setTimeout(() => {
        this.stopTypingAgent(room, socket.id, agentId);
      }, 4000),
    );

    if (!wasTyping) {
      socket.to(room.id).emit("typing", {
        socketId: socket.id,
        name: p.name,
        agentId,
      });
    }
  }

  handleTypingStop(socket: Socket, agentIdRaw?: string): void {
    const room = this.getRoomForSocket(socket.id);
    if (!room) return;
    const agentId =
      agentIdRaw === undefined || agentIdRaw === null
        ? ""
        : String(agentIdRaw).trim();
    if (!agentId) {
      this.clearTypingForSocket(room, socket.id);
      return;
    }
    this.stopTypingAgent(room, socket.id, agentId);
  }

  // -----------------------------------------------------------------------
  // handleSteerMessage — parse (textOrAgentId, text?) overload
  // -----------------------------------------------------------------------

  handleSteerMessage(
    socket: Socket,
    textOrAgentId: string,
    text?: string,
    extras?: { attachmentIds?: string[] },
  ): void {
    const room = this.getRoomForSocket(socket.id);
    if (!room) return;

    let agentId: string;
    let prompt: string;

    if (text !== undefined && text !== null) {
      agentId = textOrAgentId;
      prompt = text;
    } else {
      agentId = this.getDefaultAgent(room).row.id;
      prompt = textOrAgentId;
    }

    if (!prompt || typeof prompt !== "string") return;
    const sanitized = prompt.replace(/^\s+|\s+$/g, "");
    if (!sanitized) return;

    // Sending clears the typist's indicator for this agent.
    this.stopTypingAgent(room, socket.id, agentId);

    const agent = this.getAgentState(room, agentId);
    if (!agent) {
      socket.emit("error", `Agent ${agentId} not found`);
      return;
    }

    const p = room.participants.get(socket.id);
    const role = p?.userId
      ? this.resolveUserRoomRole(room.id, p.userId)
      : null;
    const isDriving =
      agent.driverSocketId === socket.id ||
      (room.agents.size <= 1 && room.driverSocketId === socket.id);
    const controlMode = this.getControlMode(room.row);
    const denied = steerDeniedReason({
      role,
      controlMode,
      isDrivingAgent: isDriving,
    });
    if (denied) {
      socket.emit("error", denied);
      return;
    }

    if (agent.workerRunActive || agent.backend.isBusy()) {
      socket.emit(
        "error",
        "Agent is still running — wait for it to finish before sending another message",
      );
      return;
    }

    agent.workerRunActive = true;

    const userRow = p?.userId ? db.getUserById(p.userId) : undefined;
    const steeredBy: SteerAuthor | null = p
      ? { userId: p.userId, name: p.name, email: userRow?.email }
      : null;
    agent.lastSteeredBy = steeredBy;
    if (agent.backend instanceof ClaudeSandboxSession) {
      agent.backend.setSteeredBy(steeredBy);
    }

    const uploads = resolveUploads(
      room.id,
      Array.isArray(extras?.attachmentIds) ? extras.attachmentIds : [],
    );
    const attachments = uploads.map(toAttachment);
    const materialized = materializeUploadsForAgent(agent.cwd, uploads);
    const sdkImages = toPromptImages(uploads);
    const canSendImages =
      agent.backend instanceof SdkAgentSession && sdkImages.length > 0;
    const promptFiles =
      materialized.length > 0
        ? materialized
        : room.row.runtime === "local"
          ? uploads.map((rec) => ({
              rec,
              agentPath: attachmentWorkspaceRelPath(rec.id, rec.name),
            }))
          : [];
    const attachSuffix = buildAttachmentPromptSuffix(uploads, promptFiles, {
      imagesAttachedToMessage: canSendImages,
    });

    const userMsg: ChatMessage = {
      id: nanoid(12),
      roomId: room.id,
      role: "user",
      content: sanitized,
      senderName: p?.name || "Unknown",
      senderColor: p?.color || "#888",
      senderUserId: p?.userId,
      status: "done",
      ts: Date.now(),
      agentId,
      attachments: attachments.length ? attachments : undefined,
    };

    db.insertMessage(userMsg);
    this.io.to(room.id).emit("chat-message", userMsg);
    db.updateRoomActivity(room.id);
    const promptWithAttr =
      sanitized + attachSuffix + attributionPromptSuffix(steeredBy);
    void this.runAgent(
      room,
      agent,
      canSendImages
        ? { text: promptWithAttr, images: sdkImages }
        : promptWithAttr,
      toWorkerAttachments(uploads),
    );
  }

  handleApprovePlan(
    socket: Socket,
    payload: { messageId: string; agentId?: string },
  ): void {
    const room = this.getRoomForSocket(socket.id);
    if (!room) return;
    const p = room.participants.get(socket.id);
    if (!p?.userId) {
      socket.emit("error", "Sign in required to approve a plan");
      return;
    }

    const messageId = String(payload?.messageId || "").trim();
    const msg = db.getMessage(messageId);
    if (!msg || msg.roomId !== room.id || msg.role !== "assistant") {
      socket.emit("error", "Plan not found");
      return;
    }
    if (msg.planStatus && msg.planStatus !== "pending") {
      socket.emit("error", "This plan has already been decided");
      return;
    }

    const agentId = payload?.agentId || msg.agentId || this.getDefaultAgent(room).row.id;
    const agent = this.getAgentState(room, agentId);
    if (!agent) {
      socket.emit("error", "Agent not found");
      return;
    }

    const role = this.resolveUserRoomRole(room.id, p.userId);
    const isDriving =
      agent.driverSocketId === socket.id ||
      (room.agents.size <= 1 && room.driverSocketId === socket.id);
    const denied = steerDeniedReason({
      role,
      controlMode: this.getControlMode(room.row),
      isDrivingAgent: isDriving,
    });
    if (denied) {
      socket.emit("error", denied);
      return;
    }

    if (agent.workerRunActive || agent.backend.isBusy()) {
      socket.emit("error", "Wait for the agent to finish before approving");
      return;
    }

    const updated = db.updateMessagePlanStatus(messageId, "approved");
    if (updated) this.io.to(room.id).emit("chat-message", updated);

    db.setAgentPlanMode(agent.row.id, false);
    agent.row.plan_mode = 0;
    this.applyBackendMode(agent);
    this.broadcastAgents(room);

    const sysMsg: ChatMessage = {
      id: nanoid(12),
      roomId: room.id,
      role: "system",
      content: `${p.name} approved the plan. Switching to agent mode to implement it.`,
      status: "done",
      ts: Date.now(),
      agentId: agent.row.id,
    };
    db.insertMessage(sysMsg);
    this.io.to(room.id).emit("chat-message", sysMsg);

    const steeredBy: SteerAuthor | null = {
      userId: p.userId,
      name: p.name,
      email: db.getUserById(p.userId)?.email,
    };
    agent.lastSteeredBy = steeredBy;
    agent.workerRunActive = true;
    void this.runAgent(
      room,
      agent,
      planImplementPrompt(msg.content) + attributionPromptSuffix(steeredBy),
    );
  }

  handleDismissPlan(socket: Socket, payload: { messageId: string }): void {
    const room = this.getRoomForSocket(socket.id);
    if (!room) return;
    const p = room.participants.get(socket.id);
    if (!p?.userId) {
      socket.emit("error", "Sign in required");
      return;
    }
    const messageId = String(payload?.messageId || "").trim();
    const msg = db.getMessage(messageId);
    if (!msg || msg.roomId !== room.id) {
      socket.emit("error", "Plan not found");
      return;
    }
    const role = this.resolveUserRoomRole(room.id, p.userId);
    if (role !== "owner" && role !== "editor") {
      socket.emit("error", "Only editors or the host can dismiss a plan");
      return;
    }
    const updated = db.updateMessagePlanStatus(messageId, "dismissed");
    if (updated) this.io.to(room.id).emit("chat-message", updated);
  }

  async handleRevertChanges(
    socket: Socket,
    payload: {
      roomId?: string;
      agentId?: string;
      filePaths?: string[];
      messageId?: string;
    },
  ): Promise<void> {
    const room = this.getRoomForSocket(socket.id);
    if (!room) return;
    const p = room.participants.get(socket.id);
    if (!p?.userId) {
      socket.emit("error", "Sign in required to revert changes");
      return;
    }
    const role = this.resolveUserRoomRole(room.id, p.userId);
    if (role === "viewer") {
      socket.emit("error", "Viewers cannot revert changes");
      return;
    }

    try {
      await this.revertChanges(room, {
        agentId: payload.agentId,
        filePaths: payload.filePaths,
        messageId: payload.messageId,
        actorUserId: p.userId,
      });
    } catch (err) {
      socket.emit(
        "error",
        `Failed to revert changes: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async revertChanges(
    room: RoomState,
    opts: {
      agentId?: string;
      filePaths?: string[];
      messageId?: string;
      actorUserId?: string;
    },
  ): Promise<{ reverted: string[]; errors: string[] }> {
    const agent = opts.agentId ? room.agents.get(opts.agentId) : undefined;
    let pathsToRevert: string[] = [];

    if (opts.filePaths && opts.filePaths.length > 0) {
      pathsToRevert = [...opts.filePaths];
    } else if (opts.messageId) {
      const msg = db.getMessage(opts.messageId);
      if (msg) {
        const p =
          extractToolPath(msg.content) ||
          (msg.toolName && isEditTool(msg.toolName) ? msg.content : "");
        if (p) pathsToRevert = [p];
      }
    } else if (agent) {
      pathsToRevert = [
        ...new Set([...agent.filePatches.keys(), ...agent.touchedPaths]),
      ];
    } else {
      const allPaths = new Set<string>();
      for (const a of room.agents.values()) {
        for (const p of a.filePatches.keys()) allPaths.add(p);
        for (const p of a.touchedPaths) allPaths.add(p);
      }
      pathsToRevert = [...allPaths];
    }

    // If local room and no paths found in agent memory, check git status
    if (
      pathsToRevert.length === 0 &&
      room.row.runtime === "local" &&
      room.row.repo_path
    ) {
      pathsToRevert = await getUncommittedFiles(room.row.repo_path);
    }

    if (pathsToRevert.length === 0) {
      return { reverted: [], errors: [] };
    }

    let reverted: string[] = [];
    const errors: string[] = [];

    if (this.workerRelay?.hasWorker(room.id)) {
      const workerRes = await this.workerRelay.revertFilesOnWorker(
        room.id,
        pathsToRevert,
        agent?.row.id,
        opts.messageId,
      );
      reverted = workerRes.reverted;
      errors.push(...workerRes.errors);
    } else if (room.row.runtime === "local" && room.row.repo_path) {
      const localRes = await revertFiles(room.row.repo_path, pathsToRevert);
      reverted = localRes.reverted;
      errors.push(...localRes.errors);
    } else {
      reverted = [...pathsToRevert];
    }

    // Clean up filePatches and touchedPaths for affected agents
    const affectedAgents = agent ? [agent] : [...room.agents.values()];
    for (const a of affectedAgents) {
      for (const p of reverted) {
        a.filePatches.delete(p);
        a.touchedPaths.delete(p);
        for (const k of [...a.filePatches.keys()]) {
          if (k.endsWith(p) || p.endsWith(k)) {
            a.filePatches.delete(k);
          }
        }
        for (const k of [...a.touchedPaths]) {
          if (k.endsWith(p) || p.endsWith(k)) {
            a.touchedPaths.delete(k);
          }
        }
      }
      this.emitAgentDiff(room, a);
    }

    if (opts.messageId) {
      db.updateMessageReverted(opts.messageId, true);
      const msg = db.getMessage(opts.messageId);
      if (msg) {
        msg.reverted = true;
        this.io.to(room.id).emit("chat-message", msg);
      }
    }

    // Post a brief system message announcing the revert
    if (reverted.length > 0) {
      const actorName = opts.actorUserId
        ? db.getUserById(opts.actorUserId)?.name || "User"
        : "User";
      const sysMsg: ChatMessage = {
        id: nanoid(12),
        roomId: room.id,
        role: "system",
        content: `↺ ${actorName} reverted changes to ${
          reverted.length === 1
            ? `\`${reverted[0]}\``
            : `${reverted.length} files (${reverted.map((f) => `\`${f}\``).join(", ")})`
        }`,
        status: "done",
        ts: Date.now(),
        agentId: agent?.row.id,
      };
      db.insertMessage(sysMsg);
      this.io.to(room.id).emit("chat-message", sysMsg);
    }

    // Broadcast changes-reverted
    this.io.to(room.id).emit("changes-reverted", {
      agentId: agent?.row.id,
      filePaths: reverted,
      messageId: opts.messageId,
    });

    return { reverted, errors };
  }

  private markAssistantPlan(
    room: RoomState,
    agent: AgentState,
    messageId: string | null,
    content: string,
    status: ChatMessage["status"],
  ): void {
    if (!messageId || status !== "done") return;
    if (!agent.row.plan_mode) return;
    if (!looksLikePlan(content)) return;
    const updated = db.updateMessagePlanStatus(messageId, "pending");
    if (updated) this.io.to(room.id).emit("chat-message", updated);
  }

  // -----------------------------------------------------------------------
  // tryDispatchToWorker
  // -----------------------------------------------------------------------

  private tryDispatchToWorker(
    room: RoomState,
    agent: AgentState,
    prompt: AgentPrompt,
    workerAttachments?: WorkerPromptAttachment[],
  ): boolean {
    if (!this.workerRelay) return false;
    if (room.row.auth_mode !== "cli") return false;
    if (room.row.runtime !== "local") return false;

    const ownerId = room.row.owner_id ?? undefined;
    const worker = ownerId
      ? this.workerRelay.findWorkerForUser(ownerId)
      : null;

    if (!worker) return false;

    this.applyBackendMode(agent);

    for (const c of agent.workerRunCleanups) c();
    agent.workerRunCleanups = [];
    agent.workerRunActive = true;
    const generation = ++agent.runGeneration;

    this.emitAgentStatus(room, agent.row.id, "running");

    let assistantId: string | null = null;
    let assistantContent = "";
    let seenFullText = "";
    let bubbleBaseLen = 0;
    let afterTools = false;
    let finished = false;
    agent.toolMsgIds.clear();
    agent.toolPaths.clear();
    agent.lastToolMsgId = null;
    agent.todoMsgId = null;

    const isCurrent = () => agent.runGeneration === generation;

    const finishWorkerRun = (
      status: "idle" | "error" = "idle",
      detail?: string,
    ) => {
      if (finished) return;
      finished = true;
      agent.workerRunActive = false;
      closeAssistant(status === "error" ? "error" : "done");

      // Aborted — abortRun already finalized messages and set idle.
      if (!isCurrent()) {
        this.workerRelay?.releaseRun(room.id, agent.row.id);
        for (const c of agent.workerRunCleanups) c();
        agent.workerRunCleanups = [];
        return;
      }

      db.updateAgentStatus(agent.row.id, status === "error" ? "error" : "idle");
      agent.row.status = status === "error" ? "error" : "idle";
      this.broadcastAgents(room);

      if (status === "error" && detail) {
        this.emitAgentStatus(room, agent.row.id, "error", detail);
      }
      this.emitAgentStatus(room, agent.row.id, "idle");
      this.notifyRunFinished(
        room,
        agent,
        status === "error" ? "error" : "completed",
        detail,
      );
      this.workerRelay?.releaseRun(room.id, agent.row.id);
      for (const c of agent.workerRunCleanups) c();
      agent.workerRunCleanups = [];
    };

    const closeAssistant = (status: ChatMessage["status"] = "done") => {
      if (!assistantId) return;
      db.updateMessageContent(assistantId, assistantContent, status);
      this.io
        .to(room.id)
        .emit("chat-delta", assistantId, assistantContent, status);
      this.markAssistantPlan(room, agent, assistantId, assistantContent, status);
      assistantId = null;
      assistantContent = "";
    };

    const emitAssistantFromWorker = (
      text: string,
      status: ChatMessage["status"],
    ) => {
      if (afterTools) {
        closeAssistant("done");
        afterTools = false;
        bubbleBaseLen = seenFullText.length;
      }
      if (!assistantId) {
        let display = "";
        if (seenFullText && text.startsWith(seenFullText)) {
          display = text.slice(seenFullText.length).replace(/^\n+/, "");
        } else if (!text || text === seenFullText) {
          display = "";
        } else {
          display = text;
        }
        if (!display) {
          if (text.length > seenFullText.length) seenFullText = text;
          return;
        }
        bubbleBaseLen = seenFullText.length;
        const msg: ChatMessage = {
          id: nanoid(12),
          roomId: room.id,
          role: "assistant",
          content: display,
          status,
          ts: Date.now(),
          agentId: agent.row.id,
        };
        assistantId = msg.id;
        assistantContent = display;
        seenFullText = text.startsWith(seenFullText)
          ? text
          : seenFullText
            ? `${seenFullText}\n${text}`
            : text;
        db.insertMessage(msg);
        this.io.to(room.id).emit("chat-message", msg);
        return;
      }
      let display: string;
      if (
        text.length >= bubbleBaseLen &&
        (text.startsWith(seenFullText.slice(0, bubbleBaseLen)) ||
          seenFullText.startsWith(text.slice(0, bubbleBaseLen)))
      ) {
        display = text.slice(bubbleBaseLen).replace(/^\n+/, "");
        seenFullText =
          text.length >= seenFullText.length ? text : seenFullText;
      } else if (text.length >= seenFullText.length) {
        display = text;
        seenFullText = text;
      } else {
        display = assistantContent;
      }
      assistantContent = display || assistantContent;
      db.updateMessageContent(assistantId, assistantContent, status);
      this.io
        .to(room.id)
        .emit("chat-delta", assistantId, assistantContent, status);
    };

    const unsubEvent = this.workerRelay.onAgentEvent(
      room.id,
      agent.row.id,
      (_roomId, _agentId, event) => {
        if (!isCurrent()) return;
        switch (event.kind) {
          case "session":
            if (event.sessionId) {
              this.persistAgentSession(room, agent, event.sessionId);
            }
            break;
          case "assistant_delta":
          case "assistant_final":
            emitAssistantFromWorker(
              event.text || "",
              event.kind === "assistant_final" ? "done" : "streaming",
            );
            break;
          case "tool_start": {
            closeAssistant("done");
            afterTools = true;
            bubbleBaseLen = seenFullText.length;
            const toolPath = event.path;
            if (
              !this.tryAcquireEditLock(
                room,
                agent,
                event.name,
                toolPath,
                event.callId,
              )
            ) {
              const holder =
                this.fileLocks.list(room.id).find((l) => l.path === toolPath)
                  ?.agentId || "another agent";
              finishWorkerRun(
                "error",
                this.lockConflictMessage(room, toolPath || "file", holder),
              );
              this.workerRelay?.abortRun(room.id, agent.row.id);
              break;
            }
            if (
              this.gateDangerousTool(
                room,
                agent,
                {
                  callId: event.callId || nanoid(12),
                  name: event.name || "tool",
                  detail: event.detail || "",
                  path: toolPath,
                },
                () => {
                  this.workerRelay?.abortRun(room.id, agent.row.id);
                  finishWorkerRun("idle");
                },
              )
            ) {
              break;
            }
            this.upsertAgentToolMessage(room, agent, {
              callId: event.callId,
              name: event.name || "tool",
              content: event.detail || "Running…",
              path: toolPath,
              todos: event.todos?.length ? event.todos : undefined,
              questions: event.questions?.length ? event.questions : undefined,
              status: "streaming",
            });
            break;
          }
          case "tool_done": {
            const toolPath =
              event.path ||
              (event.callId
                ? agent.toolPaths.get(event.callId)
                : undefined);
            this.releaseEditLock(room, agent, event.name, toolPath);
            if (toolPath && event.name && isEditTool(event.name)) {
              this.noteTouchedPath(room, agent, toolPath);
            }
            this.upsertAgentToolMessage(room, agent, {
              callId: event.callId,
              name: event.name || "tool",
              content: event.detail || event.path || "Done",
              path: toolPath,
              todos: event.todos?.length ? event.todos : undefined,
              questions: event.questions?.length ? event.questions : undefined,
              status: "done",
              diffPatch: event.diffPatch?.trim() || undefined,
              allowLastToolFallback: true,
            });
            afterTools = true;
            break;
          }
          case "error":
            emitAssistantFromWorker(event.message || "Unknown error", "error");
            finishWorkerRun("error", event.message || "Agent error");
            break;
          case "done":
            emitAssistantFromWorker(event.result || "", "done");
            finishWorkerRun("idle");
            break;
        }
      },
    );

    const unsubDiff = this.workerRelay.onFileDiff(
      room.id,
      agent.row.id,
      (_roomId, _agentId, callId, toolName, path, patch) => {
        if (!isCurrent()) return;
        const msgId = agent.toolMsgIds.get(callId);
        if (!msgId) {
          console.warn(
            `[RoomManager] Dropping file-diff for unknown callId=${callId} path=${path}`,
          );
          return;
        }
        db.updateMessageDiff(msgId, path, "done", patch);
        this.io.to(room.id).emit("chat-message", {
          id: msgId,
          roomId: room.id,
          role: "tool",
          content: path,
          toolName,
          diffPatch: patch,
          status: "done",
          ts: Date.now(),
          agentId: agent.row.id,
        });

        agent.filePatches.set(path, patch);
        this.noteTouchedPath(room, agent, path);
        this.emitAgentDiff(room, agent);
      },
    );

    agent.workerRunCleanups.push(unsubEvent, unsubDiff);

    let dispatched: boolean;
    try {
      dispatched = this.workerRelay.dispatchToWorker(
        room.id,
        worker.workerId,
        promptText(prompt),
        room.row.repo_path,
        agent.row.model_id || "auto",
        agent.row.session_id,
        agent.row.id,
        agent.cwd,
        agent.row.backend,
        agent.row.plan_mode ? "plan" : "agent",
        workerAttachments,
      );
    } catch (err) {
      // Multi-agent CLI upgrade error
      const msg = err instanceof Error ? err.message : String(err);
      finishWorkerRun("error", msg);
      return true;
    }

    if (!dispatched) {
      finishWorkerRun("error", "Failed to reach Steer worker");
      return true;
    }

    return true;
  }

  // -----------------------------------------------------------------------
  // Soft / hard disconnect — per agent
  // -----------------------------------------------------------------------

  private handleWorkerSoftDisconnect(roomId: string, agentId: string): void {
    const room = this.rooms.get(roomId);
    if (!room) return;
    const agent = room.agents.get(agentId);
    if (!agent || !agent.workerRunActive) return;

    const msg =
      "Worker connection lost — agent is still running on your machine and will sync when `steer` reconnects.";
    const note: ChatMessage = {
      id: nanoid(12),
      roomId: room.id,
      role: "assistant",
      content: msg,
      status: "done",
      ts: Date.now(),
      agentId,
    };
    db.insertMessage(note);
    this.io.to(room.id).emit("chat-message", note);
    this.emitAgentStatus(room, agentId, "running");
  }

  private handleWorkerLost(roomId: string, agentId: string): void {
    const room = this.rooms.get(roomId);
    if (!room) return;
    const agent = room.agents.get(agentId);
    if (!agent) return;
    if (!agent.workerRunActive && agent.workerRunCleanups.length === 0) return;

    console.warn(
      `[RoomManager] Worker lost for room ${roomId} agent ${agentId} — clearing run`,
    );
    agent.workerRunActive = false;
    for (const c of agent.workerRunCleanups) c();
    agent.workerRunCleanups = [];
    this.fileLocks.releaseAllForAgent(roomId, agentId);
    this.workerRelay?.releaseRun(roomId, agentId);
    this.workerRelay?.clearRunListeners(roomId, agentId);

    const msg =
      "Worker did not reconnect in time. If the agent finished locally, send a new message to continue.";
    const errMsg: ChatMessage = {
      id: nanoid(12),
      roomId: room.id,
      role: "assistant",
      content: msg,
      status: "error",
      ts: Date.now(),
      agentId,
    };
    db.insertMessage(errMsg);
    this.io.to(room.id).emit("chat-message", errMsg);
    this.emitAgentStatus(room, agentId, "error", msg);
    this.emitAgentStatus(room, agentId, "idle");
  }

  // -----------------------------------------------------------------------
  // runAgent
  // -----------------------------------------------------------------------

  private async runAgent(
    room: RoomState,
    agent: AgentState,
    prompt: AgentPrompt,
    workerAttachments?: WorkerPromptAttachment[],
  ): Promise<void> {
    let nextPrompt: AgentPrompt = prompt;
    agent.runStartedAt = Date.now();
    try {
      const priorReceipts = db.listAgentContextReceipts(agent.row.id, 1);
      const skipBriefing =
        agent.seedContext === false && priorReceipts.length === 0;
      agent.seedContext = true;
      if (!skipBriefing) {
        const packed = buildAgentBriefing({
          room: room.row,
          agent: agent.row,
          prompt: promptText(prompt),
          touchedPaths: [...agent.touchedPaths],
          checkoutRoot: agent.cwd || room.row.repo_path,
        });
        const text = prependPackedContext(promptText(prompt), packed);
        nextPrompt =
          typeof prompt === "string" ? text : { ...prompt, text };
        const receipts = db.listAgentContextReceipts(agent.row.id, 1);
        if (receipts[0]) {
          this.io.to(room.id).emit("context-receipt", toReceiptInfo(receipts[0]));
        }
      }
    } catch (err) {
      console.warn(
        "[RoomManager] context briefing failed:",
        err instanceof Error ? err.message : err,
      );
    }

    if (this.tryDispatchToWorker(room, agent, nextPrompt, workerAttachments))
      return;

    // CLI rooms whose repo isn't on this host must use the worker
    if (
      room.row.auth_mode === "cli" &&
      (!room.row.repo_path || !existsSync(room.row.repo_path))
    ) {
      agent.workerRunActive = false;
      const msg = room.row.owner_id
        ? "No online Steer worker for this account. Run `steer start` on your machine."
        : "No online Steer worker. Run `steer start`, or recreate the session while signed in.";
      const errMsg: ChatMessage = {
        id: nanoid(12),
        roomId: room.id,
        role: "assistant",
        content: msg,
        status: "error",
        ts: Date.now(),
        agentId: agent.row.id,
      };
      db.insertMessage(errMsg);
      this.io.to(room.id).emit("chat-message", errMsg);
      this.emitAgentStatus(room, agent.row.id, "error", msg);
      this.emitAgentStatus(room, agent.row.id, "idle");
      return;
    }

    this.applyBackendMode(agent);
    if (agent.backend instanceof ClaudeSandboxSession) {
      agent.backend.setSteeredBy(agent.lastSteeredBy);
    }

    this.emitAgentStatus(room, agent.row.id, "running");
    agent.workerRunActive = true;
    const generation = ++agent.runGeneration;

    let assistantId: string | null = null;
    let assistantContent = "";
    let seenFullText = "";
    let bubbleBaseLen = 0;
    let afterTools = false;
    agent.toolMsgIds.clear();
    agent.toolPaths.clear();
    agent.lastToolMsgId = null;
    agent.todoMsgId = null;

    const isCurrent = () => agent.runGeneration === generation;

    const attachFileDiff = async (
      msgId: string,
      toolName: string,
      detail: string,
      pathHint?: string,
      alreadyHasPatch?: boolean,
    ) => {
      if (!isCurrent()) return;
      if (room.row.runtime !== "local" || !room.row.repo_path) return;
      if (!isEditTool(toolName)) return;
      const path = pathHint || extractToolPath(detail);
      if (!path) return;

      await new Promise((r) => setTimeout(r, 120));
      if (!isCurrent()) return;
      const patch = (await getFileDiff(room.row.repo_path, path)).trim();
      if (!patch) return;
      if (alreadyHasPatch) {
        // Still upgrade — git patch is usually richer than StrReplace spans.
      }

      const content = detail || path;
      db.updateMessageDiff(msgId, content, "done", patch);
      this.io.to(room.id).emit("chat-message", {
        id: msgId,
        roomId: room.id,
        role: "tool",
        content,
        toolName,
        diffPatch: patch,
        status: "done",
        ts: Date.now(),
        agentId: agent.row.id,
      });

      agent.filePatches.set(path, patch);
      this.noteTouchedPath(room, agent, path);
      this.emitAgentDiff(room, agent);
    };

    const closeAssistant = (status: ChatMessage["status"] = "done") => {
      if (!assistantId) return;
      db.updateMessageContent(assistantId, assistantContent, status);
      this.io
        .to(room.id)
        .emit("chat-delta", assistantId, assistantContent, status);
      this.markAssistantPlan(room, agent, assistantId, assistantContent, status);
      assistantId = null;
      assistantContent = "";
    };

    const emitAssistant = (
      incoming: string,
      status: ChatMessage["status"],
    ) => {
      const text = incoming ?? "";

      if (afterTools) {
        closeAssistant("done");
        afterTools = false;
        bubbleBaseLen = seenFullText.length;
      }

      if (!assistantId) {
        let display = "";
        if (seenFullText && text.startsWith(seenFullText)) {
          display = text.slice(seenFullText.length).replace(/^\n+/, "");
        } else if (!text || text === seenFullText) {
          display = "";
        } else {
          display = text;
        }

        if (!display) {
          if (text.length > seenFullText.length) seenFullText = text;
          return;
        }

        bubbleBaseLen = seenFullText.length;
        const msg: ChatMessage = {
          id: nanoid(12),
          roomId: room.id,
          role: "assistant",
          content: display,
          status,
          ts: Date.now(),
          agentId: agent.row.id,
        };
        assistantId = msg.id;
        assistantContent = display;
        seenFullText = text.startsWith(seenFullText)
          ? text
          : seenFullText
            ? `${seenFullText}\n${text}`
            : text;
        db.insertMessage(msg);
        this.io.to(room.id).emit("chat-message", msg);
        return;
      }

      let display: string;
      if (
        text.length >= bubbleBaseLen &&
        (text.startsWith(seenFullText.slice(0, bubbleBaseLen)) ||
          seenFullText.startsWith(text.slice(0, bubbleBaseLen)))
      ) {
        display = text.slice(bubbleBaseLen).replace(/^\n+/, "");
        seenFullText =
          text.length >= seenFullText.length ? text : seenFullText;
      } else if (text.length >= seenFullText.length) {
        display = text;
        seenFullText = text;
      } else {
        display = assistantContent;
      }

      assistantContent = display || assistantContent;
      db.updateMessageContent(assistantId, assistantContent, status);
      this.io
        .to(room.id)
        .emit("chat-delta", assistantId, assistantContent, status);
    };

    try {
      const sdkId = agent.backend.getAgentId();
      if (sdkId && sdkId !== agent.row.sdk_agent_id) {
        db.setAgentSdkId(agent.row.id, sdkId);
        agent.row.sdk_agent_id = sdkId;
        // Also keep room-level field for default agent
        const def = this.getDefaultAgent(room);
        if (agent.row.id === def.row.id) {
          db.setCursorAgentId(room.id, sdkId);
          room.row.cursor_agent_id = sdkId;
        }
      }

      const onAgentEvent = (event: SdkStreamEvent | NormalizedAgentEvent) => {
        if (!isCurrent()) return;
        switch (event.kind) {
          case "session":
            this.persistAgentSession(room, agent, event.sessionId);
            break;
          case "assistant_delta":
          case "assistant_final":
            emitAssistant(
              event.text,
              event.kind === "assistant_final" ? "done" : "streaming",
            );
            break;
          case "tool_start": {
            closeAssistant("done");
            afterTools = true;
            bubbleBaseLen = seenFullText.length;

            const path =
              event.path || extractToolPath(event.detail) || undefined;
            if (
              !this.tryAcquireEditLock(
                room,
                agent,
                event.name,
                path,
                event.callId,
              )
            ) {
              const holder =
                this.fileLocks
                  .list(room.id)
                  .find((l) => path && l.path === path)?.agentId ||
                "another agent";
              throw new Error(
                this.lockConflictMessage(room, path || "file", holder),
              );
            }
            if (
              this.gateDangerousTool(
                room,
                agent,
                {
                  callId: event.callId,
                  name: event.name || "tool",
                  detail: event.detail || "",
                  path,
                },
                () => {
                  agent.runGeneration++;
                  void agent.backend.abortAndWait();
                },
              )
            ) {
              break;
            }
            this.upsertAgentToolMessage(room, agent, {
              callId: event.callId,
              name: event.name || "tool",
              content: event.detail || "Running…",
              path,
              todos: event.todos?.length ? event.todos : undefined,
              questions: event.questions?.length ? event.questions : undefined,
              status: "streaming",
            });
            break;
          }
          case "tool_done": {
            const path =
              event.path ||
              (event.callId
                ? agent.toolPaths.get(event.callId)
                : undefined) ||
              extractToolPath(event.detail) ||
              undefined;
            this.releaseEditLock(room, agent, event.name, path);
            if (path && event.name && isEditTool(event.name)) {
              this.noteTouchedPath(room, agent, path);
            }
            const content = event.detail || path || "Done";
            const synthetic = event.diffPatch?.trim() || "";
            const id = this.upsertAgentToolMessage(room, agent, {
              callId: event.callId,
              name: event.name || "tool",
              content,
              path,
              todos: event.todos?.length ? event.todos : undefined,
              questions: event.questions?.length ? event.questions : undefined,
              status: "done",
              diffPatch: synthetic || undefined,
              allowLastToolFallback: true,
            });
            if (id) {
              void attachFileDiff(
                id,
                event.name,
                content,
                path,
                Boolean(synthetic),
              );
            }
            afterTools = true;
            break;
          }
          case "error":
            emitAssistant(event.message, "error");
            this.emitAgentStatus(
              room,
              agent.row.id,
              "error",
              event.message,
            );
            break;
          case "done": {
            emitAssistant(event.result, "done");
            closeAssistant("done");
            const git =
              "git" in event && event.git
                ? event.git
                : undefined;
            if (git?.branches?.length) {
              const branch = git.branches[0];
              if (isIntegratorAgent(agent.row)) {
                if (branch.prUrl) {
                  db.setRoomIntegration(room.id, {
                    prUrl: branch.prUrl,
                    branch: branch.branch || undefined,
                  });
                  room.row.integration_pr_url = branch.prUrl;
                  agent.row.pr_url = branch.prUrl;
                }
                if (branch.branch) {
                  agent.row.branch = branch.branch;
                  if (!room.row.integration_branch) {
                    db.setRoomIntegration(room.id, { branch: branch.branch });
                    room.row.integration_branch = branch.branch;
                  }
                }
                db.setAgentPr(
                  agent.row.id,
                  branch.prUrl || agent.row.pr_url || null,
                  branch.branch || agent.row.branch || null,
                );
                this.emitIntegrationUpdated(room, {
                  sourceAgentId: "",
                  integratorAgentId: agent.row.id,
                });
                this.broadcastAgents(room);
              } else {
                room.cloudMeta = {
                  ...room.cloudMeta,
                  repoUrl: branch.repoUrl || room.cloudMeta.repoUrl,
                  branch: branch.branch || room.cloudMeta.branch,
                  prUrl: branch.prUrl || room.cloudMeta.prUrl,
                };
                if (branch.prUrl || branch.branch) {
                  if (branch.prUrl) {
                    db.setPrUrl(room.id, branch.prUrl);
                    room.row.pr_url = branch.prUrl;
                    agent.row.pr_url = branch.prUrl;
                  }
                  db.setAgentPr(
                    agent.row.id,
                    branch.prUrl || agent.row.pr_url || null,
                    branch.branch || agent.row.branch || null,
                  );
                  if (branch.branch) agent.row.branch = branch.branch;
                }
                this.io.to(room.id).emit("cloud-meta", room.cloudMeta);
                this.broadcastAgents(room);
              }
            }
            break;
          }
        }
      };

      if (agent.backend instanceof SdkAgentSession) {
        await agent.backend.run(prompt, onAgentEvent);
      } else {
        await agent.backend.run(promptText(prompt), onAgentEvent);
      }

      // Aborted while running — abortRun already finalized UI state.
      if (!isCurrent()) return;

      const latestId = agent.backend.getAgentId();
      if (latestId && latestId !== agent.row.sdk_agent_id) {
        db.setAgentSdkId(agent.row.id, latestId);
        agent.row.sdk_agent_id = latestId;
        const def = this.getDefaultAgent(room);
        if (agent.row.id === def.row.id) {
          db.setCursorAgentId(room.id, latestId);
          room.row.cursor_agent_id = latestId;
        }
      }

      const sessionId = agent.backend.getSessionId();
      if (sessionId && sessionId !== agent.row.session_id) {
        this.persistAgentSession(room, agent, sessionId);
      }

      agent.workerRunActive = false;
      this.emitAgentStatus(room, agent.row.id, "idle");
      this.notifyRunFinished(room, agent, "completed");
    } catch (err) {
      if (!isCurrent()) return;
      const message = err instanceof Error ? err.message : String(err);
      emitAssistant(message, "error");
      this.emitAgentStatus(room, agent.row.id, "error", message);
      this.emitAgentStatus(room, agent.row.id, "idle");
      this.notifyRunFinished(room, agent, "error", message);
    } finally {
      if (isCurrent()) {
        agent.workerRunActive = false;
      } else {
        // Ensure open bubbles are closed even if abort raced with local state.
        closeAssistant("done");
        agent.workerRunActive = false;
      }
    }

    db.updateRoomActivity(room.id);
  }

  private notifyRunFinished(
    room: RoomState,
    agent: AgentState,
    outcome: "completed" | "error" | "aborted",
    detail?: string,
  ): void {
    const suffix = detail ? ` — ${detail.slice(0, 120)}` : "";
    notifyEvent({
      kind: "run_finished",
      title: outcome === "completed" ? "Agent run finished" : `Agent run ${outcome}`,
      text: `${agent.row.label} in “${room.row.name}” is ${outcome}${suffix}`,
      roomId: room.id,
      meta: { agentId: agent.row.id, outcome },
    });
    if (outcome === "completed" || outcome === "error") {
      const receipts = db.listAgentContextReceipts(agent.row.id, 1);
      const current = db.getRoomMemoryVersion(room.id);
      if (receipts[0] && receipts[0].memory_version < current) {
        this.io.to(room.id).emit("context-stale", {
          agentId: agent.row.id,
          usedVersion: receipts[0].memory_version,
          currentVersion: current,
        });
      }
    }
    this.ingestAutoMemory(room, agent, outcome);
    if (isIntegratorAgent(agent.row)) {
      void this.finishIntegrationJob(room, agent, outcome);
    }
  }

  private ingestAutoMemory(
    room: RoomState,
    agent: AgentState,
    outcome: "completed" | "error" | "aborted",
  ): void {
    const now = Date.now();
    const advanceCursor = () => {
      try {
        db.setAgentAutoMemCursor(agent.row.id, now);
        agent.row.auto_mem_cursor_ts = now;
      } catch (err) {
        console.warn(
          "[RoomManager] auto-memory cursor failed:",
          err instanceof Error ? err.message : err,
        );
      }
    };

    if (outcome !== "completed") {
      advanceCursor();
      return;
    }

    const mode = parseAutoMemoryMode(room.row.auto_memory);
    if (mode === "off") {
      advanceCursor();
      return;
    }

    try {
      const cursor = Number(agent.row.auto_mem_cursor_ts ?? 0);
      // Inclusive of the user turn that started this run (it is stored before
      // runStartedAt). First extract uses a short lookback instead of all history.
      const since =
        cursor > 0
          ? cursor
          : Math.max(0, (agent.runStartedAt ?? now) - 5 * 60 * 1000);
      const messages = db
        .getMessages(room.id, 400)
        .filter((m) => m.agentId === agent.row.id && m.ts > since);
      const existing = db.listMemoryEntries(room.id, { includeProposed: true });
      const candidates = extractAutoMemories({
        agentLabel: agent.row.label,
        messages,
        touchedPaths: [...agent.touchedPaths],
        branch: agent.row.branch,
        prUrl: agent.row.pr_url,
        existing: existing.map((e) => ({
          kind: e.kind,
          title: e.title,
          content: e.content,
          status: e.status,
          source: e.source,
        })),
      });
      const saved: MemoryEntryInfo[] = [];
      for (const candidate of candidates) {
        try {
          saved.push(
            createSanitizedMemory({
              roomId: room.id,
              kind: candidate.kind,
              title: candidate.title,
              content: candidate.content,
              status: "active",
              createdByAgentId: agent.row.id,
              sourceMessageId: candidate.sourceMessageId,
              sourcePath: candidate.sourcePath,
              source: "auto",
            }),
          );
        } catch (err) {
          console.warn(
            "[RoomManager] auto-memory persist skipped:",
            err instanceof Error ? err.message : err,
          );
        }
      }
      if (saved.length) {
        for (const entry of saved) this.broadcastMemoryUpdated(room.id, entry);
        this.io.to(room.id).emit("auto-memory-saved", {
          agentId: agent.row.id,
          count: saved.length,
          entries: saved,
        });
        this.broadcastRoomContext(room.id);
      }
    } catch (err) {
      console.warn(
        "[RoomManager] auto-memory extract failed:",
        err instanceof Error ? err.message : err,
      );
    } finally {
      advanceCursor();
      agent.runStartedAt = null;
    }
  }

  // -----------------------------------------------------------------------
  // Driver control — per agent
  // -----------------------------------------------------------------------

  handleRequestDrive(socket: Socket, agentId?: string): void {
    const room = this.getRoomForSocket(socket.id);
    if (!room) return;
    const p = room.participants.get(socket.id);
    if (!p) return;

    const role = p.userId
      ? this.resolveUserRoomRole(room.id, p.userId)
      : null;
    if (!canRequestDrive(role)) {
      socket.emit("error", "Viewers cannot request control");
      return;
    }

    if (agentId) {
      const agent = room.agents.get(agentId);
      if (!agent) return;

      if (!agent.driverSocketId || agent.driverSocketId === socket.id) {
        agent.driverSocketId = socket.id;
        if (p.userId) db.setAgentDriver(agentId, p.userId);
        this.broadcastPresence(room);
        socket.emit("drive-granted", agentId);
        return;
      }

      agent.pendingDriveRequest = { socketId: socket.id, name: p.name };
      const driverSocket = this.io.sockets.sockets.get(agent.driverSocketId);
      if (driverSocket) {
        driverSocket.emit("drive-requested", {
          socketId: socket.id,
          name: p.name,
          agentId,
        });
      }
      socket.emit("drive-request-pending", { agentId });
      notifyEvent({
        kind: "drive_requested",
        title: "Drive requested",
        text: `${p.name} wants control of ${agent.row.label} in “${room.row.name}”`,
        roomId: room.id,
        actorUserId: p.userId,
        meta: { agentId, agentLabel: agent.row.label },
      });
      return;
    }

    // Room-level fallback (single-agent compat)
    if (!room.driverSocketId || room.driverSocketId === socket.id) {
      room.driverSocketId = socket.id;
      this.broadcastPresence(room);
      socket.emit("drive-granted");
      return;
    }

    room.pendingDriveRequest = { socketId: socket.id, name: p.name };
    const driverSocket = this.io.sockets.sockets.get(room.driverSocketId);
    if (driverSocket) {
      driverSocket.emit("drive-requested", {
        socketId: socket.id,
        name: p.name,
      });
    }
    socket.emit("drive-request-pending", {});
    notifyEvent({
      kind: "drive_requested",
      title: "Drive requested",
      text: `${p.name} wants control in “${room.row.name}”`,
      roomId: room.id,
      actorUserId: p.userId,
    });
  }

  handleGrantDrive(
    socket: Socket,
    agentIdOrToSocketId: string,
    toSocketId?: string,
  ): void {
    const room = this.getRoomForSocket(socket.id);
    if (!room) return;
    const actor = room.participants.get(socket.id);
    const isOwner = Boolean(
      actor?.userId && room.row.owner_id === actor.userId,
    );

    if (toSocketId !== undefined) {
      // Per-agent: agentIdOrToSocketId is agentId
      const agentId = agentIdOrToSocketId;
      const agent = room.agents.get(agentId);
      if (!agent) return;

      if (!isOwner && socket.id !== agent.driverSocketId) return;
      if (!room.participants.has(toSocketId)) return;

      agent.driverSocketId = toSocketId;
      agent.pendingDriveRequest = null;
      const participant = room.participants.get(toSocketId);
      if (participant?.userId) db.setAgentDriver(agentId, participant.userId);
      this.broadcastPresence(room);
      this.io.sockets.sockets.get(toSocketId)?.emit("drive-granted", agentId);
      return;
    }

    // Room-level fallback
    const targetSocketId = agentIdOrToSocketId;
    if (!isOwner && socket.id !== room.driverSocketId) return;
    if (!room.participants.has(targetSocketId)) return;

    room.driverSocketId = targetSocketId;
    room.pendingDriveRequest = null;
    this.broadcastPresence(room);
    this.io.sockets.sockets.get(targetSocketId)?.emit("drive-granted");
  }

  handleReleaseDrive(socket: Socket, agentId?: string): void {
    const room = this.getRoomForSocket(socket.id);
    if (!room) return;

    if (agentId) {
      const agent = room.agents.get(agentId);
      if (!agent) return;
      if (socket.id !== agent.driverSocketId) return;

      db.clearAgentDriver(agentId);

      if (
        agent.pendingDriveRequest &&
        room.participants.has(agent.pendingDriveRequest.socketId)
      ) {
        agent.driverSocketId = agent.pendingDriveRequest.socketId;
        const nextP = room.participants.get(agent.driverSocketId!);
        if (nextP?.userId) db.setAgentDriver(agentId, nextP.userId);
        this.io.sockets.sockets
          .get(agent.driverSocketId!)
          ?.emit("drive-granted", agentId);
        agent.pendingDriveRequest = null;
      } else {
        agent.driverSocketId = null;
      }

      this.broadcastPresence(room);
      this.io.to(room.id).emit("drive-released", agentId);
      return;
    }

    // Room-level fallback
    if (socket.id !== room.driverSocketId) return;

    if (
      room.pendingDriveRequest &&
      room.participants.has(room.pendingDriveRequest.socketId)
    ) {
      room.driverSocketId = room.pendingDriveRequest.socketId;
      this.io.sockets.sockets
        .get(room.driverSocketId)
        ?.emit("drive-granted");
      room.pendingDriveRequest = null;
    } else {
      room.driverSocketId = null;
      for (const [sid] of room.participants) {
        if (sid !== socket.id) {
          room.driverSocketId = sid;
          break;
        }
      }
    }

    this.broadcastPresence(room);
    this.io.to(room.id).emit("drive-released");
  }

  // -----------------------------------------------------------------------
  // Tool approval decisions
  // -----------------------------------------------------------------------

  /**
   * Any editor (or the host) who is not currently driving the agent may
   * approve/deny a pending tool call. The host can always decide, even
   * while driving; a plain editor driving the agent cannot self-approve.
   */
  handleToolApprovalDecision(
    socket: Socket,
    requestId: string,
    approved: boolean,
  ): void {
    const room = this.getRoomForSocket(socket.id);
    if (!room) return;

    const approvalRow = db.getApprovalRequest(requestId);
    if (!approvalRow || approvalRow.room_id !== room.id) {
      socket.emit("error", "Approval request not found");
      return;
    }
    if (approvalRow.status !== "pending") {
      socket.emit("error", "This approval has already been decided");
      return;
    }

    const p = room.participants.get(socket.id);
    if (!p?.userId) {
      socket.emit("error", "Sign in required to decide approvals");
      return;
    }

    const role = this.resolveUserRoomRole(room.id, p.userId);
    if (role !== "owner" && role !== "editor") {
      socket.emit("error", "Only editors or the host can decide approvals");
      return;
    }

    const agent = room.agents.get(approvalRow.agent_id);
    const isDriver = Boolean(
      agent &&
        (agent.driverSocketId === socket.id ||
          (room.agents.size <= 1 && room.driverSocketId === socket.id)),
    );
    if (role !== "owner" && isDriver) {
      socket.emit(
        "error",
        "You are driving this agent — ask another editor or the host to decide",
      );
      return;
    }

    const decidedByName = p.name || "Someone";
    const resolved = db.resolveApprovalRequest(
      requestId,
      approved ? "approved" : "denied",
      p.userId,
      decidedByName,
    );
    if (!resolved) return;

    const info = this.approvalRowToInfo(resolved);
    this.io.to(room.id).emit("tool-approval-resolved", info);

    const sysMsg: ChatMessage = {
      id: nanoid(12),
      roomId: room.id,
      role: "system",
      content: `${approved ? "Approved" : "Denied"} by ${decidedByName}.`,
      status: "done",
      ts: Date.now(),
      agentId: approvalRow.agent_id,
      approval: info,
    };
    db.insertMessage(sysMsg);
    this.io.to(room.id).emit("chat-message", sysMsg);

    if (!agent || !approved) return;
    if (agent.workerRunActive || agent.backend.isBusy()) return;

    const key = approvalActionKey(
      approvalRow.tool_name,
      approvalRow.detail,
      approvalRow.path || undefined,
    );
    agent.preApprovedActions.add(key);

    const resumePrompt = `Your proposed action was approved by ${decidedByName}. Proceed with it now:\n\nTool: ${approvalRow.tool_name}\n${approvalRow.detail}\n${approvalRow.path ? `Path: ${approvalRow.path}` : ""}\n\nDo not ask for approval again for this exact action.`;
    void this.runAgent(room, agent, resumePrompt);
  }

  // -----------------------------------------------------------------------
  // Review pings (Slack + in-room interrupt)
  // -----------------------------------------------------------------------

  handleFlagReview(
    socket: Socket,
    payload: { note?: string; targetUserIds?: string[] },
  ): void {
    const room = this.getRoomForSocket(socket.id);
    if (!room) return;

    const p = room.participants.get(socket.id);
    if (!p?.userId) {
      socket.emit("error", "Sign in required to flag for review");
      return;
    }

    const role = this.resolveUserRoomRole(room.id, p.userId);
    if (role !== "owner" && role !== "editor") {
      socket.emit("error", "Only editors or the host can flag for review");
      return;
    }

    const note = String(payload?.note || "").trim().slice(0, 2000);
    const rawTargets = Array.isArray(payload?.targetUserIds)
      ? payload.targetUserIds
          .filter((id): id is string => typeof id === "string" && id.trim().length > 0)
          .map((id) => id.trim())
      : [];

    let targets: "everyone" | string[] = "everyone";
    if (rawTargets.length > 0) {
      const members = db.getRoomMembers(room.id);
      const memberIds = new Set(members.map((m) => m.user_id));
      const filtered = [...new Set(rawTargets)].filter((id) => memberIds.has(id));
      if (filtered.length === 0) {
        socket.emit("error", "No valid target members selected");
        return;
      }
      targets = filtered;
    }

    const pingRow = db.createRoomPing({
      roomId: room.id,
      actorUserId: p.userId,
      actorName: p.name || "Someone",
      note,
      targets,
    });
    const info = this.pingRowToInfo(pingRow);

    this.io.to(room.id).emit("review-flagged", info);
    this.io.to(room.id).emit(
      "room-pings",
      db.listOpenRoomPings(room.id).map((r) => this.pingRowToInfo(r)),
    );

    const sysMsg: ChatMessage = {
      id: nanoid(12),
      roomId: room.id,
      role: "system",
      content: note
        ? `${p.name} flagged for review: ${note}`
        : `${p.name} flagged this session for review.`,
      status: "done",
      ts: Date.now(),
    };
    db.insertMessage(sysMsg);
    this.io.to(room.id).emit("chat-message", sysMsg);

    const joinUrl = `${APP_ORIGIN.replace(/\/$/, "")}/room/${room.id}?ping=${info.id}`;
    const targetSummary =
      targets === "everyone"
        ? "everyone"
        : `${targets.length} member${targets.length === 1 ? "" : "s"}`;
    notifyReviewFlag({
      webhookUrl: this.decryptRoomSlackWebhook(room.row),
      roomId: room.id,
      roomName: room.row.name,
      actorName: p.name || "Someone",
      note: note || undefined,
      pingId: info.id,
      joinUrl,
      targetSummary,
    });
  }

  handleAckReview(socket: Socket, pingId: string): void {
    const room = this.getRoomForSocket(socket.id);
    if (!room) return;
    const p = room.participants.get(socket.id);
    if (!p?.userId) {
      socket.emit("error", "Sign in required to acknowledge");
      return;
    }
    try {
      this.ackPing(room.id, pingId, p.userId, p.name || "Someone");
    } catch (err) {
      socket.emit(
        "error",
        err instanceof Error ? err.message : "Failed to acknowledge ping",
      );
    }
  }

  handleDismissReview(socket: Socket, pingId: string): void {
    const room = this.getRoomForSocket(socket.id);
    if (!room) return;
    const p = room.participants.get(socket.id);
    if (!p?.userId) {
      socket.emit("error", "Sign in required to dismiss");
      return;
    }

    const ping = db.getRoomPing(pingId);
    if (!ping || ping.room_id !== room.id) {
      socket.emit("error", "Review ping not found");
      return;
    }
    if (ping.status !== "open") return;

    const role = this.resolveUserRoomRole(room.id, p.userId);
    const isActor = ping.actor_user_id === p.userId;
    if (!isActor && role !== "owner" && !this.userCanManageRoom(room.id, p.userId)) {
      socket.emit("error", "Only the flagger or host can dismiss this ping");
      return;
    }

    const dismissed = db.dismissRoomPing(pingId);
    if (!dismissed) return;
    const info = this.pingRowToInfo(dismissed);
    this.io.to(room.id).emit("review-dismissed", info);
    this.io.to(room.id).emit(
      "room-pings",
      db.listOpenRoomPings(room.id).map((r) => this.pingRowToInfo(r)),
    );
  }

  /** REST + socket shared ack path. Returns updated ping or null if already acked. */
  ackPing(
    roomId: string,
    pingId: string,
    userId: string,
    userName: string,
  ): PingInfo | null {
    const ping = db.getRoomPing(pingId);
    if (!ping || ping.room_id !== roomId) {
      throw new Error("Review ping not found");
    }
    if (ping.status !== "open") {
      throw new Error("This review ping is no longer open");
    }

    const targets = this.parsePingTargets(ping.targets);
    if (targets !== "everyone" && !targets.includes(userId)) {
      // Actors / hosts may still ack so the Slack deep link works for them.
      const role = this.resolveUserRoomRole(roomId, userId);
      if (ping.actor_user_id !== userId && role !== "owner") {
        throw new Error("You are not a target of this review ping");
      }
    }

    const inserted = db.ackRoomPing(pingId, userId, userName);
    const fresh = db.getRoomPing(pingId);
    if (!fresh) return null;
    const info = this.pingRowToInfo(fresh);
    if (!inserted) return info;

    const room = this.rooms.get(roomId);
    if (room) {
      this.io.to(roomId).emit("review-acked", info);
    }
    return info;
  }

  setRoomSlackWebhook(
    roomId: string,
    webhookUrl: string,
    actorUserId: string,
  ): RoomInfo {
    if (!this.userCanManageRoom(roomId, actorUserId)) {
      throw new Error("Only the host can connect Slack");
    }
    if (!encryptionConfigured()) {
      throw new Error("KEY_ENCRYPTION_SECRET is required to store Slack webhooks");
    }
    const url = webhookUrl.trim();
    if (!/^https:\/\/hooks\.slack\.com\/services\//i.test(url)) {
      throw new Error(
        "Webhook URL must be a Slack incoming webhook (hooks.slack.com/services/...)",
      );
    }
    const ciphertext = encryptApiKey(url);
    const hint = maskApiKey(url);
    db.setRoomSlackWebhook(roomId, ciphertext, hint);
    const row = db.getRoom(roomId);
    if (!row) throw new Error("Room not found");
    const live = this.rooms.get(roomId);
    if (live) {
      live.row.slack_webhook_ciphertext = ciphertext;
      live.row.slack_webhook_hint = hint;
    }
    return this.toRoomInfo(row, live?.participants.size ?? 0, actorUserId);
  }

  clearRoomSlackWebhook(roomId: string, actorUserId: string): RoomInfo {
    if (!this.userCanManageRoom(roomId, actorUserId)) {
      throw new Error("Only the host can disconnect Slack");
    }
    db.clearRoomSlackWebhook(roomId);
    const row = db.getRoom(roomId);
    if (!row) throw new Error("Room not found");
    const live = this.rooms.get(roomId);
    if (live) {
      live.row.slack_webhook_ciphertext = null;
      live.row.slack_webhook_hint = null;
    }
    return this.toRoomInfo(row, live?.participants.size ?? 0, actorUserId);
  }

  getSlackWebhookStatus(
    roomId: string,
    actorUserId: string,
  ): { configured: boolean; hint: string | null; envFallback: boolean } {
    if (!this.userCanAccessRoom(roomId, actorUserId)) {
      throw new Error("Room not found");
    }
    const row = db.getRoom(roomId);
    if (!row) throw new Error("Room not found");
    const canManage = this.userCanManageRoom(roomId, actorUserId);
    return {
      configured: Boolean(row.slack_webhook_ciphertext),
      hint: canManage ? row.slack_webhook_hint || null : null,
      envFallback: envSlackWebhookConfigured(),
    };
  }

  /** Posts a test message to the room webhook (or env fallback). */
  async testRoomSlackWebhook(
    roomId: string,
    actorUserId: string,
  ): Promise<{ ok: true; used: "room" | "env" }> {
    if (!this.userCanManageRoom(roomId, actorUserId)) {
      throw new Error("Only the host can test Slack");
    }
    const row = db.getRoom(roomId);
    if (!row) throw new Error("Room not found");
    const roomUrl = this.decryptRoomSlackWebhook(row);
    const envUrl = process.env.SLACK_WEBHOOK_URL?.trim() || "";
    const webhookUrl = roomUrl || envUrl;
    if (!webhookUrl) {
      throw new Error("Connect a Slack webhook first (or set SLACK_WEBHOOK_URL)");
    }
    await sendSlackTestMessage({
      webhookUrl,
      roomName: row.name,
    });
    return { ok: true, used: roomUrl ? "room" : "env" };
  }

  // -----------------------------------------------------------------------
  // addAgent / stopAgent
  // -----------------------------------------------------------------------

  addAgent(
    roomId: string,
    opts: {
      backend?: AgentBackendKind;
      label: string;
      scopePath?: string;
      modelId?: string;
      /** Optional Anthropic API key (Claude Code cloud BYOK). Saved to the user account when provided. */
      anthropicApiKey?: string;
      /** Optional Cursor API key (BYOK). Reuses / saves the user's Cursor key from previous sessions. */
      apiKey?: string;
      /** Start this agent in read-only plan mode. */
      planMode?: boolean;
      /** First run receives the repo map + accepted room memory (default true). */
      seedContext?: boolean;
      /** Hidden merge agent used by Integrate. */
      kind?: "feature" | "integrator";
      /** Pin this agent to an existing git branch (Integrator). */
      branch?: string;
    },
    actorUserId: string,
  ): AgentInfo {
    const room = this.rooms.get(roomId);
    const row = db.getRoom(roomId);
    if (!room || !row || row.status !== "active") {
      throw new Error("Room not found");
    }
    this.assertCanManage(roomId, actorUserId);

    const backendKind: AgentBackendKind =
      opts.backend === "claude-code" ? "claude-code" : "cursor";
    const asIntegrator = opts.kind === "integrator";
    const useClaudeSandbox =
      backendKind === "claude-code" &&
      Boolean(row.repo_url?.trim()) &&
      (row.runtime === "cloud" ||
        (asIntegrator && isClaudeSandboxConfigured()));

    let anthropicApiKey = "";
    if (backendKind === "claude-code") {
      if (useClaudeSandbox) {
        if (!isClaudeSandboxConfigured()) {
          throw new Error(
            "Claude Code cloud agents require E2B_API_KEY on the server",
          );
        }
        if (!row.repo_url?.trim()) {
          throw new Error("Cloud Claude Code requires a GitHub repo URL");
        }
        const pasted = opts.anthropicApiKey?.trim() || "";
        if (pasted) {
          if (!encryptionConfigured()) {
            throw new Error(
              "KEY_ENCRYPTION_SECRET is required to store an Anthropic API key",
            );
          }
          setUserAnthropicByokKey(actorUserId, pasted);
          anthropicApiKey = pasted;
        } else {
          anthropicApiKey = resolveAnthropicApiKey(
            actorUserId,
            null,
            row.org_id,
          );
        }
        if (!anthropicApiKey) {
          throw new Error(
            row.org_id
              ? "Set a shared Anthropic key in Team settings, paste your key, or set ANTHROPIC_API_KEY on the server"
              : "Paste your Anthropic API key for Claude Code (or set ANTHROPIC_API_KEY on the server)",
          );
        }
      } else if (row.auth_mode !== "cli") {
        throw new Error(
          "Claude Code on local runtime requires CLI auth (run `steer start`)",
        );
      }
    }

    let cursorApiKey = "";
    if (backendKind === "cursor" && row.auth_mode !== "cli") {
      const pasted = opts.apiKey?.trim() || "";
      if (pasted) {
        if (!encryptionConfigured()) {
          throw new Error(
            "KEY_ENCRYPTION_SECRET is required to store a Cursor API key",
          );
        }
        setUserByokKey(actorUserId, pasted);
        attachRoomCursorByok(row, pasted);
        cursorApiKey = pasted;
      } else {
        try {
          cursorApiKey = resolveApiKey(row, actorUserId);
        } catch {
          cursorApiKey = "";
        }
        if (!cursorApiKey) {
          throw new Error(
            "Paste your Cursor API key to add a Cursor agent (or reuse the key saved from a previous session)",
          );
        }
        // Claude-created rooms have no Cursor key yet — persist the owner's
        // saved BYOK so reloads and model listing keep working.
        if (
          !row.key_ciphertext &&
          getUserByokKey(actorUserId) === cursorApiKey
        ) {
          attachRoomCursorByok(row, cursorApiKey);
        }
      }
    }

    if (opts.scopePath) {
      const scopeCheck = this.validateAgentScope(roomId, opts.scopePath);
      if (!scopeCheck.ok) throw new Error(scopeCheck.error);
    }

    const modelId =
      opts.modelId ||
      row.model_id ||
      (backendKind === "claude-code"
        ? DEFAULT_CLAUDE_MODEL
        : row.auth_mode === "cli"
          ? "auto"
          : DEFAULT_MODEL);

    const agentRow = db.createAgent({
      roomId,
      backend: backendKind,
      label: opts.label,
      scopePath: opts.scopePath || null,
      modelId,
      createdBy: actorUserId,
      planMode: Boolean(opts.planMode),
      kind: asIntegrator ? "integrator" : "feature",
      branch: opts.branch?.trim() || null,
      sortOrder: asIntegrator ? 1000 : undefined,
    });

    const cwd = row.runtime === "local"
      ? resolveAgentCwd(row.repo_path, agentRow.scope_path)
      : "";

    let backend: AgentBackend;
    if (useClaudeSandbox) {
      backend = this.createClaudeSandboxBackend(row, agentRow, anthropicApiKey);
    } else if (row.auth_mode === "cli" || backendKind === "claude-code") {
      backend = new AgentRunner(cwd, null, modelId, backendKind);
    } else {
      const apiKey = cursorApiKey || resolveApiKey(row, actorUserId);
      backend = new SdkAgentSession({
        runtime: row.runtime === "cloud" ? "cloud" : "local",
        apiKey,
        model: { id: modelId },
        name: row.name,
        localCwd: row.runtime === "local" ? cwd : undefined,
        repoUrl: row.repo_url || undefined,
        startingRef: row.starting_ref || undefined,
        autoCreatePR: Boolean(row.auto_create_pr) || asIntegrator,
        mode: agentRow.plan_mode ? "plan" : "agent",
      });
    }

    let diffWatcher: DiffWatcher | null = null;
    let ownsDiffWatcher = false;
    const canWatchLocally =
      row.runtime === "local" &&
      row.auth_mode !== "cli" &&
      Boolean(cwd) &&
      existsSync(cwd);

    if (canWatchLocally) {
      const poolResult = acquireDiffWatcher(
        cwd,
        roomId,
        agentRow.id,
        (patch) => {
          this.io.to(roomId).emit("diff-update", patch, agentRow.id);
        },
      );
      diffWatcher = poolResult.watcher;
      ownsDiffWatcher = poolResult.isOwner;
      room.cleanups.push(poolResult.unsub);
    }

    const agentState: AgentState = {
      row: agentRow,
      backend,
      cwd,
      diffWatcher,
      ownsDiffWatcher,
      toolMsgIds: new Map(),
      toolPaths: new Map(),
      lastToolMsgId: null,
      todoMsgId: null,
      workerRunActive: false,
      workerRunCleanups: [],
      driverSocketId: null,
      pendingDriveRequest: null,
      filePatches: new Map(),
      touchedPaths: new Set(),
      runGeneration: 0,
      preApprovedActions: new Set(),
      lastSteeredBy: null,
      seedContext: opts.seedContext !== false,
      runStartedAt: null,
    };

    room.agents.set(agentRow.id, agentState);
    this.applyBackendMode(agentState);
    this.broadcastAgents(room);
    this.broadcastConflicts(room);

    return this.toAgentInfo(agentRow);
  }

  async stopAgent(
    roomId: string,
    agentId: string,
    actorUserId?: string,
  ): Promise<void> {
    const room = this.rooms.get(roomId);
    const row = db.getRoom(roomId);
    if (!room || !row || row.status !== "active") {
      throw new Error("Room not found");
    }
    this.assertCanManage(roomId, actorUserId);

    const agent = room.agents.get(agentId);
    if (!agent) throw new Error("Agent not found");

    // Abort running work
    agent.runGeneration += 1;
    if (agent.workerRunActive) {
      this.workerRelay?.detachRun(roomId, agentId);
      for (const c of agent.workerRunCleanups) c();
      agent.workerRunCleanups = [];
    }
    this.finalizeStreamingMessages(room, agentId);
    await agent.backend.abortAndWait();
    agent.workerRunActive = false;

    await agent.backend.dispose();

    db.updateAgentStatus(agentId, "stopped");
    agent.row.status = "stopped";

    this.fileLocks.releaseAllForAgent(roomId, agentId);

    this.emitAgentStatus(room, agentId, "idle");
    this.broadcastAgents(room);
    this.broadcastConflicts(room);
  }

  // -----------------------------------------------------------------------
  // finalizeStreamingMessages — close open assistant/tool bubbles on abort
  // -----------------------------------------------------------------------

  private finalizeStreamingMessages(
    room: RoomState,
    agentId: string,
  ): void {
    const messages = db.getMessages(room.id, 200);
    for (const msg of messages) {
      if (msg.agentId !== agentId) continue;
      if (msg.status !== "streaming") continue;

      const content =
        msg.role === "tool" &&
        (!msg.content || msg.content === "Running…")
          ? "Aborted"
          : msg.content;

      db.updateMessageContent(msg.id, content, "done");
      if (msg.role === "assistant") {
        this.io
          .to(room.id)
          .emit("chat-delta", msg.id, content, "done");
      } else {
        this.io.to(room.id).emit("chat-message", {
          ...msg,
          content,
          status: "done",
        });
      }
    }

    const agent = room.agents.get(agentId);
    if (agent) {
      agent.toolMsgIds.clear();
      agent.toolPaths.clear();
      agent.lastToolMsgId = null;
      agent.todoMsgId = null;
    }
  }

  // -----------------------------------------------------------------------
  // abortRun — per agent (compat: default agent if no agentId)
  // -----------------------------------------------------------------------

  async abortRun(
    id: string,
    agentId?: string,
    actorUserId?: string,
  ): Promise<void> {
    const row = db.getRoom(id);
    if (!row || row.status !== "active") {
      throw new Error("Room not found");
    }
    if (actorUserId && !this.userCanAccessRoom(id, actorUserId)) {
      throw new Error("Not allowed");
    }

    const room = this.rooms.get(id);
    if (!room) {
      throw new Error("Room is not loaded — reconnect and try again");
    }

    const resolvedAgentId = agentId || this.getDefaultAgent(room).row.id;
    const agent = room.agents.get(resolvedAgentId);
    if (!agent) throw new Error("Agent not found");

    if (actorUserId) {
      const role = this.resolveUserRoomRole(id, actorUserId);
      const isDriving = [...room.participants.entries()].some(
        ([sid, p]) =>
          p.userId === actorUserId &&
          (agent.driverSocketId === sid ||
            (room.agents.size <= 1 && room.driverSocketId === sid)),
      );
      if (
        !canAbortWithRole({
          role,
          controlMode: this.getControlMode(row),
          isDrivingAgent: isDriving,
        })
      ) {
        throw new Error(
          steerDeniedReason({
            role,
            controlMode: this.getControlMode(row),
            isDrivingAgent: isDriving,
          }) || "Not allowed to abort this agent",
        );
      }
    }

    const wasBusy = agent.workerRunActive || agent.backend.isBusy();
    if (!wasBusy) return;

    // Invalidate in-flight runAgent / worker handlers before teardown.
    agent.runGeneration += 1;

    if (agent.workerRunActive) {
      this.workerRelay?.abortRun(id, resolvedAgentId);
      for (const c of agent.workerRunCleanups) c();
      agent.workerRunCleanups = [];
      this.workerRelay?.releaseRun(id, resolvedAgentId);
      this.workerRelay?.clearRunListeners(id, resolvedAgentId);
    }

    this.finalizeStreamingMessages(room, resolvedAgentId);

    // Await SDK cancel / CLI process exit before marking idle.
    await agent.backend.abortAndWait();

    agent.workerRunActive = false;
    this.fileLocks.releaseAllForAgent(id, resolvedAgentId);

    const note: ChatMessage = {
      id: nanoid(12),
      roomId: room.id,
      role: "assistant",
      content: "Run aborted.",
      status: "done",
      ts: Date.now(),
      agentId: resolvedAgentId,
    };
    db.insertMessage(note);
    this.io.to(room.id).emit("chat-message", note);
    this.emitAgentStatus(room, resolvedAgentId, "idle");
    this.notifyRunFinished(room, agent, "aborted");
    db.updateRoomActivity(room.id);
  }

  // -----------------------------------------------------------------------
  // setModel / setCursorSession — per agent (compat: default if omitted)
  // -----------------------------------------------------------------------

  setModel(
    id: string,
    modelIdRaw: string,
    actorUserId?: string,
    agentId?: string,
  ): RoomInfo {
    const modelId = modelIdRaw.trim();
    if (!modelId) throw new Error("modelId is required");

    const room = this.rooms.get(id);
    const row = db.getRoom(id);
    if (!row || row.status !== "active") throw new Error("Room not found");

    this.assertCanManage(id, actorUserId);

    const resolvedAgentId = agentId
      ? agentId
      : room
        ? this.getDefaultAgent(room).row.id
        : undefined;

    if (room && resolvedAgentId) {
      const agent = room.agents.get(resolvedAgentId);
      if (agent) {
        if (agent.workerRunActive || agent.backend.isBusy()) {
          throw new Error(
            "Wait for the agent to finish before changing model",
          );
        }
        db.setAgentModel(agent.row.id, modelId);
        agent.row.model_id = modelId;
        agent.backend.setModel(modelId);
      }

      const defaultAgent = this.getDefaultAgent(room);
      if (resolvedAgentId === defaultAgent.row.id) {
        db.setModelId(id, modelId);
        row.model_id = modelId;
        room.row.model_id = modelId;
      }
    } else if (!agentId) {
      db.setModelId(id, modelId);
      row.model_id = modelId;
      if (room) room.row.model_id = modelId;
    }

    if (room) {
      this.io.to(id).emit("model-updated", modelId, resolvedAgentId);
      this.broadcastAgents(room);
    }

    return this.toRoomInfo(row, room?.participants.size || 0);
  }

  setCursorSession(
    id: string,
    sessionIdRaw: string | null | undefined,
    actorUserId?: string,
    agentId?: string,
  ): RoomInfo {
    const room = this.rooms.get(id);
    const row = db.getRoom(id);
    if (!row || row.status !== "active") throw new Error("Room not found");

    this.assertCanManage(id, actorUserId);

    const next = sessionIdRaw?.trim() || null;

    if (room) {
      const resolvedAgentId = agentId || this.getDefaultAgent(room).row.id;
      const agent = room.agents.get(resolvedAgentId);

      if (agent) {
        if (agent.workerRunActive || agent.backend.isBusy()) {
          throw new Error(
            "Wait for the agent to finish before switching chats",
          );
        }
        this.persistAgentSession(room, agent, next);
        if (
          agent.backend instanceof AgentRunner ||
          agent.backend instanceof ClaudeSandboxSession
        ) {
          agent.backend.setSessionId(next);
        }
      }
    } else {
      if (next) db.setCursorSessionId(id, next);
      else db.setCursorSessionId(id, "");
      row.cursor_session_id = next;
      this.io.to(id).emit("cursor-session-updated", next);
    }

    return this.toRoomInfo(row, room?.participants.size || 0);
  }

  // -----------------------------------------------------------------------
  // stopRoom
  // -----------------------------------------------------------------------

  stopRoom(id: string, actorUserId?: string): void {
    const row = db.getRoom(id);
    if (!row) return;
    this.assertCanManage(id, actorUserId);
    const room = this.rooms.get(id);
    if (room) {
      // Stop all agents
      for (const [agentId, agent] of room.agents) {
        for (const c of agent.workerRunCleanups) c();
        agent.workerRunCleanups = [];
        agent.workerRunActive = false;
        this.workerRelay?.detachRun(id, agentId);
        void agent.backend.dispose();
      }

      for (const unsub of room.cleanups) unsub();

      for (const [sid] of [...room.participants.entries()]) {
        const s = this.io.sockets.sockets.get(sid);
        this.socketRooms.delete(sid);
        if (s) {
          s.emit("kicked", "Session stopped by the host");
          s.leave(id);
          s.disconnect(true);
        }
      }
      room.participants.clear();
      room.agents.clear();
      this.rooms.delete(id);
    } else {
      this.workerRelay?.detachRoom(id);
    }
    db.updateRoomStatus(id, "stopped");
  }

  // -----------------------------------------------------------------------
  // setAgentCursorSession (alias for HTTP layer)
  // -----------------------------------------------------------------------

  setAgentCursorSession(
    roomId: string,
    sessionId: string | null | undefined,
    actorUserId?: string,
    agentId?: string,
  ): RoomInfo {
    return this.setCursorSession(roomId, sessionId, actorUserId, agentId);
  }

  // -----------------------------------------------------------------------
  // Room query methods
  // -----------------------------------------------------------------------

  listRooms(): RoomInfo[] {
    return db.listRooms().map((row) => {
      const room = this.rooms.get(row.id);
      return this.toRoomInfo(row, room?.participants.size || 0);
    });
  }

  listRoomsForUser(userId: string): RoomInfo[] {
    return db.listRoomsByUser(userId).map((row) => {
      const room = this.rooms.get(row.id);
      return this.toRoomInfo(row, room?.participants.size || 0);
    });
  }

  listPersonalRoomsForUser(userId: string): RoomInfo[] {
    return db.listPersonalRoomsByUser(userId).map((row) => {
      const room = this.rooms.get(row.id);
      return this.toRoomInfo(row, room?.participants.size || 0);
    });
  }

  listRoomsForOrg(orgId: string): RoomInfo[] {
    return db.listRoomsByOrg(orgId).map((row) => {
      const room = this.rooms.get(row.id);
      return this.toRoomInfo(row, room?.participants.size || 0);
    });
  }

  userCanAccessRoom(roomId: string, userId: string): boolean {
    const row = db.getRoom(roomId);
    if (!row) return false;
    if (row.owner_id === userId) return true;
    if (db.isRoomMember(roomId, userId)) return true;
    if (row.org_id && db.isOrganizationMember(row.org_id, userId)) return true;
    return false;
  }

  getControlMode(row: db.RoomRow): ControlMode {
    return parseControlMode(row.control_mode, "open");
  }

  /**
   * Resolve the caller's collaboration role for a room.
   * Owner always wins; explicit room membership is next; org members default to editor.
   */
  resolveUserRoomRole(roomId: string, userId: string): RoomRole | null {
    const row = db.getRoom(roomId);
    if (!row) return null;
    if (row.owner_id === userId) return "owner";
    const memberRole = normalizeRoomRole(db.getRoomMemberRole(roomId, userId));
    if (memberRole === "owner") return "owner";
    if (memberRole) return memberRole;
    if (row.org_id && db.isOrganizationMember(row.org_id, userId)) {
      // Org access without an explicit room seat — collaborative default.
      return "editor";
    }
    return null;
  }

  userCanSteerAgent(
    roomId: string,
    agentId: string,
    userId: string,
    socketId?: string,
  ): boolean {
    const room = this.rooms.get(roomId);
    const row = db.getRoom(roomId);
    if (!room || !row) return false;
    const role = this.resolveUserRoomRole(roomId, userId);
    const agent = room.agents.get(agentId);
    if (!agent) return false;
    let isDriving = false;
    if (socketId) {
      isDriving =
        agent.driverSocketId === socketId ||
        (room.agents.size <= 1 && room.driverSocketId === socketId);
    } else {
      isDriving = [...room.participants.entries()].some(
        ([sid, p]) =>
          p.userId === userId &&
          (agent.driverSocketId === sid ||
            (room.agents.size <= 1 && room.driverSocketId === sid)),
      );
    }
    return canSteerWithRole({
      role,
      controlMode: this.getControlMode(row),
      isDrivingAgent: isDriving,
    });
  }

  setControlMode(
    roomId: string,
    controlModeRaw: string,
    actorUserId: string,
  ): RoomInfo {
    const row = db.getRoom(roomId);
    if (!row || row.status !== "active") {
      throw new Error("Room not found");
    }
    this.assertCanManage(roomId, actorUserId);
    const normalized = String(controlModeRaw || "").trim().toLowerCase();
    if (
      normalized !== "open" &&
      normalized !== "driver" &&
      normalized !== "host"
    ) {
      throw new Error("controlMode must be open, driver, or host");
    }
    const mode = normalized as ControlMode;
    db.setRoomControlMode(roomId, mode);
    row.control_mode = mode;
    const room = this.rooms.get(roomId);
    if (room) {
      room.row.control_mode = mode;
      this.io.to(roomId).emit("control-mode-updated", mode);
    }
    return this.toRoomInfo(
      row,
      room?.participants.size || 0,
      actorUserId,
    );
  }

  setApprovalMode(
    roomId: string,
    approvalModeRaw: string,
    actorUserId: string,
  ): RoomInfo {
    const row = db.getRoom(roomId);
    if (!row || row.status !== "active") {
      throw new Error("Room not found");
    }
    this.assertCanManage(roomId, actorUserId);
    const normalized = String(approvalModeRaw || "").trim().toLowerCase();
    if (
      normalized !== "off" &&
      normalized !== "dangerous" &&
      normalized !== "all"
    ) {
      throw new Error("approvalMode must be off, dangerous, or all");
    }
    const mode = normalized as ApprovalMode;
    db.setRoomApprovalMode(roomId, mode);
    row.approval_mode = mode;
    const room = this.rooms.get(roomId);
    if (room) {
      room.row.approval_mode = mode;
    }
    return this.toRoomInfo(
      row,
      room?.participants.size || 0,
      actorUserId,
    );
  }

  setAutoMemoryMode(
    roomId: string,
    autoMemoryRaw: string,
    actorUserId: string,
  ): RoomInfo {
    const row = db.getRoom(roomId);
    if (!row || row.status !== "active") {
      throw new Error("Room not found");
    }
    this.assertCanManage(roomId, actorUserId);
    const mode = parseAutoMemoryMode(autoMemoryRaw, "extract");
    const normalized = String(autoMemoryRaw || "").trim().toLowerCase();
    if (normalized !== "off" && normalized !== "extract") {
      throw new Error("autoMemory must be off or extract");
    }
    db.setRoomAutoMemory(roomId, mode);
    row.auto_memory = mode;
    const room = this.rooms.get(roomId);
    if (room) {
      room.row.auto_memory = mode;
    }
    return this.toRoomInfo(
      row,
      room?.participants.size || 0,
      actorUserId,
    );
  }

  userCanManageRoom(roomId: string, userId: string): boolean {
    return userCanManageRoomAccess(roomId, userId);
  }

  joinAsMember(
    roomId: string,
    userId: string,
    preferredRole?: RoomInviteRole,
  ): RoomInfo {
    const row = db.getRoom(roomId);
    if (!row || row.status !== "active") {
      throw new Error("Room not found");
    }
    // Org members can open org rooms without a separate invite; still track room membership.
    const isOrgMember =
      Boolean(row.org_id) && db.isOrganizationMember(row.org_id!, userId);
    if (
      row.owner_id !== userId &&
      !db.isRoomMember(roomId, userId) &&
      !isOrgMember
    ) {
      // Personal shared-link joins default to viewer (align with invite defaults).
      // Prefer an explicit role when provided (e.g. invite claim path).
      if (row.org_id) {
        throw new Error("Join this organization to access team sessions");
      }
      const role = parseRoomInviteRole(preferredRole, "viewer");
      db.addRoomMember(roomId, userId, role);
      this.broadcastMembers(roomId);
    } else if (
      isOrgMember &&
      row.owner_id !== userId &&
      !db.isRoomMember(roomId, userId)
    ) {
      // Trusted org members get editor so team sessions stay collaborative.
      db.addRoomMember(roomId, userId, "editor");
      this.broadcastMembers(roomId);
    }
    return this.toRoomInfo(
      row,
      this.rooms.get(roomId)?.participants.size || 0,
      userId,
    );
  }

  listMembers(roomId: string): RoomMemberInfo[] {
    const row = db.getRoom(roomId);
    if (!row) return [];
    const room = this.rooms.get(roomId);
    const onlineByUser = new Map<string, string[]>();
    if (room) {
      for (const [socketId, p] of room.participants) {
        if (!p.userId) continue;
        const driving = [...room.agents]
          .filter(([, a]) => a.driverSocketId === socketId)
          .map(([id]) => id);
        const prev = onlineByUser.get(p.userId) || [];
        onlineByUser.set(p.userId, [...prev, ...driving]);
      }
    }

    const members: RoomMemberInfo[] = [];
    const seen = new Set<string>();

    if (row.owner_id) {
      const owner = db.getUserById(row.owner_id);
      members.push({
        userId: row.owner_id,
        email: owner?.email || "",
        name: owner?.name || "Host",
        role: "owner",
        online: onlineByUser.has(row.owner_id),
        drivingAgentIds: onlineByUser.get(row.owner_id),
      });
      seen.add(row.owner_id);
    }

    for (const m of db.getRoomMembers(roomId)) {
      if (seen.has(m.user_id)) continue;
      const role = normalizeRoomRole(m.role) || "editor";
      if (role === "owner") continue;
      const user = db.getUserById(m.user_id);
      members.push({
        userId: m.user_id,
        email: user?.email || "",
        name: user?.name || "Member",
        role,
        online: onlineByUser.has(m.user_id),
        drivingAgentIds: onlineByUser.get(m.user_id),
      });
      seen.add(m.user_id);
    }

    return members.sort((a, b) => {
      const rank = (r: RoomRole) =>
        r === "owner" ? 0 : r === "editor" ? 1 : 2;
      if (rank(a.role) !== rank(b.role)) return rank(a.role) - rank(b.role);
      return a.name.localeCompare(b.name);
    });
  }

  broadcastMembers(roomId: string): void {
    this.io.to(roomId).emit("members-updated", this.listMembers(roomId));
  }

  setMemberRole(
    roomId: string,
    targetUserId: string,
    roleRaw: string,
    actorUserId: string,
  ): RoomMemberInfo[] {
    const row = db.getRoom(roomId);
    if (!row || row.status !== "active") {
      throw new Error("Room not found");
    }
    this.assertCanManage(roomId, actorUserId);
    if (targetUserId === row.owner_id) {
      throw new Error("Cannot change the host's role");
    }
    if (targetUserId === actorUserId && row.owner_id === actorUserId) {
      throw new Error("Host cannot demote themselves");
    }
    const roleRawNorm = String(roleRaw || "").toLowerCase();
    if (roleRawNorm !== "editor" && roleRawNorm !== "viewer") {
      throw new Error("role must be editor or viewer");
    }
    const role = roleRawNorm as RoomInviteRole;
    if (!db.isRoomMember(roomId, targetUserId) && targetUserId !== row.owner_id) {
      throw new Error("Member not found");
    }
    db.addRoomMember(roomId, targetUserId, role);
    const members = this.listMembers(roomId);
    this.broadcastMembers(roomId);
    const live = this.rooms.get(roomId);
    if (live) this.broadcastPresence(live);
    const target = members.find((m) => m.userId === targetUserId);
    notifyEvent({
      kind: "member_role_changed",
      title: "Member role updated",
      text: `${target?.name || targetUserId} is now ${role} in “${row.name}”`,
      roomId,
      actorUserId,
      meta: { targetUserId, role },
    });
    return members;
  }

  exportTranscript(roomId: string, actorUserId: string): {
    room: RoomInfo;
    messages: ChatMessage[];
    summary: string;
    exportedAt: number;
  } {
    if (!this.userCanAccessRoom(roomId, actorUserId)) {
      throw new Error("Not allowed");
    }
    const info = this.getRoomInfo(roomId, actorUserId);
    if (!info) throw new Error("Room not found");
    const messages = db.getMessages(roomId, 2000);
    const agents = info.agents || [];
    const agentName = (id?: string) =>
      agents.find((a) => a.id === id)?.label || id || "Agent";

    const lines: string[] = [
      `# ${info.name}`,
      ``,
      `Exported: ${new Date().toISOString()}`,
      `Runtime: ${info.runtime} · Control: ${info.controlMode}`,
      info.orgName ? `Team: ${info.orgName}` : `Personal session`,
      ``,
      `## Summary`,
      `- Agents: ${agents.map((a) => a.label).join(", ") || "none"}`,
      `- Messages: ${messages.length}`,
      `- Status: ${info.status}`,
      ``,
      `## Shared memory`,
      ``,
    ];

    const memory = db.listMemoryEntries(roomId, { includeProposed: true });
    if (memory.length) {
      for (const e of memory) {
        lines.push(
          `- [${e.kind} ${e.status} r${e.current_revision}${e.pinned ? " pinned" : ""}] ${e.title}: ${e.content}`,
        );
      }
    } else {
      lines.push(`_No room memory recorded._`);
    }
    lines.push(``, `## Transcript`, ``);

    for (const m of messages) {
      const when = new Date(m.ts).toISOString();
      const who =
        m.role === "user"
          ? m.senderName || "User"
          : m.role === "tool"
            ? `Tool:${m.toolName || "unknown"}`
            : m.role === "system"
              ? "System"
              : agentName(m.agentId);
      const agent = m.agentId ? ` [${agentName(m.agentId)}]` : "";
      const body = (m.content || "").trim() || (m.diffPatch ? "[diff]" : "");
      if (!body && !m.todos?.length) continue;
      lines.push(`### ${when} — ${who}${agent}`);
      if (body) lines.push(body);
      if (m.todos?.length) {
        for (const t of m.todos) {
          lines.push(`- [${t.status}] ${t.content}`);
        }
      }
      lines.push("");
    }

    return {
      room: info,
      messages,
      summary: lines.join("\n"),
      exportedAt: Date.now(),
    };
  }

  getRoomState(id: string): RoomState | undefined {
    return this.rooms.get(id);
  }

  getRoomInfo(id: string, actorUserId?: string): RoomInfo | null {
    const row = db.getRoom(id);
    if (!row) return null;
    return this.toRoomInfo(
      row,
      this.rooms.get(id)?.participants.size || 0,
      actorUserId,
    );
  }

  async listModelsForRoom(
    id: string,
    agentId?: string,
  ): Promise<ModelInfo[]> {
    const row = db.getRoom(id);
    if (!row) throw new Error("Room not found");

    const agentRow = agentId
      ? db.getAgent(agentId)
      : db.listAgents(id)[0] || null;
    if (agentRow?.backend === "claude-code") {
      return CLAUDE_MODELS;
    }

    // Claude-primary rooms created without a Cursor key still use auth_mode=server.
    // Prefer Claude models when every agent in the room is Claude Code.
    const agents = db.listAgents(id);
    if (
      agents.length > 0 &&
      agents.every((a) => a.backend === "claude-code")
    ) {
      return CLAUDE_MODELS;
    }

    if (row.auth_mode === "cli") {
      const ownerId = row.owner_id;
      const cacheKey = ownerId ? `cli:${ownerId}` : `room:${id}`;
      const cached = db.getModelCache(cacheKey);
      if (cached && Date.now() - cached.updatedAt < 15 * 60_000) {
        return cached.models;
      }

      if (ownerId && this.workerRelay?.hasOnlineWorker(ownerId)) {
        try {
          const models = await this.workerRelay.requestListModels(ownerId);
          if (models.length) db.setModelCache(cacheKey, models);
          return models;
        } catch (err) {
          console.warn(
            `[listModels] worker failed for room ${id}:`,
            err instanceof Error ? err.message : err,
          );
          if (cached?.models.length) return cached.models;
          return [{ id: "auto", displayName: "Auto" }];
        }
      }
      try {
        const models = await listCliModels();
        if (models.length) db.setModelCache(cacheKey, models);
        return models;
      } catch {
        if (cached?.models.length) return cached.models;
        return [{ id: "auto", displayName: "Auto" }];
      }
    }

    // Cursor SDK listing — Claude-only rooms can reuse the owner's saved BYOK.
    try {
      const apiKey = resolveApiKey(row, row.owner_id || undefined);
      return listModelsForKey(apiKey);
    } catch {
      throw new Error(
        "No Cursor API key configured for this room — paste a Cursor BYOK key when adding a Cursor agent, or set CURSOR_API_KEY on the server",
      );
    }
  }

  // -----------------------------------------------------------------------
  // kickUserSockets
  // -----------------------------------------------------------------------

  kickUserSockets(roomId: string, userId: string, reason: string): void {
    const room = this.rooms.get(roomId);
    if (!room) return;

    for (const [sid, p] of [...room.participants.entries()]) {
      if (p.userId !== userId) continue;
      const s = this.io.sockets.sockets.get(sid);
      if (s) {
        s.emit("kicked", reason);
        this.leaveRoom(s);
        s.disconnect(true);
      } else {
        room.participants.delete(sid);
        this.socketRooms.delete(sid);
      }
    }
    this.broadcastPresence(room);
  }

  // -----------------------------------------------------------------------
  // shutdown
  // -----------------------------------------------------------------------

  shutdown(): void {
    for (const [, room] of this.rooms) {
      for (const unsub of room.cleanups) unsub();
      for (const [, agent] of room.agents) {
        void agent.backend.dispose();
      }
    }
    this.rooms.clear();
  }

  // -----------------------------------------------------------------------
  // Presence
  // -----------------------------------------------------------------------

  private broadcastPresence(room: RoomState): void {
    const list: Participant[] = [];
    for (const [socketId, p] of room.participants) {
      const drivingAgentIds = [...room.agents]
        .filter(([, a]) => a.driverSocketId === socketId)
        .map(([id]) => id);

      const isDriver =
        drivingAgentIds.length > 0 ||
        (room.agents.size <= 1 && socketId === room.driverSocketId);

      const role = p.userId
        ? this.resolveUserRoomRole(room.id, p.userId)
        : undefined;

      list.push({
        socketId,
        name: p.name,
        color: p.color,
        userId: p.userId,
        isOwner: Boolean(
          room.row.owner_id && p.userId === room.row.owner_id,
        ),
        role: role ?? undefined,
        isDriver,
        drivingAgentIds:
          drivingAgentIds.length > 0 ? drivingAgentIds : undefined,
      });
    }
    this.io.to(room.id).emit("presence", list);
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private getRoomForSocket(socketId: string): RoomState | undefined {
    const roomId = this.socketRooms.get(socketId);
    if (!roomId) return undefined;
    return this.rooms.get(roomId);
  }

  integrateAgent(
    roomId: string,
    sourceAgentId: string,
    actorUserId: string,
  ): {
    ok: true;
    status: "started" | "queued";
    integratorAgentId: string;
    integrationBranch: string;
    prUrl: string | null;
    queuedBehind?: { agentId: string; label: string };
    job: IntegrationJobInfo;
  } {
    this.assertCanManage(roomId, actorUserId);
    const room = this.rooms.get(roomId);
    const row = db.getRoom(roomId);
    if (!room || !row || row.status !== "active") {
      throw new Error("Room not found");
    }

    const source = room.agents.get(sourceAgentId);
    if (!source || source.row.room_id !== roomId) {
      throw new Error("Agent not found");
    }
    if (isIntegratorAgent(source.row)) {
      throw new Error("Cannot integrate the Integrator itself");
    }
    const sourceBranch = source.row.branch?.trim();
    if (!sourceBranch) {
      throw new Error(
        "This agent has no branch yet. Wait until it pushes work, then Integrate.",
      );
    }
    if (
      source.workerRunActive ||
      source.backend.isBusy() ||
      source.row.status === "running"
    ) {
      throw new Error("Wait for this agent to finish before integrating");
    }
    if (!row.repo_url?.trim()) {
      throw new Error("Integrate needs a GitHub repo URL on this room");
    }

    const integrationBranch =
      row.integration_branch?.trim() ||
      integrationBranchName(row.id, row.name);
    const integrator = this.ensureIntegratorAgent(
      room,
      row,
      source,
      actorUserId,
      integrationBranch,
    );

    if (!row.integration_branch || !row.integration_agent_id) {
      db.setRoomIntegration(roomId, {
        branch: integrationBranch,
        agentId: integrator.row.id,
      });
      row.integration_branch = integrationBranch;
      row.integration_agent_id = integrator.row.id;
      room.row.integration_branch = integrationBranch;
      room.row.integration_agent_id = integrator.row.id;
    }

    const holderRunning = this.isIntegratorBusy(integrator);
    const lockAttempt = tryAcquireIntegrationLock({
      roomId,
      heldBy: newIntegrationJobId(),
      sourceAgentId: source.row.id,
      actorUserId,
      holderStillRunning: holderRunning,
    });

    if (!lockAttempt.ok) {
      const holder = lockAttempt.lock;
      if (holder.source_agent_id === source.row.id) {
        return {
          ok: true,
          status: "started",
          integratorAgentId: integrator.row.id,
          integrationBranch,
          prUrl: row.integration_pr_url || null,
          job: this.integrationJobInfo(room),
        };
      }
      enqueueIntegrationJob({
        roomId,
        sourceAgentId: source.row.id,
        actorUserId,
      });
      const holderAgent = room.agents.get(holder.source_agent_id);
      const queuedMsg: ChatMessage = {
        id: nanoid(12),
        roomId: room.id,
        role: "system",
        content: `Queued ${source.row.label} behind ${holderAgent?.row.label || "another agent"}’s integration.`,
        status: "done",
        ts: Date.now(),
        agentId: integrator.row.id,
      };
      db.insertMessage(queuedMsg);
      this.io.to(room.id).emit("chat-message", queuedMsg);
      this.emitIntegrationUpdated(room, {
        sourceAgentId: source.row.id,
        integratorAgentId: integrator.row.id,
      });
      return {
        ok: true,
        status: "queued",
        integratorAgentId: integrator.row.id,
        integrationBranch,
        prUrl: row.integration_pr_url || null,
        queuedBehind: {
          agentId: holder.source_agent_id,
          label: holderAgent?.row.label || "another agent",
        },
        job: this.integrationJobInfo(room),
      };
    }

    this.startIntegrationRun(
      room,
      source,
      integrator,
      actorUserId,
      integrationBranch,
    );
    return {
      ok: true,
      status: "started",
      integratorAgentId: integrator.row.id,
      integrationBranch,
      prUrl: row.integration_pr_url || null,
      job: this.integrationJobInfo(room),
    };
  }

  private isIntegratorBusy(integrator: AgentState): boolean {
    return (
      integrator.workerRunActive ||
      integrator.backend.isBusy() ||
      integrator.row.status === "running"
    );
  }

  private integrationJobInfo(room: RoomState): IntegrationJobInfo {
    const lock = getActiveIntegrationLock(room.id);
    const queue = listIntegrationQueue(room.id).map((item) => ({
      id: item.id,
      sourceAgentId: item.source_agent_id,
      sourceLabel: room.agents.get(item.source_agent_id)?.row.label,
      createdAt: item.created_at,
    }));
    if (!lock) {
      return { status: "idle", queue };
    }
    return {
      status: "running",
      sourceAgentId: lock.source_agent_id,
      sourceLabel: room.agents.get(lock.source_agent_id)?.row.label,
      heldBy: lock.held_by,
      expiresAt: lock.expires_at,
      queue,
    };
  }

  private startIntegrationRun(
    room: RoomState,
    source: AgentState,
    integrator: AgentState,
    actorUserId: string,
    integrationBranch: string,
  ): void {
    const actor = actorUserId ? db.getUserById(actorUserId) : undefined;
    const steeredBy: SteerAuthor | null = actorUserId
      ? {
          userId: actorUserId,
          name: actor?.name || "Host",
          email: actor?.email,
        }
      : null;
    integrator.lastSteeredBy = steeredBy;

    const prompt = buildIntegratePrompt({
      roomName: room.row.name,
      repoUrl: room.row.repo_url || "",
      startingRef: room.row.starting_ref || "main",
      integrationBranch,
      existingPrUrl: room.row.integration_pr_url,
      source: {
        id: source.row.id,
        label: source.row.label,
        branch: source.row.branch,
        prUrl: source.row.pr_url,
        kind: source.row.kind,
        status: source.row.status,
      },
      agents: [...room.agents.values()].map((a) => ({
        id: a.row.id,
        label: a.row.label,
        branch: a.row.branch,
        prUrl: a.row.pr_url,
        kind: a.row.kind,
        status: a.row.status,
      })),
    });

    const userMsg: ChatMessage = {
      id: nanoid(12),
      roomId: room.id,
      role: "user",
      content: `Integrate ${source.row.label} (\`${source.row.branch}\`) into \`${integrationBranch}\`. Sync with ${room.row.starting_ref || "main"} first. Keep every agent’s features if there are conflicts. Do not push unless checks pass.`,
      senderName: steeredBy?.name || "Host",
      senderUserId: actorUserId,
      status: "done",
      ts: Date.now(),
      agentId: integrator.row.id,
    };
    db.insertMessage(userMsg);
    this.io.to(room.id).emit("chat-message", userMsg);
    this.emitIntegrationUpdated(room, {
      sourceAgentId: source.row.id,
      integratorAgentId: integrator.row.id,
    });

    integrator.workerRunActive = true;
    void this.runAgent(
      room,
      integrator,
      prompt + attributionPromptSuffix(steeredBy),
    );
  }

  private recoverIntegrationLock(room: RoomState): void {
    const lock = getActiveIntegrationLock(room.id);
    if (!lock) return;
    const integratorId = room.row.integration_agent_id;
    const integrator = integratorId ? room.agents.get(integratorId) : undefined;
    if (integrator && this.isIntegratorBusy(integrator)) return;
    releaseIntegrationLock(room.id, lock.held_by);
    this.startNextQueuedIntegration(room);
  }

  private startNextQueuedIntegration(room: RoomState): void {
    const next = dequeueNextIntegrationJob(room.id);
    if (!next) {
      this.emitIntegrationUpdated(room, {
        sourceAgentId: "",
        integratorAgentId: room.row.integration_agent_id || "",
      });
      return;
    }
    const source = room.agents.get(next.source_agent_id);
    const integrationBranch = room.row.integration_branch?.trim();
    if (
      !source ||
      isIntegratorAgent(source.row) ||
      !source.row.branch?.trim() ||
      !integrationBranch ||
      !room.row.repo_url?.trim()
    ) {
      this.startNextQueuedIntegration(room);
      return;
    }
    const actorUserId = next.actor_user_id || room.row.owner_id || "";
    if (!actorUserId) {
      this.startNextQueuedIntegration(room);
      return;
    }
    let integrator: AgentState;
    try {
      integrator = this.ensureIntegratorAgent(
        room,
        room.row,
        source,
        actorUserId,
        integrationBranch,
      );
    } catch (err) {
      console.warn(
        "[RoomManager] queued integration skipped:",
        err instanceof Error ? err.message : err,
      );
      this.startNextQueuedIntegration(room);
      return;
    }
    const acquired = tryAcquireIntegrationLock({
      roomId: room.id,
      heldBy: newIntegrationJobId(),
      sourceAgentId: source.row.id,
      actorUserId,
      holderStillRunning: this.isIntegratorBusy(integrator),
    });
    if (!acquired.ok) {
      enqueueIntegrationJob({
        roomId: room.id,
        sourceAgentId: source.row.id,
        actorUserId,
      });
      return;
    }
    this.startIntegrationRun(
      room,
      source,
      integrator,
      actorUserId,
      integrationBranch,
    );
  }

  private async finishIntegrationJob(
    room: RoomState,
    agent: AgentState,
    outcome: "completed" | "error" | "aborted",
  ): Promise<void> {
    try {
      if (outcome === "completed") {
        await this.finalizeIntegrationPr(room, agent);
      }
    } finally {
      const lock = getActiveIntegrationLock(room.id);
      releaseIntegrationLock(room.id, lock?.held_by);
      this.startNextQueuedIntegration(room);
    }
  }

  private pickIntegratorBackend(
    row: db.RoomRow,
    actorUserId: string,
  ): AgentBackendKind {
    if (row.repo_url?.trim() && isClaudeSandboxConfigured()) {
      const key = resolveAnthropicApiKey(actorUserId, null, row.org_id);
      if (key) return "claude-code";
    }
    if (row.runtime === "cloud") return "cursor";
    if (isClaudeSandboxConfigured() && row.repo_url?.trim()) {
      return "claude-code";
    }
    throw new Error(
      "Integrate needs a cloud agent (Claude Code + E2B, or Cursor cloud) and a GitHub repo",
    );
  }

  private ensureIntegratorAgent(
    room: RoomState,
    row: db.RoomRow,
    source: AgentState,
    actorUserId: string,
    integrationBranch: string,
  ): AgentState {
    const existingId = row.integration_agent_id;
    if (existingId) {
      const live = room.agents.get(existingId);
      if (live && live.row.status !== "stopped") return live;
    }
    for (const agent of room.agents.values()) {
      if (
        isIntegratorAgent(agent.row) &&
        agent.row.status !== "stopped"
      ) {
        db.setRoomIntegration(row.id, { agentId: agent.row.id });
        row.integration_agent_id = agent.row.id;
        room.row.integration_agent_id = agent.row.id;
        return agent;
      }
    }

    const backend = this.pickIntegratorBackend(row, actorUserId);
    const info = this.addAgent(
      row.id,
      {
        backend,
        label: "Integrator",
        kind: "integrator",
        branch: integrationBranch,
        modelId:
          backend === "claude-code"
            ? DEFAULT_CLAUDE_MODEL
            : source.row.model_id,
        planMode: false,
        seedContext: true,
      },
      actorUserId,
    );
    const state = room.agents.get(info.id);
    if (!state) throw new Error("Failed to create Integrator");
    db.setRoomIntegration(row.id, {
      agentId: info.id,
      branch: integrationBranch,
    });
    row.integration_agent_id = info.id;
    row.integration_branch = integrationBranch;
    room.row.integration_agent_id = info.id;
    room.row.integration_branch = integrationBranch;
    return state;
  }

  private emitIntegrationUpdated(
    room: RoomState,
    ids: { sourceAgentId: string; integratorAgentId: string },
  ): void {
    this.io.to(room.id).emit("integration-updated", {
      roomId: room.id,
      branch: room.row.integration_branch || "",
      prUrl: room.row.integration_pr_url || undefined,
      sourceAgentId: ids.sourceAgentId,
      integratorAgentId: ids.integratorAgentId,
      job: this.integrationJobInfo(room),
    });
  }

  private async finalizeIntegrationPr(
    room: RoomState,
    agent: AgentState,
  ): Promise<void> {
    const token = githubTokenFromEnv();
    const repoUrl = room.row.repo_url?.trim();
    const head =
      room.row.integration_branch?.trim() || agent.row.branch?.trim();
    if (!token || !repoUrl || !head) return;
    const parsed = parseGithubRepoUrl(repoUrl);
    if (!parsed) return;

    const agents = db.listAgents(room.id);
    const lock = getActiveIntegrationLock(room.id);
    const source = lock
      ? room.agents.get(lock.source_agent_id)
      : undefined;
    const notes = this.latestIntegratorNotes(room, agent);
    const title = `[Steer] Integration — ${room.row.name}`.slice(0, 100);
    const body = buildIntegrationPrBody({
      roomName: room.row.name,
      startingRef: room.row.starting_ref || "main",
      integrationBranch: head,
      sourceId: source?.row.id,
      notes,
      agents: featureAgentSnapshots(
        agents.map((a) => ({
          id: a.id,
          label: a.label,
          branch: a.branch,
          prUrl: a.pr_url,
          kind: a.kind,
          status: a.status,
        })),
      ),
    });

    try {
      const pr = await ensurePullRequest({
        owner: parsed.owner,
        repo: parsed.repo,
        title,
        body,
        head,
        base: room.row.starting_ref?.trim() || "main",
        token,
      });
      db.setRoomIntegration(room.id, { prUrl: pr.url, branch: head });
      db.setAgentPr(agent.row.id, pr.url, head);
      room.row.integration_pr_url = pr.url;
      room.row.integration_branch = head;
      agent.row.pr_url = pr.url;
      agent.row.branch = head;
      if (source?.row.branch) {
        try {
          await commentOnPullRequest({
            owner: parsed.owner,
            repo: parsed.repo,
            number: pr.number,
            token,
            body: buildIntegrationPrComment({
              sourceLabel: source.row.label,
              sourceBranch: source.row.branch,
              integrationBranch: head,
              notes,
            }),
          });
        } catch (err) {
          console.warn(
            "[RoomManager] integration PR comment failed:",
            err instanceof Error ? err.message : err,
          );
        }
      }
      this.recordIntegrationMemory(room, agent, source, pr.url, notes);
      this.emitIntegrationUpdated(room, {
        sourceAgentId: source?.row.id || "",
        integratorAgentId: agent.row.id,
      });
      this.broadcastAgents(room);
    } catch (err) {
      console.warn(
        "[RoomManager] integration PR failed:",
        err instanceof Error ? err.message : err,
      );
    }
  }

  private latestIntegratorNotes(
    room: RoomState,
    agent: AgentState,
  ): string | undefined {
    const messages = db
      .getMessages(room.id, 80)
      .filter(
        (m) =>
          m.agentId === agent.row.id &&
          m.role === "assistant" &&
          m.status === "done" &&
          m.content.trim(),
      );
    const last = messages[messages.length - 1];
    return last?.content.trim().slice(0, 2000);
  }

  private recordIntegrationMemory(
    room: RoomState,
    agent: AgentState,
    source: AgentState | undefined,
    prUrl: string,
    notes?: string,
  ): void {
    const label = source?.row.label || "agent";
    const content = [
      `Merged ${label}${source?.row.branch ? ` (\`${source.row.branch}\`)` : ""} into \`${room.row.integration_branch}\`.`,
      `PR: ${prUrl}`,
      notes ? notes : "",
      "Spot-check that both features survived conflict resolution.",
    ]
      .filter(Boolean)
      .join("\n\n");
    try {
      const entry = createSanitizedMemory({
        roomId: room.id,
        kind: "discovery",
        title: `Integration: ${label}`,
        content,
        status: "active",
        createdByAgentId: agent.row.id,
        source: "auto",
      });
      this.broadcastMemoryUpdated(room.id, entry);
    } catch (err) {
      console.warn(
        "[RoomManager] integration memory failed:",
        err instanceof Error ? err.message : err,
      );
    }
  }

  private toRoomInfo(
    row: db.RoomRow,
    participantCount: number,
    actorUserId?: string,
  ): RoomInfo {
    const room = this.rooms.get(row.id);
    const agentInfos: AgentInfo[] | undefined = room
      ? [...room.agents.values()].map((a) => this.toAgentInfo(a.row))
      : undefined;

    const org = row.org_id ? db.getOrganization(row.org_id) : undefined;
    const myRole = actorUserId
      ? this.resolveUserRoomRole(row.id, actorUserId) ?? undefined
      : undefined;
    const myCanManage =
      actorUserId && userCanManageRoomAccess(row.id, actorUserId)
        ? true
        : undefined;
    return {
      id: row.id,
      name: row.name,
      repoPath: row.repo_path,
      agentCommand: row.agent_command,
      participantCount,
      status: row.status,
      createdAt: row.created_at,
      runtime: (row.runtime as AgentRuntime) || "local",
      authMode: (row.auth_mode as AuthMode) || "cli",
      modelId: row.model_id || DEFAULT_MODEL,
      controlMode: this.getControlMode(row),
      approvalMode: parseApprovalMode(row.approval_mode),
      autoMemory: parseAutoMemoryMode(row.auto_memory),
      repoUrl: row.repo_url || undefined,
      startingRef: row.starting_ref || undefined,
      prUrl: row.pr_url || undefined,
      autoCreatePR: Boolean(row.auto_create_pr),
      integrationBranch: row.integration_branch || undefined,
      integrationPrUrl: row.integration_pr_url || undefined,
      integrationAgentId: row.integration_agent_id || undefined,
      integrationJob: room ? this.integrationJobInfo(room) : undefined,
      keyHint: row.key_hint || undefined,
      ownerId: row.owner_id || undefined,
      orgId: row.org_id || undefined,
      orgName: org?.name,
      cursorSessionId: row.cursor_session_id || undefined,
      agents: agentInfos,
      myRole,
      myCanManage,
      slackNotifyConfigured: Boolean(
        row.slack_webhook_ciphertext || envSlackWebhookConfigured(),
      ),
      slackWebhookHint: myCanManage
        ? row.slack_webhook_hint || undefined
        : undefined,
    };
  }
}
