import { nanoid } from "nanoid";
import * as db from "../db.js";
import type { RoomRow, AgentRow, MemoryEntryRow, AgentContextReceiptRow } from "../db/sqlite.js";
import {
  MEMORY_CONTENT_MAX,
  MEMORY_TITLE_MAX,
  isMemoryKind,
  isMemorySource,
  sanitizeMemoryText,
  type HandoffDraft,
  type MemoryEntryInfo,
  type MemoryKind,
  type MemorySource,
  type PackedContext,
  type AgentContextReceiptInfo,
  type RoomContextSnapshot,
} from "../../shared/roomContext.js";
import { packRoomContext } from "./pack.js";
import { ensureRoomRepoMap, loadRoomGraph } from "./store.js";

export function toMemoryInfo(row: MemoryEntryRow): MemoryEntryInfo {
  return {
    id: row.id,
    roomId: row.room_id,
    kind: row.kind,
    title: row.title,
    content: row.content,
    status: row.status,
    pinned: Boolean(row.pinned),
    revision: row.current_revision,
    createdByUserId: row.created_by_user_id,
    createdByAgentId: row.created_by_agent_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    sourceMessageId: row.source_message_id,
    sourcePath: row.source_path,
    supersedesId: row.supersedes_id,
    source: isMemorySource(row.source) ? row.source : "human",
  };
}

export function toReceiptInfo(row: AgentContextReceiptRow): AgentContextReceiptInfo {
  let entryIds: string[] = [];
  let fileIds: string[] = [];
  try {
    entryIds = JSON.parse(row.entry_ids_json);
  } catch {
    entryIds = [];
  }
  try {
    fileIds = JSON.parse(row.file_ids_json);
  } catch {
    fileIds = [];
  }
  return {
    id: row.id,
    roomId: row.room_id,
    agentId: row.agent_id,
    runId: row.run_id,
    mapId: row.map_id,
    gitSha: row.git_sha,
    memoryVersion: row.memory_version,
    entryIds: Array.isArray(entryIds) ? entryIds : [],
    fileIds: Array.isArray(fileIds) ? fileIds : [],
    isBaseline: Boolean(row.is_baseline),
    createdAt: row.created_at,
  };
}

export function buildHandoffDraft(
  room: RoomRow,
  agent: AgentRow,
  extras?: { touchedPaths?: string[]; lastAssistant?: string | null },
): HandoffDraft {
  const paths = (extras?.touchedPaths || []).slice(0, 12);
  const lines = [
    `Agent ${agent.label} finished work.`,
    extras?.lastAssistant
      ? `Last result: ${extras.lastAssistant.slice(0, 400)}`
      : "",
    paths.length ? `Touched: ${paths.join(", ")}` : "",
    agent.branch ? `Branch: ${agent.branch}` : "",
    agent.pr_url ? `PR: ${agent.pr_url}` : "",
    "Remaining work should continue from these files rather than re-exploring the repo.",
  ].filter(Boolean);
  return {
    title: `Handoff from ${agent.label}`,
    content: lines.join("\n"),
    sourcePath: paths[0],
    branch: agent.branch,
    prUrl: agent.pr_url,
    touchedPaths: paths,
  };
}

export function createSanitizedMemory(input: {
  roomId: string;
  kind: unknown;
  title: unknown;
  content: unknown;
  status?: "active" | "proposed";
  pinned?: boolean;
  createdByUserId?: string | null;
  createdByAgentId?: string | null;
  sourceMessageId?: string | null;
  sourcePath?: string | null;
  source?: MemorySource;
}): MemoryEntryInfo {
  if (!isMemoryKind(input.kind)) {
    throw new Error("Invalid memory kind");
  }
  const title = sanitizeMemoryText(input.title, MEMORY_TITLE_MAX);
  const content = sanitizeMemoryText(input.content, MEMORY_CONTENT_MAX);
  if (!title || !content) throw new Error("Title and content are required");
  const row = db.createMemoryEntry({
    roomId: input.roomId,
    kind: input.kind as MemoryKind,
    title,
    content,
    status: input.status,
    pinned: input.pinned,
    createdByUserId: input.createdByUserId,
    createdByAgentId: input.createdByAgentId,
    sourceMessageId: input.sourceMessageId,
    sourcePath: input.sourcePath,
    source: input.source ?? "human",
  });
  return toMemoryInfo(row);
}

export function buildRoomContextSnapshot(roomId: string): RoomContextSnapshot {
  const { map } = loadRoomGraph(roomId);
  const entries = db
    .listMemoryEntries(roomId, { includeProposed: true })
    .map(toMemoryInfo);
  const lastReceiptByAgent: Record<string, AgentContextReceiptInfo> = {};
  for (const row of db.latestContextReceiptsByAgent(roomId)) {
    lastReceiptByAgent[row.agent_id] = toReceiptInfo(row);
  }
  return {
    memoryVersion: db.getRoomMemoryVersion(roomId),
    map,
    entries,
    lastReceiptByAgent,
  };
}

export function buildAgentBriefing(opts: {
  room: RoomRow;
  agent: AgentRow;
  prompt: string;
  touchedPaths?: string[];
  checkoutRoot?: string | null;
  seedContext?: boolean;
}): PackedContext {
  const receipts = db.listAgentContextReceipts(opts.agent.id, 1);
  const isBaseline = receipts.length === 0 && opts.seedContext !== false;
  try {
    ensureRoomRepoMap(opts.room);
  } catch {
    // map failures should not block the run
  }
  const { map, graph } = loadRoomGraph(opts.room.id);
  const entries = db
    .listMemoryEntries(opts.room.id)
    .filter((e) => e.status === "active")
    .map(toMemoryInfo);
  const packed = packRoomContext({
    graph,
    map,
    entries,
    memoryVersion: db.getRoomMemoryVersion(opts.room.id),
    prompt: opts.prompt,
    agentScopePath: opts.agent.scope_path,
    touchedPaths: opts.touchedPaths,
    isBaseline,
    checkoutRoot: opts.checkoutRoot ?? opts.room.repo_path,
  });
  db.insertAgentContextReceipt({
    roomId: opts.room.id,
    agentId: opts.agent.id,
    runId: nanoid(10),
    mapId: packed.mapId,
    gitSha: packed.gitSha,
    memoryVersion: packed.memoryVersion,
    entryIds: packed.entryIds,
    fileIds: packed.fileIds,
    isBaseline: packed.isBaseline,
  });
  return packed;
}
