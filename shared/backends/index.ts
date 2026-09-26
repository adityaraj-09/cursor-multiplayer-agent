import type { AgentBackendKind, WorkerBackend } from "./types.js";
import { cursorAgentBackend } from "./cursor.js";
import { ClaudeCodeBackend, claudeCodeBackend } from "./claudeCode.js";
import { CodexBackend, codexBackend } from "./codex.js";

export type {
  AgentBackendKind,
  BuildArgsOptions,
  CliSandboxBackendKind,
  NormalizedAgentEvent,
  ParseLineContext,
  RunGitInfo,
  WorkerBackend,
} from "./types.js";
export {
  CLI_SANDBOX_BACKENDS,
  backendShortLabel,
  isCliSandboxBackend,
  parseAgentBackendKind,
} from "./types.js";
export {
  CursorAgentBackend,
  cursorAgentBackend,
  isEditTool,
  mergeAssistantText,
  diffFromToolArgs,
  diffFromToolResult,
  diffFromToolEvent,
  formatToolResultDetail,
  unwrapToolResultPayload,
} from "./cursor.js";
export { ClaudeCodeBackend, claudeCodeBackend };
export { CodexBackend, codexBackend };

/** Singletons for availability checks / UI. Cursor is stateless; Claude is not. */
const prototypes: Record<AgentBackendKind, WorkerBackend> = {
  cursor: cursorAgentBackend,
  "claude-code": claudeCodeBackend,
  codex: codexBackend,
};

/**
 * Return a backend suitable for one agent run.
 * Claude Code parsers are stateful (pending tool_use ids), so each call
 * for `claude-code` returns a fresh instance.
 */
export function getBackend(kind: AgentBackendKind): WorkerBackend {
  if (kind === "claude-code") return new ClaudeCodeBackend();
  if (kind === "codex") return new CodexBackend();
  return prototypes[kind] ?? cursorAgentBackend;
}

export function listBackends(): WorkerBackend[] {
  return Object.values(prototypes);
}

export function isBackendAvailable(kind: AgentBackendKind): boolean {
  return Boolean(prototypes[kind]?.available);
}
