import type {
  AuthMode,
  AgentRuntime,
  ModelInfo,
  RepoInfo,
  RoomInfo,
  UserInfo,
} from "../../shared/events";

const API_BASE = "/api";

type TokenGetter = () => Promise<string | null>;
let tokenGetter: TokenGetter | null = null;

/** Wired by AuthProvider to return the current Clerk JWT. */
export function setTokenGetter(fn: TokenGetter): void {
  tokenGetter = fn;
}

async function authHeaders(): Promise<Record<string, string>> {
  if (!tokenGetter) {
    console.warn("[api] No Clerk token getter registered yet");
    return {};
  }
  const token = await tokenGetter();
  if (!token) {
    console.warn("[api] Clerk getToken() returned empty — are you signed in?");
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
  const res = await fetch(`${API_BASE}/auth/invite/${code}/join`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(await authHeaders()),
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
  maxUses?: number,
): Promise<{ code: string }> {
  const res = await fetch(`${API_BASE}/auth/${roomId}/invite`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(await authHeaders()),
    },
    body: JSON.stringify({ maxUses }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to create invite");
  }
  return res.json();
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

export async function fetchAuthStatus(): Promise<{
  serverKeyConfigured: boolean;
  serverKeySource: "env" | "stored" | "none";
  serverKeyHint: string | null;
  encryptionConfigured: boolean;
  byokAvailable: boolean;
}> {
  const res = await fetch(`${API_BASE}/auth/status`);
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

export async function fetchModels(opts: {
  authMode: AuthMode;
  apiKey?: string;
}): Promise<ModelInfo[]> {
  const res = await fetch(`${API_BASE}/models`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
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
    headers: { "Content-Type": "application/json" },
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
  if (!res.ok) throw new Error("Failed to stop room");
}

export async function fetchRoomModels(roomId: string): Promise<ModelInfo[]> {
  const res = await fetch(`${API_BASE}/rooms/${roomId}/models`, {
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
): Promise<RoomInfo> {
  const res = await fetch(`${API_BASE}/rooms/${roomId}/model`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      ...(await authHeaders()),
    },
    body: JSON.stringify({ modelId }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to update model");
  }
  return res.json();
}
