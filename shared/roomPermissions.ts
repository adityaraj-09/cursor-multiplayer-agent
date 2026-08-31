/**
 * Room collaboration permissions.
 *
 * Roles:
 * - owner: room host
 * - editor: can collaborate (subject to control mode)
 * - viewer: read-only
 *
 * Control modes:
 * - open: any editor can steer
 * - driver: only the current driver (or host) can steer
 * - host: only the host can steer
 */

export type RoomRole = "owner" | "editor" | "viewer";
export type RoomInviteRole = "editor" | "viewer";
export type ControlMode = "open" | "driver" | "host";

/** Legacy room_members.role values still present in older DBs. */
const LEGACY_MEMBER_ALIASES: Record<string, RoomRole> = {
  owner: "owner",
  editor: "editor",
  viewer: "viewer",
  member: "editor",
  admin: "editor",
};

export function normalizeRoomRole(
  raw: string | null | undefined,
): RoomRole | null {
  if (!raw) return null;
  return LEGACY_MEMBER_ALIASES[raw.trim().toLowerCase()] ?? null;
}

export function parseRoomInviteRole(
  raw: unknown,
  fallback: RoomInviteRole = "viewer",
): RoomInviteRole {
  if (typeof raw !== "string") return fallback;
  const n = raw.trim().toLowerCase();
  if (n === "editor") return "editor";
  if (n === "viewer") return "viewer";
  // Legacy invite rows may lack a role; treat historical "member" as editor.
  if (n === "member" || n === "admin") return "editor";
  return fallback;
}

export function parseControlMode(
  raw: unknown,
  fallback: ControlMode = "open",
): ControlMode {
  if (typeof raw !== "string") return fallback;
  const n = raw.trim().toLowerCase();
  if (n === "open" || n === "driver" || n === "host") return n;
  return fallback;
}

/** Default control mode for newly created rooms. Local agents are higher risk. */
export function defaultControlModeForRuntime(
  runtime: "local" | "cloud" | string,
): ControlMode {
  return runtime === "local" ? "driver" : "open";
}

export function roomRoleLabel(role: RoomRole): string {
  if (role === "owner") return "Host";
  if (role === "editor") return "Editor";
  return "Viewer";
}

export function roomRoleDescription(role: RoomRole): string {
  if (role === "owner") {
    return "Full control — manage agents, invites, and settings";
  }
  if (role === "editor") {
    return "Can steer agents according to the room control mode";
  }
  return "Can watch chat, diffs, and presence — cannot steer";
}

export function controlModeLabel(mode: ControlMode): string {
  if (mode === "open") return "Open collaboration";
  if (mode === "driver") return "Driver enforced";
  return "Host only";
}

export function controlModeDescription(mode: ControlMode): string {
  if (mode === "open") {
    return "Any editor can message agents";
  }
  if (mode === "driver") {
    return "Only the current driver (or host) can message agents";
  }
  return "Only the host can message agents";
}

export function canManageRoom(role: RoomRole | null | undefined): boolean {
  return role === "owner";
}

export function canRequestDrive(role: RoomRole | null | undefined): boolean {
  return role === "owner" || role === "editor";
}

/** Viewers can read room memory; only editors and the host can mutate it. */
export function canEditMemory(role: RoomRole | null | undefined): boolean {
  return role === "owner" || role === "editor";
}

export function canSteerWithRole(opts: {
  role: RoomRole | null | undefined;
  controlMode: ControlMode;
  isDrivingAgent: boolean;
}): boolean {
  const { role, controlMode, isDrivingAgent } = opts;
  if (!role) return false;
  if (role === "owner") return true;
  if (role === "viewer") return false;
  // editor
  if (controlMode === "host") return false;
  if (controlMode === "open") return true;
  return isDrivingAgent;
}

/** Abort follows the same gate as steering. */
export function canAbortWithRole(opts: {
  role: RoomRole | null | undefined;
  controlMode: ControlMode;
  isDrivingAgent: boolean;
}): boolean {
  return canSteerWithRole(opts);
}

export function steerDeniedReason(opts: {
  role: RoomRole | null | undefined;
  controlMode: ControlMode;
  isDrivingAgent: boolean;
}): string | null {
  if (canSteerWithRole(opts)) return null;
  if (!opts.role || opts.role === "viewer") {
    return "Viewers cannot steer agents";
  }
  if (opts.controlMode === "host") {
    return "Only the host can steer in host-only mode";
  }
  if (opts.controlMode === "driver" && !opts.isDrivingAgent) {
    return "Request control to steer this agent";
  }
  return "You do not have permission to steer this agent";
}
