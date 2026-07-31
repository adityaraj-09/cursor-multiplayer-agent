import type {
  AuthMode,
  AgentRuntime,
  CursorChatSession,
  ModelInfo,
  RepoInfo,
  RoomInfo,
  UserInfo,
} from "../../shared/events";

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
  maxUses?: number | null,
): Promise<{ code: string; roomId: string; maxUses: number | null; useCount: number }> {
  const res = await fetch(`${API_BASE}/auth/${roomId}/invite`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(await authHeaders()),
    },
    body: JSON.stringify({ maxUses: maxUses ?? null }),
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

export async function fetchRooms(): Promise<RoomInfo[]> {
  const res = await fetch(`${API_BASE}/rooms`, {
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

export async function fetchAuthStatus(): Promise<{
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
}> {
  const res = await fetch(`${API_BASE}/auth/status`, {
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

