export const BOARD_ROOM_IDS_KEY = "steer:boardRoomIds";
export const BOARD_FOCUS_ROOM_ID_KEY = "steer:boardFocusRoomId";
export const MAX_BOARD_ROOMS = 8;

function readJsonArray(key: string): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is string => typeof id === "string" && id.length > 0);
  } catch {
    return [];
  }
}

function writeJson(key: string, value: unknown): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore quota / private mode */
  }
}

export function readBoardRoomIds(): string[] {
  return Array.from(new Set(readJsonArray(BOARD_ROOM_IDS_KEY))).slice(
    0,
    MAX_BOARD_ROOMS,
  );
}

export function writeBoardRoomIds(ids: string[]): void {
  const unique = Array.from(new Set(ids)).slice(0, MAX_BOARD_ROOMS);
  writeJson(BOARD_ROOM_IDS_KEY, unique);
  const focus = readBoardFocusRoomId();
  if (focus && !unique.includes(focus)) {
    writeBoardFocusRoomId(null);
  }
}

export function readBoardFocusRoomId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(BOARD_FOCUS_ROOM_ID_KEY);
    return raw?.trim() || null;
  } catch {
    return null;
  }
}

export function writeBoardFocusRoomId(id: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (!id) window.localStorage.removeItem(BOARD_FOCUS_ROOM_ID_KEY);
    else window.localStorage.setItem(BOARD_FOCUS_ROOM_ID_KEY, id);
  } catch {
    /* ignore */
  }
}

export function addBoardRoomId(id: string): string[] {
  const next = readBoardRoomIds();
  if (!next.includes(id) && next.length < MAX_BOARD_ROOMS) next.push(id);
  writeBoardRoomIds(next);
  return next;
}

export function removeBoardRoomId(id: string): string[] {
  const next = readBoardRoomIds().filter((item) => item !== id);
  writeBoardRoomIds(next);
  return next;
}
