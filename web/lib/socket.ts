import { io, Socket } from "socket.io-client";
import type {
  ServerToClientEvents,
  ClientToServerEvents,
} from "../../shared/events";

export type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

// Next.js rewrites do not proxy WebSocket upgrades — connect to Express directly.
const SOCKET_URL =
  process.env.NEXT_PUBLIC_SOCKET_URL ||
  (typeof window !== "undefined" ? window.location.origin : "http://localhost:3000");

type RegistryEntry = {
  socket: AppSocket;
  key: string;
  refs: number;
};

const registry = new Map<string, RegistryEntry>();

function socketKey(
  roomId: string,
  name: string,
  getToken?: () => Promise<string | null>,
): string {
  return `${roomId}:${name}:${getToken ? "auth" : "anon"}`;
}

function createSocket(
  roomId: string,
  name: string,
  getToken?: () => Promise<string | null>,
): AppSocket {
  return io(SOCKET_URL, {
    query: { roomId, name },
    auth: (cb) => {
      if (!getToken) {
        cb({});
        return;
      }
      void getToken()
        .then((token) => cb(token ? { token } : {}))
        .catch(() => cb({}));
    },
    transports: ["websocket"],
    path: "/socket.io/",
    reconnection: true,
    reconnectionAttempts: 10,
  });
}

/**
 * Acquire a per-room socket. Multiple callers can share the same room
 * connection via ref-count. Different rooms stay independent.
 */
export function acquireSocket(
  roomId: string,
  name: string,
  getToken?: () => Promise<string | null>,
): AppSocket {
  const key = socketKey(roomId, name, getToken);
  const existing = registry.get(roomId);
  if (existing) {
    const reusable =
      existing.key === key &&
      (existing.socket.connected || existing.socket.active);
    if (reusable) {
      existing.refs += 1;
      return existing.socket;
    }
    existing.socket.disconnect();
    registry.delete(roomId);
  }

  const socket = createSocket(roomId, name, getToken);
  registry.set(roomId, { socket, key, refs: 1 });
  return socket;
}

export function releaseSocket(roomId: string): void {
  const existing = registry.get(roomId);
  if (!existing) return;
  existing.refs -= 1;
  if (existing.refs > 0) return;
  existing.socket.disconnect();
  registry.delete(roomId);
}

/** @deprecated Prefer acquireSocket — kept for callers that still use getSocket. */
export function getSocket(
  roomId: string,
  name: string,
  getToken?: () => Promise<string | null>,
): AppSocket {
  return acquireSocket(roomId, name, getToken);
}

export function disconnectSocket(roomId?: string): void {
  if (roomId) {
    const existing = registry.get(roomId);
    if (!existing) return;
    existing.socket.disconnect();
    registry.delete(roomId);
    return;
  }
  for (const [id, entry] of registry) {
    entry.socket.disconnect();
    registry.delete(id);
  }
}

export function hasSocket(roomId: string): boolean {
  return registry.has(roomId);
}
