import type {
  AuthMode,
  AgentRuntime,
  ModelInfo,
  RepoInfo,
  RoomInfo,
} from "../../shared/events";

const API_BASE = "/api";

export async function fetchRooms(): Promise<RoomInfo[]> {
  const res = await fetch(`${API_BASE}/rooms`);
  if (!res.ok) throw new Error("Failed to fetch rooms");
  return res.json();
}

export async function fetchRoom(id: string): Promise<RoomInfo> {
  const res = await fetch(`${API_BASE}/rooms/${id}`);
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
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to create room");
  }
  return res.json();
}

export async function stopRoom(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/rooms/${id}/stop`, { method: "POST" });
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
