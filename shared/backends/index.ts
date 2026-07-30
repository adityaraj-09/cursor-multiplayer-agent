import type { AgentBackendKind, WorkerBackend } from "./types.js";
import { cursorAgentBackend } from "./cursor.js";
import { claudeCodeBackend } from "./claudeCode.js";

export type {
  AgentBackendKind,
  BuildArgsOptions,
  NormalizedAgentEvent,
  ParseLineContext,
  WorkerBackend,
} from "./types.js";
export { CursorAgentBackend, cursorAgentBackend, isEditTool, diffFromToolArgs } from "./cursor.js";
export { ClaudeCodeBackend, claudeCodeBackend } from "./claudeCode.js";

const backends: Record<AgentBackendKind, WorkerBackend> = {
  cursor: cursorAgentBackend,
  "claude-code": claudeCodeBackend,
};

export function getBackend(kind: AgentBackendKind): WorkerBackend {
  return backends[kind] ?? cursorAgentBackend;
}

export function listBackends(): WorkerBackend[] {
  return Object.values(backends);
}
