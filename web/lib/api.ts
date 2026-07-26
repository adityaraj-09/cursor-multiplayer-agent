import type {
  AuthMode,
  AgentRuntime,
  ModelInfo,
  RepoInfo,
  RoomInfo,
  UserInfo,
} from "../../shared/events";

const API_BASE = "/api";

const TOKEN_KEY = "shared-agent-token";
const USER_KEY = "shared-agent-user";

export function getStoredToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function getStoredUser(): UserInfo | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function storeAuth(token: string, user: UserInfo): void {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearAuth(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

function authHeaders(): Record<string, string> {
  const token = getStoredToken();
  if (!token) return {};
  return { Authorization: `Bearer ${token}` };
}

export async function register(
  email: string,
  name: string,
  password: string,
): Promise<{ user: UserInfo; token: string }> {
  const res = await fetch(`${API_BASE}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, name, password }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Registration failed");
  }
  const data = await res.json();
  storeAuth(data.token, data.user);
  return data;
}

export async function login(
  email: string,
  password: string,
): Promise<{ user: UserInfo; token: string }> {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Login failed");
  }
  const data = await res.json();
  storeAuth(data.token, data.user);
  return data;
}

export async function logout(): Promise<void> {
  try {
    await fetch(`${API_BASE}/auth/logout`, {
      method: "POST",
      headers: { ...authHeaders() },
    });
  } finally {
    clearAuth();
  }
}

export async function fetchMe(): Promise<UserInfo | null> {
  const token = getStoredToken();
  if (!token) return null;
  const res = await fetch(`${API_BASE}/auth/me`, {
    headers: { ...authHeaders() },
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.user;
}

export async function joinViaInvite(code: string): Promise<{ roomId: string }> {
  const res = await fetch(`${API_BASE}/auth/invite/${code}/join`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
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
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ maxUses }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to create invite");
  }
  return res.json();
}

export async function fetchRooms(): Promise<RoomInfo[]> {
  const res = await fetch(`${API_BASE}/rooms`, { headers: authHeaders() });
  if (!res.ok) throw new Error("Failed to fetch rooms");
  return res.json();
}

export async function fetchRoom(id: string): Promise<RoomInfo> {
  const res = await fetch(`${API_BASE}/rooms/${id}`, { headers: authHeaders() });
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
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ apiKey }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to save server key");
  }
  return res.json();
}

export async function clearServerKey(): Promise<void> {
  const res = await fetch(`${API_BASE}/auth/server-key`, { method: "DELETE" });
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
    headers: { "Content-Type": "application/json", ...authHeaders() },
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
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error("Failed to stop room");
}

export async function fetchRoomModels(roomId: string): Promise<ModelInfo[]> {
  const res = await fetch(`${API_BASE}/rooms/${roomId}/models`);
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
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ modelId }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to update model");
  }
  return res.json();
}
