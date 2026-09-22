import { createHash, randomBytes, timingSafeEqual } from "crypto";
import {
  findSwarmAgentByTokenHash,
  getSwarm,
  updateSwarmAgent,
  type SwarmAgentRow,
  type SwarmRow,
} from "./store.js";

/** Long enough for a multi-hour cycle; rotated at the start of every cycle. */
export const SWARM_TOKEN_TTL_MS = 8 * 60 * 60 * 1000;
const TOKEN_PREFIX = "swt_";

export function hashSwarmToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Mint a fresh board credential for one agent. Only the hash is stored; the raw
 * token travels in the MCP `Authorization` header, which Cursor proxies without
 * exposing it to the agent VM.
 */
export function mintSwarmAgentToken(agentId: string, now = Date.now()): string {
  const token = `${TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
  updateSwarmAgent(agentId, {
    tokenHash: hashSwarmToken(token),
    tokenExpiresAt: now + SWARM_TOKEN_TTL_MS,
  });
  return token;
}

export function revokeSwarmAgentToken(agentId: string): void {
  updateSwarmAgent(agentId, { tokenHash: null, tokenExpiresAt: null });
}

export interface SwarmCaller {
  agent: SwarmAgentRow;
  swarm: SwarmRow;
}

export function parseBearer(header: unknown): string | null {
  if (typeof header !== "string") return null;
  const m = header.match(/^Bearer\s+(\S+)$/i);
  return m ? m[1]! : null;
}

export function resolveSwarmCaller(token: string | null, now = Date.now()): SwarmCaller | null {
  if (!token || !token.startsWith(TOKEN_PREFIX)) return null;
  const hash = hashSwarmToken(token);
  const agent = findSwarmAgentByTokenHash(hash);
  if (!agent?.tokenHash) return null;
  const a = Buffer.from(agent.tokenHash, "hex");
  const b = Buffer.from(hash, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  if (agent.status === "retired") return null;
  if (agent.tokenExpiresAt !== null && agent.tokenExpiresAt < now) return null;
  const swarm = getSwarm(agent.swarmId);
  if (!swarm) return null;
  return { agent, swarm };
}
