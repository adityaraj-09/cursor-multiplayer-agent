import type { RoomInfo } from "../../shared/events";

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

export async function createRoom(data: {
  name: string;
  repoPath?: string;
  agentCommand?: string;
}): Promise<RoomInfo> {
  const res = await fetch(`${API_BASE}/rooms`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || "Failed to create room");
  }
  return res.json();
}

export async function stopRoom(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/rooms/${id}/stop`, { method: "POST" });
  if (!res.ok) throw new Error("Failed to stop room");
}
