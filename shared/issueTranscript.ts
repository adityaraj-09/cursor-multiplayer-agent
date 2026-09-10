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
