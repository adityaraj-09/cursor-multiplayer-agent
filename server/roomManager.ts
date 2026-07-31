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
import { githubTokenFromEnv } from "./githubPr.js";
import {
  resolveAnthropicApiKey,
  setUserAnthropicByokKey,
} from "./userAnthropicByok.js";
import {
  CLAUDE_MODELS,
  DEFAULT_CLAUDE_MODEL,
} from "../shared/claudeModels.js";
import { DiffWatcher } from "./diffWatcher.js";
import { extractToolPath, getFileDiff, isEditTool } from "./gitDiff.js";
import { isTodoTool } from "../shared/backends/cursor.js";
import { listCliModels } from "./cliModels.js";
import { WorkerRelay } from "./workerRelay.js";
import * as db from "./db.js";
import {
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
import { detectAgentConflicts, resolveAgentCwd, findScopeOverlap, formatScopeOverlapError } from "./agentConflicts.js";
import { FileLockRegistry, broadcastFileLocks } from "./fileLocks.js";
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
  RoomInfo,
  ServerToClientEvents,
  ClientToServerEvents,
} from "../shared/events.js";
import { AVATAR_COLORS } from "../shared/events.js";

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
  /** Primary agent backend. Defaults to cursor. */
  backend?: AgentBackendKind;
  /** Anthropic API key when backend is claude-code (cloud). Saved as user BYOK. */
  anthropicApiKey?: string;
}

