export type IssueTranscriptItemKind =
  | "user"
  | "assistant"
  | "thinking"
  | "tool"
  | "error";

export type IssueTranscriptToolStatus = "running" | "done" | "error";

export interface IssueTranscriptItem {
  id: string;
  kind: IssueTranscriptItemKind;
  text: string;
  toolName?: string;
  detail?: string;
  path?: string;
  status?: IssueTranscriptToolStatus;
  runId?: string;
}

export interface IssueTranscriptRun {
  id: string;
  status: "running" | "finished" | "error" | "cancelled";
  createdAt?: number | null;
  durationMs?: number | null;
  result?: string | null;
  error?: string | null;
}

export interface IssueTranscript {
  cursorAgentId: string | null;
  available: boolean;
  live: boolean;
  error?: string | null;
  runs: IssueTranscriptRun[];
  items: IssueTranscriptItem[];
}

export function emptyIssueTranscript(
  partial?: Partial<IssueTranscript>,
): IssueTranscript {
  return {
    cursorAgentId: null,
    available: false,
    live: false,
    error: null,
    runs: [],
    items: [],
    ...partial,
  };
}

export function parseStoredTranscriptItems(raw: unknown): IssueTranscriptItem[] {
  if (raw == null) return [];
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return [];
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(parsed)) return [];
  const items: IssueTranscriptItem[] = [];
  for (const row of parsed) {
    if (!isRecord(row)) continue;
    const kind = asText(row.kind);
    if (
      kind !== "user" &&
      kind !== "assistant" &&
      kind !== "thinking" &&
      kind !== "tool" &&
      kind !== "error"
    ) {
      continue;
    }
    const text = asText(row.text);
    const toolName = asText(row.toolName);
    if (!text && kind !== "tool") continue;
    items.push({
      id: asText(row.id) || `stored:${items.length + 1}`,
      kind,
      text: text || toolName || "tool",
      toolName: toolName || undefined,
      detail: asText(row.detail) || undefined,
      path: asText(row.path) || undefined,
      status:
        row.status === "running" || row.status === "done" || row.status === "error"
          ? row.status
          : undefined,
      runId: asText(row.runId) || undefined,
    });
  }
  return items;
}

export function applyIssueStreamEvent(
  items: IssueTranscriptItem[],
  event:
    | { kind: "user"; text: string; runId?: string }
    | { kind: "assistant"; text: string; runId?: string }
    | {
        kind: "tool_start" | "tool_done";
        callId: string;
        name: string;
        detail?: string;
        path?: string;
        runId?: string;
      }
    | { kind: "error"; text: string; runId?: string },
): IssueTranscriptItem[] {
  const next = items.slice();
  if (event.kind === "user") {
    const text = event.text.trim();
    if (!text) return next;
    next.push({
      id: `${event.runId || "run"}:user:${next.length}`,
      kind: "user",
      text,
      runId: event.runId,
    });
    return next;
  }
  if (event.kind === "assistant") {
    const text = event.text.trim();
    if (!text) return next;
    for (let i = next.length - 1; i >= 0; i--) {
      const item = next[i]!;
      if (item.kind === "assistant" && (!event.runId || item.runId === event.runId)) {
        next[i] = { ...item, text };
        return next;
      }
      if (item.kind === "user") break;
    }
    next.push({
      id: `${event.runId || "run"}:assistant:${next.length}`,
      kind: "assistant",
      text,
      runId: event.runId,
    });
    return next;
  }
  if (event.kind === "error") {
    const text = event.text.trim();
    if (!text) return next;
    next.push({
      id: `${event.runId || "run"}:error:${next.length}`,
      kind: "error",
      text,
      runId: event.runId,
    });
    return next;
  }
  const id = `${event.runId || "run"}:tool:${event.callId}`;
  const idx = next.findIndex((item) => item.id === id);
  const row: IssueTranscriptItem = {
    id,
    kind: "tool",
    text: event.detail || event.path || event.name,
    toolName: event.name,
    detail: event.detail,
    path: event.path,
    status: event.kind === "tool_start" ? "running" : "done",
    runId: event.runId,
  };
  if (idx >= 0) next[idx] = row;
  else next.push(row);
  return next;
}

/**
 * Build a chat timeline from listed/hydrated Cursor run metadata.
 * `run.conversation()` is avoided here — on cloud that replays SSE.
 */
