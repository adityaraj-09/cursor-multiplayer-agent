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

let socketInstance: AppSocket | null = null;
let currentKey: string | null = null;

/**
 * @param getToken Called on connect and every reconnect so Clerk JWTs stay fresh.
 */
export function getSocket(
  roomId: string,
  name: string,
  getToken?: () => Promise<string | null>,
): AppSocket {
  const key = `${roomId}:${name}:${getToken ? "auth" : "anon"}`;

  if (socketInstance && currentKey === key && socketInstance.connected) {
    return socketInstance;
  }

  if (socketInstance) {
    socketInstance.disconnect();
    socketInstance = null;
  }

  currentKey = key;
  socketInstance = io(SOCKET_URL, {
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

  return socketInstance;
}

export function disconnectSocket(): void {
  if (socketInstance) {
    socketInstance.disconnect();
    socketInstance = null;
    currentKey = null;
  }
}