type AgentBackend = AgentRunner | SdkAgentSession | ClaudeSandboxSession;

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
 * Order: room-stored BYOK → server CURSOR_API_KEY → owner's saved user BYOK.
 * Claude cloud rooms start as auth_mode=server with no Cursor key; attaching a
 * Cursor agent later can reuse the owner's saved BYOK from previous sessions.
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
  const serverKey = getServerApiKey();
  if (serverKey) return serverKey;

  const uid = userId || row.owner_id || undefined;
  if (uid) {
    const userKey = getUserByokKey(uid);
    if (userKey) return userKey;
  }

  throw new Error(
    "No Cursor API key configured — paste a Cursor API key (saved from previous sessions) or set CURSOR_API_KEY on the server",
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
      return agents[0]?.id ?? null;
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
          anthropicApiKey = resolveAnthropicApiKey(ownerId);
        }
        if (!anthropicApiKey) {
          throw new Error(
            "Paste your Anthropic API key for Claude Code (or set ANTHROPIC_API_KEY on the server)",
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
      apiKey = getServerApiKey();
      if (!apiKey) {
        throw new Error(
          "Server key is not configured — set CURSOR_API_KEY or pick one up in Create session",
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
      });
      cursorAgentId = await sdk.ensureStarted();
      existingBackend = sdk;
    }

    if (authMode === "cli" && !ownerId) {
      throw new Error("Sign in required to create a local CLI session");
    }

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
      `Created ${runtime}/${authMode}/${backendKind} room "${name}" (${id}) model=${modelId}`,
    );
    return this.toRoomInfo(row, 0);
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
          autoCreatePR: Boolean(row.auto_create_pr),
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
      });
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
    });
  }

  // -----------------------------------------------------------------------
  // Agent helpers
  // -----------------------------------------------------------------------

  private getDefaultAgent(room: RoomState): AgentState {
    // First by sort_order (agentRows come sorted from DB)
    let first: AgentState | undefined;
    for (const a of room.agents.values()) {
      if (!first || a.row.sort_order < first.row.sort_order) {
        first = a;
      }
    }
    if (!first) throw new Error("Room has no agents");
    return first;
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
    };
  }

  /** Cloud Claude Code via E2B sandbox (E2B_API_KEY server-side; Anthropic key BYOK). */
  private createClaudeSandboxBackend(
    row: db.RoomRow,
    agentRow: db.AgentRow,
    anthropicApiKey?: string,
  ): ClaudeSandboxSession {
    const apiKey =
      anthropicApiKey?.trim() ||
      resolveAnthropicApiKey(row.owner_id) ||
      "";
    const agentId = agentRow.id;
    const roomId = row.id;
    return new ClaudeSandboxSession({
      apiKey,
      model: agentRow.model_id || DEFAULT_CLAUDE_MODEL,
      name: `${row.name}/${agentRow.label}`,
      repoUrl: row.repo_url?.trim() || "",
      startingRef: row.starting_ref || "main",
      autoCreatePR: Boolean(row.auto_create_pr),
      sessionId: agentRow.session_id,
      sandboxId: agentRow.sdk_agent_id,
      branch: agentRow.branch,
      prUrl: agentRow.pr_url,
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

  updateAgentMeta(
    roomId: string,
    agentId: string,
    opts: { label?: string; scopePath?: string | null },
    actorUserId?: string,
  ): AgentInfo {
    const row = db.getRoom(roomId);
    if (!row || row.status !== "active") throw new Error("Room not found");
    if (actorUserId && row.owner_id && row.owner_id !== actorUserId) {
      throw new Error("Only the host can update agents");
    }
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

  private broadcastAgents(room: RoomState): void {
    const infos: AgentInfo[] = [];
    for (const a of room.agents.values()) {
      infos.push(this.toAgentInfo(a.row));
    }
    this.io.to(room.id).emit("agents", infos);
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

    // tool_done with no prior start and not a todo — nothing to attach to.
    if (!existingId && opts.status !== "streaming" && !isTodo) {
      return null;
    }

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
    if (opts.diffPatch) msg.diffPatch = opts.diffPatch;

    if (existingId) {
      if (opts.diffPatch || opts.todos?.length) {
        db.updateMessageTool(id, opts.content, opts.status, {
          diffPatch: opts.diffPatch,
          todos: opts.todos,
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
    if (row.owner_id && row.owner_id !== actorUserId) {
      throw new Error("Only the host can force-release file locks");
    }
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
    for (const [, agent] of room.agents) {
      if (agent.driverSocketId === socket.id) {
        agent.driverSocketId = null;
        if (
          agent.pendingDriveRequest &&
          room.participants.has(agent.pendingDriveRequest.socketId)
        ) {
          agent.driverSocketId = agent.pendingDriveRequest.socketId;
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
    socket.disconnect(true);
  }

  handleRemoveMember(socket: Socket, targetUserIdRaw: string): void {
    const room = this.getRoomForSocket(socket.id);
    if (!room) return;
    const actor = room.participants.get(socket.id);
    if (!actor?.userId || room.row.owner_id !== actor.userId) {
      socket.emit("error", "Only the host can remove members");
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
        targetSocket.emit("kicked", "Removed by the host");
        this.leaveRoom(targetSocket);
        targetSocket.disconnect(true);
      }
    }
    this.broadcastPresence(room);
  }

  isRoomOwner(roomId: string, userId: string): boolean {
    const row = db.getRoom(roomId);
    return Boolean(row && row.owner_id === userId);
  }

  // -----------------------------------------------------------------------
  // handleSteerMessage — parse (textOrAgentId, text?) overload
  // -----------------------------------------------------------------------

  handleSteerMessage(
    socket: Socket,
    textOrAgentId: string,
    text?: string,
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

    const agent = this.getAgentState(room, agentId);
    if (!agent) {
      socket.emit("error", `Agent ${agentId} not found`);
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

    const p = room.participants.get(socket.id);
    const userMsg: ChatMessage = {
      id: nanoid(12),
      roomId: room.id,
      role: "user",
      content: sanitized,
      senderName: p?.name || "Unknown",
      senderColor: p?.color || "#888",
      status: "done",
      ts: Date.now(),
      agentId,
    };

    db.insertMessage(userMsg);
    this.io.to(room.id).emit("chat-message", userMsg);
    db.updateRoomActivity(room.id);
    void this.runAgent(room, agent, sanitized);
  }

  // -----------------------------------------------------------------------
  // tryDispatchToWorker
  // -----------------------------------------------------------------------

  private tryDispatchToWorker(
    room: RoomState,
    agent: AgentState,
    prompt: string,
  ): boolean {
    if (!this.workerRelay) return false;
    if (room.row.auth_mode !== "cli") return false;
    if (room.row.runtime !== "local") return false;

    const ownerId = room.row.owner_id ?? undefined;
    const worker = ownerId
      ? this.workerRelay.findWorkerForUser(ownerId)
      : null;

    if (!worker) return false;

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
      if (text.length >= bubbleBaseLen) {
        display = text.slice(bubbleBaseLen).replace(/^\n+/, "");
        seenFullText =
          text.length >= seenFullText.length ? text : seenFullText;
      } else {
        display = text;
        seenFullText = text;
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
            this.upsertAgentToolMessage(room, agent, {
              callId: event.callId,
              name: event.name || "tool",
              content: event.detail || "Running…",
              path: toolPath,
              todos: event.todos?.length ? event.todos : undefined,
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
        prompt,
        room.row.repo_path,
        agent.row.model_id || "auto",
        agent.row.session_id,
        agent.row.id,
        agent.cwd,
        agent.row.backend,
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
    prompt: string,
  ): Promise<void> {
    if (this.tryDispatchToWorker(room, agent, prompt)) return;

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
      } else {
        display = text;
        seenFullText = text;
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

      await agent.backend.run(prompt, (event) => {
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
            this.upsertAgentToolMessage(room, agent, {
              callId: event.callId,
              name: event.name || "tool",
              content: event.detail || "Running…",
              path,
              todos: event.todos?.length ? event.todos : undefined,
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
            break;
          }
        }
      });

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
    } catch (err) {
      if (!isCurrent()) return;
      const message = err instanceof Error ? err.message : String(err);
      emitAssistant(message, "error");
      this.emitAgentStatus(room, agent.row.id, "error", message);
      this.emitAgentStatus(room, agent.row.id, "idle");
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

  // -----------------------------------------------------------------------
  // Driver control — per agent
  // -----------------------------------------------------------------------

  handleRequestDrive(socket: Socket, agentId?: string): void {
    const room = this.getRoomForSocket(socket.id);
    if (!room) return;
    const p = room.participants.get(socket.id);
    if (!p) return;

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
    },
    actorUserId: string,
  ): AgentInfo {
    const room = this.rooms.get(roomId);
    const row = db.getRoom(roomId);
    if (!room || !row || row.status !== "active") {
      throw new Error("Room not found");
    }
    if (row.owner_id && row.owner_id !== actorUserId) {
      throw new Error("Only the host can add agents");
    }

    const backendKind: AgentBackendKind =
      opts.backend === "claude-code" ? "claude-code" : "cursor";

    let anthropicApiKey = "";
    if (backendKind === "claude-code") {
      if (row.runtime === "cloud") {
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
          anthropicApiKey = resolveAnthropicApiKey(actorUserId);
        }
        if (!anthropicApiKey) {
          throw new Error(
            "Paste your Anthropic API key for Claude Code (or set ANTHROPIC_API_KEY on the server)",
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
    });

    const cwd = row.runtime === "local"
      ? resolveAgentCwd(row.repo_path, agentRow.scope_path)
      : "";

    let backend: AgentBackend;
    if (backendKind === "claude-code" && row.runtime === "cloud") {
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
        autoCreatePR: Boolean(row.auto_create_pr),
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
    };

    room.agents.set(agentRow.id, agentState);
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
    if (actorUserId && row.owner_id && row.owner_id !== actorUserId) {
      throw new Error("Only the host can stop agents");
    }

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

    if (actorUserId && row.owner_id && row.owner_id !== actorUserId) {
      throw new Error("Only the host can change the model");
    }

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

    if (actorUserId && row.owner_id && row.owner_id !== actorUserId) {
      throw new Error("Only the host can change the Cursor chat");
    }

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
    if (actorUserId && row.owner_id && row.owner_id !== actorUserId) {
      throw new Error("Only the host can stop the session");
    }
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

  userCanAccessRoom(roomId: string, userId: string): boolean {
    const row = db.getRoom(roomId);
    if (!row) return false;
    if (row.owner_id === userId) return true;
    return db.isRoomMember(roomId, userId);
  }

  joinAsMember(roomId: string, userId: string): RoomInfo {
    const row = db.getRoom(roomId);
    if (!row || row.status !== "active") {
      throw new Error("Room not found");
    }
    if (row.owner_id !== userId && !db.isRoomMember(roomId, userId)) {
      db.addRoomMember(roomId, userId, "member");
    }
    return this.toRoomInfo(
      row,
      this.rooms.get(roomId)?.participants.size || 0,
    );
  }

  getRoomInfo(id: string): RoomInfo | null {
    const row = db.getRoom(id);
    if (!row) return null;
    return this.toRoomInfo(row, this.rooms.get(id)?.participants.size || 0);
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

      list.push({
        socketId,
        name: p.name,
        color: p.color,
        userId: p.userId,
        isOwner: Boolean(
          room.row.owner_id && p.userId === room.row.owner_id,
        ),
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

  private toRoomInfo(row: db.RoomRow, participantCount: number): RoomInfo {
    const room = this.rooms.get(row.id);
    const agentInfos: AgentInfo[] | undefined = room
      ? [...room.agents.values()].map((a) => this.toAgentInfo(a.row))
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
      repoUrl: row.repo_url || undefined,
      startingRef: row.starting_ref || undefined,
      prUrl: row.pr_url || undefined,
      autoCreatePR: Boolean(row.auto_create_pr),
      keyHint: row.key_hint || undefined,
      ownerId: row.owner_id || undefined,
      cursorSessionId: row.cursor_session_id || undefined,
      agents: agentInfos,
    };
  }
}