export function transcriptItemsFromListedRuns(
  runs: Array<Pick<IssueTranscriptRun, "id" | "status" | "result" | "error">>,
): IssueTranscriptItem[] {
  const items: IssueTranscriptItem[] = [];
  for (const run of runs) {
    const result = run.result?.trim();
    if (result) {
      items.push({
        id: `${run.id}:result`,
        kind: "assistant",
        text: result,
        runId: run.id,
      });
    }
    const error = run.error?.trim();
    if (run.status === "error" && error) {
      items.push({
        id: `${run.id}:error`,
        kind: "error",
        text: error,
        runId: run.id,
      });
    }
    if (run.status === "running" && !result) {
      items.push({
        id: `${run.id}:running`,
        kind: "tool",
        text: "Run in progress",
        toolName: "run",
        status: "running",
        runId: run.id,
      });
    }
  }
  return items;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function toolPath(args: unknown, result: unknown): string | undefined {
  const fromArgs = pathFromRecord(args);
  if (fromArgs) return fromArgs;
  if (!isRecord(result)) return undefined;
  if (isRecord(result.value)) return pathFromRecord(result.value);
  return pathFromRecord(result);
}

function pathFromRecord(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  for (const key of [
    "path",
    "filePath",
    "file_path",
    "target_file",
    "targetFile",
  ]) {
    const raw = value[key];
    if (typeof raw === "string" && raw.trim()) return raw.trim();
  }
  return undefined;
}

function toolDetail(name: string, args: unknown): string {
  if (!isRecord(args)) return "";
  const command = asText(args.command).trim();
  if (command) return command.slice(0, 200);
  const query = asText(
    args.pattern ??
      args.globPattern ??
      args.glob_pattern ??
      args.query ??
      args.targetDirectory,
  ).trim();
  if (query) return query.slice(0, 200);
  const path = pathFromRecord(args);
  if (path) return path;
  if (name === "updateTodos" || name === "todo") {
    const todos = Array.isArray(args.todos) ? args.todos : [];
    return todos.length
      ? `${todos.length} todo${todos.length === 1 ? "" : "s"}`
      : "Updating todos";
  }
  return "";
}

function toolStatus(result: unknown): IssueTranscriptToolStatus {
  if (!isRecord(result)) return "running";
  if (result.status === "error" || result.status === "failure") return "error";
  if (result.status === "success" || result.value !== undefined) return "done";
  return "done";
}

function toolResultDetail(result: unknown, fallback: string): string {
  if (!isRecord(result)) return fallback;
  if (result.status === "error") {
    const err = result.error;
    if (typeof err === "string" && err.trim()) return err.trim().slice(0, 240);
    if (isRecord(err) && typeof err.message === "string") {
      return err.message.trim().slice(0, 240);
    }
    return fallback || "error";
  }
  const value = isRecord(result.value) ? result.value : result;
  const stdout = asText(value.stdout).trim();
  if (stdout) return stdout.split("\n")[0]!.slice(0, 200);
  const path = pathFromRecord(value);
  if (path) return path;
  if (typeof value.linesCreated === "number") {
    return `${value.linesCreated} lines`;
  }
  if (typeof value.exitCode === "number") return `exit ${value.exitCode}`;
  return fallback;
}

function nextId(runId: string, seq: { n: number }): string {
  seq.n += 1;
  return `${runId}:${seq.n}`;
}

function pushUser(
  items: IssueTranscriptItem[],
  runId: string,
  seq: { n: number },
  text: string,
): void {
  const trimmed = text.trim();
  if (!trimmed) return;
  items.push({
    id: nextId(runId, seq),
    kind: "user",
    text: trimmed,
    runId,
  });
}

function convertAgentSteps(
  items: IssueTranscriptItem[],
  runId: string,
  seq: { n: number },
  steps: unknown,
): void {
  if (!Array.isArray(steps)) return;
  for (const step of steps) {
    if (!isRecord(step)) continue;
    const type = asText(step.type);
    const message = isRecord(step.message) ? step.message : {};

    if (type === "assistantMessage") {
      const text = asText(message.text).trim();
      if (!text) continue;
      items.push({
        id: nextId(runId, seq),
        kind: "assistant",
        text,
        runId,
      });
      continue;
    }

    if (type === "thinkingMessage") {
      const text = asText(message.text).trim();
      if (!text) continue;
      items.push({
        id: nextId(runId, seq),
        kind: "thinking",
        text,
        runId,
      });
      continue;
    }

    if (type !== "toolCall") continue;
    const toolName = asText(message.type) || "tool";
    const args = message.args;
    const result = message.result;
    const startDetail = toolDetail(toolName, args);
    const path = toolPath(args, result);
    const status = toolStatus(result);
    items.push({
      id: nextId(runId, seq),
      kind: "tool",
      text: startDetail || path || toolName,
      toolName,
      detail: toolResultDetail(result, startDetail || path || ""),
      path,
      status,
      runId,
    });
  }
}

function convertOneTurn(
  items: IssueTranscriptItem[],
  runId: string,
  seq: { n: number },
  raw: unknown,
): void {
  if (!isRecord(raw)) return;

  const type = asText(raw.type);
  const turn = isRecord(raw.turn) ? raw.turn : raw;

  if (type === "shellConversationTurn" || ("shellCommand" in turn && !("steps" in turn))) {
    const command = isRecord(turn.shellCommand)
      ? asText(turn.shellCommand.command).trim()
      : "";
    const output = isRecord(turn.shellOutput) ? turn.shellOutput : null;
    const stdout = output ? asText(output.stdout).trim() : "";
    const exitCode =
      output && typeof output.exitCode === "number" ? output.exitCode : undefined;
    items.push({
      id: nextId(runId, seq),
      kind: "tool",
      text: command || "shell",
      toolName: "shell",
      detail:
        stdout.split("\n")[0]?.slice(0, 200) ||
        (exitCode !== undefined ? `exit ${exitCode}` : command),
      status: output ? (exitCode === 0 || exitCode === undefined ? "done" : "error") : "running",
      runId,
    });
    return;
  }

  if (isRecord(turn.userMessage)) {
    pushUser(items, runId, seq, asText(turn.userMessage.text));
  } else if (typeof turn.text === "string" && type === "user") {
    pushUser(items, runId, seq, turn.text);
  }

  convertAgentSteps(items, runId, seq, turn.steps);
}

/**
 * Flatten Cursor `run.conversation()` turns into a read-only chat timeline.
 * Pure: does not call Cursor.
 */
export function conversationTurnsToItems(
  runId: string,
  turns: unknown,
): IssueTranscriptItem[] {
  if (!Array.isArray(turns)) return [];
  const items: IssueTranscriptItem[] = [];
  const seq = { n: 0 };
  for (const turn of turns) {
    convertOneTurn(items, runId, seq, turn);
  }
  return items;
}
