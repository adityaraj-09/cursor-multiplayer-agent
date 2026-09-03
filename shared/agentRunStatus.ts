import type { AgentRunStatus, AgentStatus } from "./events.js";

/** Map persisted agent status onto the run states the chat input cares about. */
export function toAgentRunStatus(
  status?: AgentStatus | AgentRunStatus | string | null,
): AgentRunStatus {
  if (status === "running" || status === "error") return status;
  return "idle";
}

/**
 * Busy / error for the agent currently in view.
 * Live socket status wins; otherwise the agent snapshot.
 * Never falls back to another agent's room-level run status.
 */
export function resolveAgentRunStatus(
  agent: { id?: string; status?: AgentStatus | string } | null | undefined,
  statusByAgent: Record<string, AgentRunStatus> = {},
): AgentRunStatus {
  const live = agent?.id ? statusByAgent[agent.id] : undefined;
  if (live) return toAgentRunStatus(live);
  return toAgentRunStatus(agent?.status);
}
