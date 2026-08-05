import type { AgentTodoItem } from "../events.js";

/** Backend kind for a room-level agent process. */
export type AgentBackendKind = "cursor" | "claude-code";

/** Git / PR metadata attached to a completed cloud agent run. */
export interface RunGitInfo {
  branches: Array<{
    repoUrl: string;
    branch?: string;
    prUrl?: string;
  }>;
}

export type { AgentTodoItem };

/**
 * Normalized agent stream events used internally by Steer.
 * Subagent events from within a single agent carry `subagent_nested`
 * and a parent tool-call id — they do NOT create a new Agent row.
 */
export type NormalizedAgentEvent =
  | { kind: "session"; sessionId: string }
  | { kind: "assistant_delta"; text: string }
  | { kind: "assistant_final"; text: string }
  | {
      kind: "tool_start";
      callId: string;
      name: string;
      detail: string;
      path?: string;
      todos?: AgentTodoItem[];
    }
  | {
      kind: "tool_done";
      callId: string;
      name: string;
      detail: string;
      path?: string;
      diffPatch?: string;
      todos?: AgentTodoItem[];
    }
  | {
      kind: "subagent_nested";
      parentCallId: string;
      callId: string;
      name: string;
      detail: string;
      path?: string;
      status: "started" | "completed";
    }
  | { kind: "error"; message: string }
  | { kind: "done"; result: string; git?: RunGitInfo };

export interface BuildArgsOptions {
  prompt: string;
  modelId: string;
  sessionId?: string | null;
  /** Cursor `--mode plan` / Claude `--permission-mode plan`. */
  mode?: "agent" | "plan";
}

/**
 * Abstraction over headless coding-agent CLIs.
 * Implementations spawn the process and parse NDJSON into NormalizedAgentEvent.
 */
export interface WorkerBackend {
  kind: AgentBackendKind;
  /** False until the backend is fully wired and tested. */
  available: boolean;
  /** Executable name (`cursor`, `claude`, …). */
  command: string;
  buildArgs(opts: BuildArgsOptions): string[];
  /**
   * Parse one JSON object from a stream-json line into zero or more
   * normalized events. Stateful parsers may hold buffers on the instance;
   * callers that need isolation should create a fresh backend per run.
   */
  parseLine(json: unknown, ctx?: ParseLineContext): NormalizedAgentEvent[];
}

export interface ParseLineContext {
  /** Accumulated assistant text so far (mutated by the parser). */
  assistantBuf: { value: string };
  /** Set true when a terminal result/done/error event is emitted. */
  gotTerminalEvent: { value: boolean };
  /** Optional stderr buffer used for error messages. */
  stderr?: string;
}
