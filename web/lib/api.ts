import type {
  AuthMode,
  AgentRuntime,
  CursorChatSession,
  ModelInfo,
  RepoInfo,
  RoomInfo,
  RoomMemberInfo,
  UserInfo,
  ChatMessage,
} from "../../shared/events";
import type { RoomInviteRole } from "../../shared/roomPermissions";
import type {
  OrgInfo,
  OrgInviteInfo,
  OrgMemberInfo,
  OrgRole,
} from "../../shared/orgs";

export type { OrgInfo, OrgInviteInfo, OrgMemberInfo, OrgRole };

/**
 * Prefer NEXT_PUBLIC_API_URL (direct to Render).
 * Fallback `/api` works on Vercel via vercel.json rewrite → Render.
 */
function apiBase(): string {
  const raw = (process.env.NEXT_PUBLIC_API_URL || "").trim().replace(/\/+$/, "");
  if (raw) return `${raw}/api`;
  return "/api";
}
const API_BASE = apiBase();

type TokenGetter = () => Promise<string | null>;
let tokenGetter: TokenGetter | null = null;

/** Wired by AuthProvider to return the current Clerk JWT. */
export function setTokenGetter(fn: TokenGetter): void {
  tokenGetter = fn;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Clerk can report signed-in before getToken() is ready (common right after
 * redirect onto /invite/…). Retry briefly so API calls don't go out bare.
 */
export async function waitForAuthToken(
  opts: { attempts?: number; intervalMs?: number } = {},
): Promise<string | null> {
  const attempts = opts.attempts ?? 12;
  const intervalMs = opts.intervalMs ?? 75;
  for (let i = 0; i < attempts; i++) {
    if (tokenGetter) {
      try {
        const token = await tokenGetter();
        if (token) return token;
      } catch {
        // retry
      }
    }
    if (i < attempts - 1) await delay(intervalMs * Math.min(i + 1, 4));
  }
  return null;
}

async function authHeaders(): Promise<Record<string, string>> {
  const token = await waitForAuthToken();
  if (!token) {
    console.warn("[api] No Clerk auth token available for request");
    return {};
  }
  return { Authorization: `Bearer ${token}` };
}

export async function fetchMe(): Promise<UserInfo | null> {
  const res = await fetch(`${API_BASE}/auth/me`, {
    headers: await authHeaders(),
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.user;
}

export async function createPairingCode(): Promise<{
  code: string;
  expiresAt: number;
}> {
  const res = await fetch(`${API_BASE}/auth/pairing/create`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to create pairing code");
  }
  return res.json();
}

export async function joinViaInvite(code: string): Promise<{ roomId: string }> {
  const token = await waitForAuthToken();
  if (!token) {
    throw new Error("Authentication required — try refreshing, then open the invite again");
  }
  const res = await fetch(`${API_BASE}/auth/invite/${encodeURIComponent(code)}/join`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to join");
  }
  return res.json();
}

export async function createInviteLink(
  roomId: string,
  opts?: {
    maxUses?: number | null;
    role?: "viewer" | "editor";
  },
): Promise<{
  code: string;
  roomId: string;
  maxUses: number | null;
  useCount: number;
  expiresAt?: number | null;
  role: "viewer" | "editor";
}> {
  const res = await fetch(`${API_BASE}/auth/${roomId}/invite`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(await authHeaders()),
    },
    body: JSON.stringify({
      maxUses: opts?.maxUses ?? null,
      role: opts?.role ?? "viewer",
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to create invite");
  }
  return res.json();
}

export type InviteLinkInfo = {
  code: string;
  roomId: string;
  createdBy: string;
  createdAt: number;
  maxUses: number | null;
  useCount: number;
  expiresAt: number | null;
  role: "viewer" | "editor";
};

export async function listInviteLinks(
  roomId: string,
): Promise<InviteLinkInfo[]> {
  const res = await fetch(`${API_BASE}/auth/${roomId}/invites`, {
    headers: await authHeaders(),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to list invites");
  }
  const data = await res.json();
  return data.invites ?? [];
}

export async function revokeInviteLink(code: string): Promise<void> {
  const res = await fetch(`${API_BASE}/auth/invite/${code}`, {
    method: "DELETE",
    headers: await authHeaders(),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to revoke invite");
  }
}

/** Ask the paired CLI worker to open a native folder picker. */
export async function pickLocalFolder(): Promise<string> {
  const res = await fetch(`${API_BASE}/workers/pick-folder`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(await authHeaders()),
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to pick folder");
  }
  const data = (await res.json()) as { path: string };
  return data.path;
}

export async function fetchOnlineWorkers(): Promise<
  Array<{ id: string; name: string; busy: boolean }>
> {
  const res = await fetch(`${API_BASE}/workers`, {
    headers: await authHeaders(),
  });
  if (!res.ok) return [];
  const data = await res.json();
  return data.workers || [];
}

export async function fetchCursorSessions(
  repoPath: string,
): Promise<CursorChatSession[]> {
  const params = new URLSearchParams({ repoPath });
  const res = await fetch(`${API_BASE}/cursor-sessions?${params}`, {
    headers: await authHeaders(),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to list chat sessions");
  }
  const data = await res.json();
  return data.sessions ?? [];
}

export async function fetchRooms(opts?: {
  /** `personal` for non-org rooms, an org id for team sessions, or omit for all. */
  orgId?: string | null;
}): Promise<RoomInfo[]> {
  const params = new URLSearchParams();
  if (opts?.orgId) params.set("orgId", opts.orgId);
  const qs = params.toString();
  const res = await fetch(`${API_BASE}/rooms${qs ? `?${qs}` : ""}`, {
    headers: await authHeaders(),
  });
  if (!res.ok) throw new Error("Failed to fetch rooms");
  return res.json();
}

export async function fetchRoom(id: string): Promise<RoomInfo> {
  const res = await fetch(`${API_BASE}/rooms/${id}`, {
    headers: await authHeaders(),
  });
  if (!res.ok) throw new Error("Room not found");
  return res.json();
}

/** Join a room via shared /room/:id link (signed-in users). */
export async function joinRoom(id: string): Promise<RoomInfo> {
  const res = await fetch(`${API_BASE}/rooms/${id}/join`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(await authHeaders()),
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to join room");
  }
  return res.json();
}

/**
 * Load room; if not a member yet, join via the shared link then reload.
 */
export async function fetchOrJoinRoom(id: string): Promise<RoomInfo> {
  try {
    return await fetchRoom(id);
  } catch {
    return joinRoom(id);
  }
}

export async function fetchAuthStatus(opts?: { orgId?: string | null }): Promise<{
  serverKeyConfigured: boolean;
  serverKeySource: "env" | "stored" | "none";
  serverKeyHint: string | null;
  encryptionConfigured: boolean;
  byokAvailable: boolean;
  userByokConfigured: boolean;
  userByokHint: string | null;
  userAnthropicByokConfigured: boolean;
  userAnthropicByokHint: string | null;
  e2bConfigured: boolean;
  canManageServerKey: boolean;
  orgCursorKeyConfigured?: boolean;
  orgCursorKeyHint?: string | null;
  orgAnthropicKeyConfigured?: boolean;
  orgAnthropicKeyHint?: string | null;
}> {
  const params = new URLSearchParams();
  if (opts?.orgId && opts.orgId !== "personal") {
    params.set("orgId", opts.orgId);
  }
  const qs = params.toString();
  const res = await fetch(`${API_BASE}/auth/status${qs ? `?${qs}` : ""}`, {
    headers: await authHeaders(),
  });
  if (!res.ok) throw new Error("Failed to fetch auth status");
  return res.json();
}

export async function setServerKey(apiKey: string): Promise<{
  serverKeyConfigured: boolean;
  serverKeySource: "env" | "stored" | "none";
  serverKeyHint: string | null;
}> {
  const res = await fetch(`${API_BASE}/auth/server-key`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(await authHeaders()),
    },
    body: JSON.stringify({ apiKey }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to save server key");
  }
  return res.json();
}

export async function clearServerKey(): Promise<void> {
  const res = await fetch(`${API_BASE}/auth/server-key`, {
    method: "DELETE",
    headers: await authHeaders(),
  });
  if (!res.ok) throw new Error("Failed to clear server key");
}

export async function setByokKey(apiKey: string): Promise<{
  userByokConfigured: boolean;
  userByokHint: string | null;
}> {
  const res = await fetch(`${API_BASE}/auth/byok-key`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(await authHeaders()),
    },
    body: JSON.stringify({ apiKey }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to save BYOK key");
  }
  return res.json();
}

export async function clearByokKey(): Promise<void> {
  const res = await fetch(`${API_BASE}/auth/byok-key`, {
    method: "DELETE",
    headers: await authHeaders(),
  });
  if (!res.ok) throw new Error("Failed to clear BYOK key");
}

export async function setAnthropicByokKey(apiKey: string): Promise<{
  userAnthropicByokConfigured: boolean;
  userAnthropicByokHint: string | null;
}> {
  const res = await fetch(`${API_BASE}/auth/anthropic-byok-key`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(await authHeaders()),
    },
    body: JSON.stringify({ apiKey }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to save Anthropic API key");
  }
  return res.json();
}

export async function clearAnthropicByokKey(): Promise<void> {
  const res = await fetch(`${API_BASE}/auth/anthropic-byok-key`, {
    method: "DELETE",
    headers: await authHeaders(),
  });
  if (!res.ok) throw new Error("Failed to clear Anthropic API key");
}

export async function fetchModels(opts: {
  authMode: AuthMode;
  apiKey?: string;
  orgId?: string;
}): Promise<ModelInfo[]> {
  const res = await fetch(`${API_BASE}/models`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(await authHeaders()),
    },
    body: JSON.stringify(opts),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to list models");
  }
  const data = await res.json();
  return data.models as ModelInfo[];
}

export async function fetchRepositories(opts: {
  authMode: AuthMode;
  apiKey?: string;
  orgId?: string;
}): Promise<RepoInfo[]> {
  const res = await fetch(`${API_BASE}/repositories`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(await authHeaders()),
    },
    body: JSON.stringify(opts),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to list repositories");
  }
  const data = await res.json();
  return data.repositories as RepoInfo[];
}

export async function updateRoomSettings(
  id: string,
  data: {
    controlMode?: "open" | "driver" | "host";
    approvalMode?: "off" | "dangerous" | "all";
    autoMemory?: "off" | "extract";
  },
): Promise<RoomInfo> {
  const res = await fetch(`${API_BASE}/rooms/${id}/settings`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      ...(await authHeaders()),
    },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to update room settings");
  }
  return res.json();
}

export async function fetchRoomSlackWebhook(roomId: string): Promise<{
  configured: boolean;
  hint: string | null;
  envFallback: boolean;
}> {
  const res = await fetch(`${API_BASE}/rooms/${roomId}/slack-webhook`, {
    headers: await authHeaders(),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to load Slack status");
  }
  return res.json();
}

export async function setRoomSlackWebhook(
  roomId: string,
  webhookUrl: string,
): Promise<{ configured: boolean; hint: string | null; room: RoomInfo }> {
  const res = await fetch(`${API_BASE}/rooms/${roomId}/slack-webhook`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      ...(await authHeaders()),
    },
    body: JSON.stringify({ webhookUrl }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to save Slack webhook");
  }
  return res.json();
}

export async function clearRoomSlackWebhook(
  roomId: string,
): Promise<{ configured: boolean; room: RoomInfo }> {
  const res = await fetch(`${API_BASE}/rooms/${roomId}/slack-webhook`, {
    method: "DELETE",
    headers: await authHeaders(),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to remove Slack webhook");
  }
  return res.json();
}

export async function testRoomSlackWebhook(
  roomId: string,
): Promise<{ ok: true; used: "room" | "env" }> {
  const res = await fetch(`${API_BASE}/rooms/${roomId}/slack-webhook/test`, {
    method: "POST",
    headers: await authHeaders(),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to send test message");
  }
  return res.json();
}

export async function uploadRoomFile(
  roomId: string,
  file: File,
): Promise<import("../../shared/events").ChatAttachment> {
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
  const res = await fetch(`${API_BASE}/rooms/${roomId}/uploads`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(await authHeaders()),
    },
    body: JSON.stringify({
      name: file.name,
      mime: file.type,
      data,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to upload file");
  }
  const body = await res.json();
  return body.attachment;
}

export async function fetchRoomUploadBlob(
  roomId: string,
  fileId: string,
): Promise<Blob> {
  const res = await fetch(`${API_BASE}/rooms/${roomId}/uploads/${fileId}`, {
    headers: await authHeaders(),
  });
  if (!res.ok) throw new Error("Failed to load attachment");
  return res.blob();
}

export async function ackRoomPing(
  roomId: string,
  pingId: string,
  name?: string,
): Promise<{
  ok: boolean;
  ping: import("../../shared/events").PingInfo | null;
}> {
  const res = await fetch(`${API_BASE}/rooms/${roomId}/pings/${pingId}/ack`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(await authHeaders()),
    },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to acknowledge ping");
  }
  return res.json();
}

export type { RoomMemberInfo };

export async function fetchRoomMembers(
  roomId: string,
): Promise<RoomMemberInfo[]> {
  const res = await fetch(`${API_BASE}/rooms/${roomId}/members`, {
    headers: await authHeaders(),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to fetch members");
  }
  const data = await res.json();
  return data.members ?? [];
}

export async function updateRoomMemberRole(
  roomId: string,
  userId: string,
  role: RoomInviteRole,
): Promise<RoomMemberInfo[]> {
  const res = await fetch(
    `${API_BASE}/rooms/${roomId}/members/${encodeURIComponent(userId)}`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        ...(await authHeaders()),
      },
      body: JSON.stringify({ role }),
    },
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to update member role");
  }
  const data = await res.json();
  return data.members ?? [];
}

export async function removeRoomMember(
  roomId: string,
  userId: string,
): Promise<void> {
  const res = await fetch(`${API_BASE}/rooms/${roomId}/members/remove`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(await authHeaders()),
    },
    body: JSON.stringify({ userId }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to remove member");
  }
}

export async function exportRoomTranscript(roomId: string): Promise<{
  room: RoomInfo;
  messages: ChatMessage[];
  summary: string;
  exportedAt: number;
}> {
  const res = await fetch(`${API_BASE}/rooms/${roomId}/export`, {
    headers: await authHeaders(),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to export transcript");
  }
  return res.json();
}

export async function createRoom(data: {
  name: string;
  runtime: AgentRuntime;
  authMode: AuthMode;
  modelId?: string;
  repoPath?: string;
  repoUrl?: string;
  startingRef?: string;
  autoCreatePR?: boolean;
  apiKey?: string;
  backend?: "cursor" | "claude-code";
  anthropicApiKey?: string;
  orgId?: string;
  controlMode?: "open" | "driver" | "host";
  /** Start the first agent in plan mode (read-only explore/propose). */
  planMode?: boolean;
  /** Room-level approval gates for high-blast-radius tools. */
  approvalMode?: "off" | "dangerous" | "all";
}): Promise<RoomInfo> {
  const res = await fetch(`${API_BASE}/rooms`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(await authHeaders()),
    },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to create room");
  }
  return res.json();
}

export async function stopRoom(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/rooms/${id}/stop`, {
    method: "POST",
    headers: await authHeaders(),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to stop room");
  }
}

export async function abortRoomRun(
  id: string,
  agentId?: string,
): Promise<void> {
  const res = await fetch(`${API_BASE}/rooms/${id}/abort`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(await authHeaders()),
    },
    body: JSON.stringify(agentId ? { agentId } : {}),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to abort run");
  }
}

export async function revertRoomChanges(
  id: string,
  opts: { agentId?: string; filePaths?: string[]; messageId?: string } = {},
): Promise<{ ok: boolean; reverted: string[]; errors: string[] }> {
  const res = await fetch(`${API_BASE}/rooms/${id}/revert`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(await authHeaders()),
    },
    body: JSON.stringify(opts),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to revert changes");
  }
  return res.json();
}

export async function fetchRoomModels(
  roomId: string,
  agentId?: string,
): Promise<ModelInfo[]> {
  const qs = agentId ? `?agentId=${encodeURIComponent(agentId)}` : "";
  const res = await fetch(`${API_BASE}/rooms/${roomId}/models${qs}`, {
    headers: await authHeaders(),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to list models");
  }
  const data = await res.json();
  return data.models as ModelInfo[];
}

export async function updateRoomModel(
  roomId: string,
  modelId: string,
  agentId?: string,
): Promise<RoomInfo> {
  const res = await fetch(`${API_BASE}/rooms/${roomId}/model`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      ...(await authHeaders()),
    },
    body: JSON.stringify({ modelId, ...(agentId ? { agentId } : {}) }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to update model");
  }
  return res.json();
}

export async function updateRoomCursorSession(
  roomId: string,
  cursorSessionId: string | null,
  agentId?: string,
): Promise<RoomInfo> {
  const res = await fetch(`${API_BASE}/rooms/${roomId}/cursor-session`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      ...(await authHeaders()),
    },
    body: JSON.stringify({ cursorSessionId, agentId }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to update Cursor chat");
  }
  return res.json();
}

export async function fetchRoomAgents(
  roomId: string,
): Promise<import("../../shared/events").AgentInfo[]> {
  const res = await fetch(`${API_BASE}/rooms/${roomId}/agents`, {
    headers: await authHeaders(),
  });
  if (!res.ok) throw new Error("Failed to fetch agents");
  return res.json();
}

export async function addRoomAgent(
  roomId: string,
  data: {
    label: string;
    backend?: string;
    scopePath?: string;
    modelId?: string;
    anthropicApiKey?: string;
    /** Cursor BYOK — reuse/replace the key saved from previous sessions. */
    apiKey?: string;
    planMode?: boolean;
    /** First run receives the repo map + accepted room memory (default true). */
    seedContext?: boolean;
  },
): Promise<import("../../shared/events").AgentInfo> {
  const res = await fetch(`${API_BASE}/rooms/${roomId}/agents`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(await authHeaders()),
    },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to add agent");
  }
  return res.json();
}

export async function updateRoomAgent(
  roomId: string,
  agentId: string,
  data: {
    label?: string;
    scopePath?: string | null;
    modelId?: string;
    cursorSessionId?: string | null;
    planMode?: boolean;
  },
): Promise<import("../../shared/events").AgentInfo> {
  const res = await fetch(`${API_BASE}/rooms/${roomId}/agents/${agentId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      ...(await authHeaders()),
    },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to update agent");
  }
  return res.json();
}

export async function validateAgentScope(
  roomId: string,
  scopePath: string | null | undefined,
  excludeAgentId?: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const res = await fetch(`${API_BASE}/rooms/${roomId}/agents/validate-scope`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(await authHeaders()),
    },
    body: JSON.stringify({ scopePath: scopePath ?? null, excludeAgentId }),
  });
  const data = await res.json().catch(() => ({}));
  if (res.ok) return { ok: true };
  return {
    ok: false,
    error: data.error || "Scope overlaps with another agent",
  };
}

export async function forceReleaseFileLock(
  roomId: string,
  path: string,
): Promise<void> {
  const res = await fetch(`${API_BASE}/rooms/${roomId}/file-locks/force-release`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(await authHeaders()),
    },
    body: JSON.stringify({ path }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to release lock");
  }
}

export async function stopRoomAgent(
  roomId: string,
  agentId: string,
): Promise<void> {
  const res = await fetch(
    `${API_BASE}/rooms/${roomId}/agents/${agentId}/stop`,
    {
      method: "POST",
      headers: await authHeaders(),
    },
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to stop agent");
  }
}

export async function integrateRoomAgent(
  roomId: string,
  agentId: string,
): Promise<{
  ok: true;
  status: "started" | "queued";
  integratorAgentId: string;
  integrationBranch: string;
  prUrl: string | null;
  queuedBehind?: { agentId: string; label: string };
  job?: import("../../shared/events").IntegrationJobInfo;
}> {
  const res = await fetch(
    `${API_BASE}/rooms/${roomId}/agents/${agentId}/integrate`,
    {
      method: "POST",
      headers: await authHeaders(),
    },
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to integrate agent");
  }
  return res.json();
}

export async function abortRoomAgent(
  roomId: string,
  agentId: string,
): Promise<void> {
  const res = await fetch(
    `${API_BASE}/rooms/${roomId}/agents/${agentId}/abort`,
    {
      method: "POST",
      headers: await authHeaders(),
    },
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to abort agent");
  }
}

// ---------------------------------------------------------------------------
// Organizations / workspaces
// ---------------------------------------------------------------------------

export async function fetchOrgs(): Promise<OrgInfo[]> {
  const res = await fetch(`${API_BASE}/orgs`, {
    headers: await authHeaders(),
  });
  if (!res.ok) throw new Error("Failed to fetch organizations");
  const data = await res.json();
  return data.orgs ?? [];
}

export async function fetchJoinableOrgs(): Promise<
  Array<{ id: string; name: string; slug: string; allowedDomains: string[] }>
> {
  const res = await fetch(`${API_BASE}/orgs/joinable`, {
    headers: await authHeaders(),
  });
  if (!res.ok) throw new Error("Failed to fetch joinable organizations");
  const data = await res.json();
  return data.orgs ?? [];
}

export async function createOrg(data: {
  name: string;
  allowedDomains?: string[];
}): Promise<OrgInfo> {
  const res = await fetch(`${API_BASE}/orgs`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(await authHeaders()),
    },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to create organization");
  }
  const body = await res.json();
  return body.org as OrgInfo;
}

export async function fetchOrg(orgId: string): Promise<OrgInfo> {
  const res = await fetch(`${API_BASE}/orgs/${orgId}`, {
    headers: await authHeaders(),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Organization not found");
  }
  const body = await res.json();
  return body.org as OrgInfo;
}

export async function updateOrg(
  orgId: string,
  data: { name?: string; allowedDomains?: string[] },
): Promise<OrgInfo> {
  const res = await fetch(`${API_BASE}/orgs/${orgId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      ...(await authHeaders()),
    },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to update organization");
  }
  const body = await res.json();
  return body.org as OrgInfo;
}

export async function joinOrgByDomain(orgId: string): Promise<OrgInfo> {
  const res = await fetch(`${API_BASE}/orgs/${orgId}/join-by-domain`, {
    method: "POST",
    headers: await authHeaders(),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to join organization");
  }
  const body = await res.json();
  return body.org as OrgInfo;
}

export async function fetchOrgMembers(orgId: string): Promise<OrgMemberInfo[]> {
  const res = await fetch(`${API_BASE}/orgs/${orgId}/members`, {
    headers: await authHeaders(),
  });
  if (!res.ok) throw new Error("Failed to fetch members");
  const data = await res.json();
  return data.members ?? [];
}

export async function updateOrgMemberRole(
  orgId: string,
  userId: string,
  role: OrgRole,
): Promise<void> {
  const res = await fetch(`${API_BASE}/orgs/${orgId}/members/${userId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      ...(await authHeaders()),
    },
    body: JSON.stringify({ role }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to update member");
  }
}

export async function removeOrgMember(
  orgId: string,
  userId: string,
): Promise<void> {
  const res = await fetch(`${API_BASE}/orgs/${orgId}/members/${userId}`, {
    method: "DELETE",
    headers: await authHeaders(),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to remove member");
  }
}

export async function transferOrgOwnership(
  orgId: string,
  userId: string,
): Promise<OrgInfo> {
  const res = await fetch(`${API_BASE}/orgs/${orgId}/transfer`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(await authHeaders()),
    },
    body: JSON.stringify({ userId }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to transfer ownership");
  }
  const body = await res.json();
  return body.org as OrgInfo;
}

export async function deleteOrg(
  orgId: string,
  confirm: string,
): Promise<void> {
  const res = await fetch(`${API_BASE}/orgs/${orgId}`, {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
      ...(await authHeaders()),
    },
    body: JSON.stringify({ confirm }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to delete team");
  }
}

export async function fetchOrgInvites(orgId: string): Promise<OrgInviteInfo[]> {
  const res = await fetch(`${API_BASE}/orgs/${orgId}/invites`, {
    headers: await authHeaders(),
  });
  if (!res.ok) throw new Error("Failed to fetch invites");
  const data = await res.json();
  return data.invites ?? [];
}

export async function createOrgInvite(
  orgId: string,
  data?: { role?: OrgRole; maxUses?: number | null },
): Promise<OrgInviteInfo> {
  const res = await fetch(`${API_BASE}/orgs/${orgId}/invites`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(await authHeaders()),
    },
    body: JSON.stringify(data ?? {}),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to create invite");
  }
  const body = await res.json();
  return body.invite as OrgInviteInfo;
}

export async function revokeOrgInvite(
  orgId: string,
  code: string,
): Promise<void> {
  const res = await fetch(`${API_BASE}/orgs/${orgId}/invites/${code}`, {
    method: "DELETE",
    headers: await authHeaders(),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to revoke invite");
  }
}

export async function joinOrgViaInvite(code: string): Promise<OrgInfo> {
  const res = await fetch(`${API_BASE}/orgs/invites/${code}/join`, {
    method: "POST",
    headers: await authHeaders(),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to join organization");
  }
  const body = await res.json();
  return body.org as OrgInfo;
}

export async function setOrgCursorKey(
  orgId: string,
  apiKey: string,
): Promise<{ cursorKeyConfigured: boolean; cursorKeyHint: string | null }> {
  const res = await fetch(`${API_BASE}/orgs/${orgId}/cursor-key`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      ...(await authHeaders()),
    },
    body: JSON.stringify({ apiKey }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to save org key");
  }
  return res.json();
}

export async function clearOrgCursorKey(orgId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/orgs/${orgId}/cursor-key`, {
    method: "DELETE",
    headers: await authHeaders(),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to clear org key");
  }
}

export async function setOrgAnthropicKey(
  orgId: string,
  apiKey: string,
): Promise<{
  anthropicKeyConfigured: boolean;
  anthropicKeyHint: string | null;
}> {
  const res = await fetch(`${API_BASE}/orgs/${orgId}/anthropic-key`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      ...(await authHeaders()),
    },
    body: JSON.stringify({ apiKey }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to save org Anthropic key");
  }
  return res.json();
}

export async function clearOrgAnthropicKey(orgId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/orgs/${orgId}/anthropic-key`, {
    method: "DELETE",
    headers: await authHeaders(),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to clear org Anthropic key");
  }
}

async function parseApiError(res: Response, fallback: string): Promise<string> {
  const err = await res.json().catch(() => ({}));
  return (err as { error?: string }).error || fallback;
}

export async function fetchRoomContext(
  roomId: string,
): Promise<import("../../shared/roomContext").RoomContextSnapshot> {
  const res = await fetch(`${API_BASE}/rooms/${roomId}/context`, {
    headers: await authHeaders(),
  });
  if (!res.ok) throw new Error(await parseApiError(res, "Failed to load context"));
  return res.json();
}

export async function createRoomMemory(
  roomId: string,
  data: {
    kind: string;
    title: string;
    content: string;
    pinned?: boolean;
    agentId?: string;
    sourcePath?: string;
  },
): Promise<import("../../shared/roomContext").MemoryEntryInfo> {
  const res = await fetch(`${API_BASE}/rooms/${roomId}/memory`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(await authHeaders()),
    },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(await parseApiError(res, "Failed to create memory"));
  return res.json();
}

export async function updateRoomMemory(
  roomId: string,
  entryId: string,
  data: {
    expectedRevision: number;
    title?: string;
    content?: string;
    pinned?: boolean;
  },
): Promise<import("../../shared/roomContext").MemoryEntryInfo> {
  const res = await fetch(
    `${API_BASE}/rooms/${roomId}/memory/${encodeURIComponent(entryId)}`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        ...(await authHeaders()),
      },
      body: JSON.stringify(data),
    },
  );
  if (!res.ok) throw new Error(await parseApiError(res, "Failed to update memory"));
  return res.json();
}

export async function acceptRoomMemory(
  roomId: string,
  entryId: string,
  expectedRevision?: number,
): Promise<import("../../shared/roomContext").MemoryEntryInfo> {
  const res = await fetch(
    `${API_BASE}/rooms/${roomId}/memory/${encodeURIComponent(entryId)}/accept`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(await authHeaders()),
      },
      body: JSON.stringify({ expectedRevision }),
    },
  );
  if (!res.ok) throw new Error(await parseApiError(res, "Failed to accept memory"));
  return res.json();
}

export async function archiveRoomMemory(
  roomId: string,
  entryId: string,
  expectedRevision?: number,
): Promise<import("../../shared/roomContext").MemoryEntryInfo> {
  const res = await fetch(
    `${API_BASE}/rooms/${roomId}/memory/${encodeURIComponent(entryId)}/archive`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(await authHeaders()),
      },
      body: JSON.stringify({ expectedRevision }),
    },
  );
  if (!res.ok) throw new Error(await parseApiError(res, "Failed to archive memory"));
  return res.json();
}

export async function refreshRoomRepoMap(
  roomId: string,
): Promise<import("../../shared/roomContext").RepoMapInfo> {
  const res = await fetch(`${API_BASE}/rooms/${roomId}/repo-map`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(await authHeaders()),
    },
  });
  if (!res.ok) throw new Error(await parseApiError(res, "Failed to refresh repo map"));
  const data = await res.json();
  return data.map;
}

export async function fetchHandoffDraft(
  roomId: string,
  agentId: string,
): Promise<import("../../shared/roomContext").HandoffDraft> {
  const res = await fetch(
    `${API_BASE}/rooms/${roomId}/memory/handoff-draft?agentId=${encodeURIComponent(agentId)}`,
    { headers: await authHeaders() },
  );
  if (!res.ok) throw new Error(await parseApiError(res, "Failed to load handoff draft"));
  return res.json();
}

export async function captureHandoffDraft(
  roomId: string,
  agentId: string,
  data?: { title?: string; content?: string; asProposal?: boolean },
): Promise<import("../../shared/roomContext").MemoryEntryInfo> {
  const res = await fetch(`${API_BASE}/rooms/${roomId}/memory/handoff-draft`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(await authHeaders()),
    },
    body: JSON.stringify({ agentId, ...data }),
  });
  if (!res.ok) throw new Error(await parseApiError(res, "Failed to capture handoff"));
  return res.json();
}

