export const BROADCAST_KEY = "steer-broadcast-enabled";
export const MAX_VISIBLE_SPLIT_PANES = 4;

export type RoomViewPrefs = {
  viewMode?: "tabs" | "split";
  visibleIds?: string[];
  selectedAgentId?: string | null;
  chatFilterAgentId?: string | null;
};

function roomViewKey(roomId: string): string {
  return `steer:roomView:${roomId}`;
}

export function readRoomViewPrefs(roomId: string): RoomViewPrefs {
  if (typeof window === "undefined" || !roomId) return {};
  try {
    const raw = window.localStorage.getItem(roomViewKey(roomId));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as RoomViewPrefs;
    if (!parsed || typeof parsed !== "object") return {};
    const viewMode =
      parsed.viewMode === "tabs" || parsed.viewMode === "split"
        ? parsed.viewMode
        : undefined;
    const visibleIds = Array.isArray(parsed.visibleIds)
      ? parsed.visibleIds.filter((id): id is string => typeof id === "string")
      : undefined;
    return {
      viewMode,
      visibleIds,
      selectedAgentId:
        typeof parsed.selectedAgentId === "string" || parsed.selectedAgentId === null
          ? parsed.selectedAgentId
          : undefined,
      chatFilterAgentId:
        typeof parsed.chatFilterAgentId === "string" ||
        parsed.chatFilterAgentId === null
          ? parsed.chatFilterAgentId
          : undefined,
    };
  } catch {
    return {};
  }
}

export function writeRoomViewPrefs(roomId: string, prefs: RoomViewPrefs): void {
  if (typeof window === "undefined" || !roomId) return;
  try {
    window.localStorage.setItem(roomViewKey(roomId), JSON.stringify(prefs));
  } catch {
    /* ignore quota / private mode */
  }
}

export function readBroadcastEnabled(): boolean {
  if (typeof window === "undefined") return true;
  try {
    const raw = window.localStorage.getItem(BROADCAST_KEY);
    if (raw === null) return true;
    return raw === "1";
  } catch {
    return true;
  }
}

export function writeBroadcastEnabled(enabled: boolean): void {
  try {
    window.localStorage.setItem(BROADCAST_KEY, enabled ? "1" : "0");
  } catch {
    /* ignore quota / private mode */
  }
}

export function syncVisibleIds(prev: string[], poolIds: string[]): string[] {
  const valid = prev.filter((id) => poolIds.includes(id));
  if (valid.length === 0) {
    return poolIds.slice(0, MAX_VISIBLE_SPLIT_PANES);
  }
  return valid.slice(0, MAX_VISIBLE_SPLIT_PANES);
}

export function pinVisibleId(prev: string[], id: string): string[] {
  if (prev.includes(id)) return prev;
  if (prev.length < MAX_VISIBLE_SPLIT_PANES) return [...prev, id];
  return [...prev.slice(1), id];
}

export function closeVisibleId(prev: string[], id: string): string[] {
  if (prev.length <= 1) return prev;
  return prev.filter((item) => item !== id);
}
