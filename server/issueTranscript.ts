import { Agent, type Run, type SDKMessage } from "@cursor/sdk";
import {
  emptyIssueTranscript,
  parseStoredTranscriptItems,
  transcriptItemsFromListedRuns,
  type IssueTranscript,
  type IssueTranscriptItem,
  type IssueTranscriptRun,
} from "../shared/issueTranscript.js";
import { log, logWarn } from "./logger.js";

const MAX_RUNS = 8;
const STREAM_TIMEOUT_MS = 12_000;
const MAX_STREAM_RUNS = 2;

function toRunInfo(run: Run): IssueTranscriptRun {
  return {
    id: run.id,
    status: run.status,
    createdAt: run.createdAt ?? null,
    durationMs: run.durationMs ?? null,
    result: run.result ?? null,
    error: run.error?.message ?? null,
  };
}

function extractAssistantText(message: SDKMessage): string {
  if (message.type !== "assistant") return "";
  return message.message.content
    .map((block) => (block.type === "text" ? block.text : ""))
    .join("");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hasUsableText(run: Run): boolean {
  return Boolean(run.result?.trim() || run.error?.message?.trim());
}

async function hydrateRun(
  run: Run,
  cursorAgentId: string,
  apiKey: string,
): Promise<Run> {
  if (hasUsableText(run)) return run;
  try {
    return await Agent.getRun(run.id, {
      runtime: "cloud",
      agentId: cursorAgentId,
      apiKey,
    });
  } catch (err) {
    logWarn("issues", "transcript getRun failed", {
      runId: run.id,
      err,
    });
    return run;
  }
}

async function itemsFromCloudStream(
  run: Run,
  timeoutMs: number,
): Promise<IssueTranscriptItem[]> {
  const items: IssueTranscriptItem[] = [];
  let assistantId: string | null = null;
  const work = (async () => {
    for await (const event of run.stream()) {
      if (event.type === "assistant") {
        const text = extractAssistantText(event).trim();
        if (!text) continue;
        if (assistantId) {
          const existing = items.find((item) => item.id === assistantId);
          if (existing) existing.text = text;
        } else {
          assistantId = `${run.id}:assistant`;
          items.push({
            id: assistantId,
            kind: "assistant",
            text,
            runId: run.id,
          });
        }
        continue;
      }
      if (event.type !== "tool_call") continue;
      const name = event.name || "tool";
      const args =
        event.args && typeof event.args === "object"
          ? (event.args as Record<string, unknown>)
          : undefined;
      const detail = String(
        args?.command ??
          args?.path ??
          args?.filePath ??
          args?.pattern ??
          args?.query ??
          "",
      ).trim();
      const path =
        typeof args?.path === "string"
          ? args.path
          : typeof args?.filePath === "string"
            ? args.filePath
            : undefined;
      const id = `${run.id}:tool:${event.call_id}`;
      const idx = items.findIndex((item) => item.id === id);
      const row: IssueTranscriptItem = {
        id,
        kind: "tool",
        text: detail || path || name,
        toolName: name,
        detail: detail || undefined,
        path,
        status: event.status === "running" ? "running" : "done",
        runId: run.id,
      };
      if (idx >= 0) items[idx] = row;
      else items.push(row);
    }
  })();
  await Promise.race([work.catch(() => undefined), sleep(timeoutMs)]);
  return items;
}

function fallbackItems(input: {
  writeupMd?: string | null;
  issueError?: string | null;
}): IssueTranscriptItem[] {
  const items: IssueTranscriptItem[] = [];
  const writeup = input.writeupMd?.trim();
  if (writeup) {
    items.push({
      id: "issue:writeup",
      kind: "assistant",
      text: writeup,
    });
  }
  const error = input.issueError?.trim();
  if (error) {
    items.push({
      id: "issue:error",
      kind: "error",
      text: error,
    });
  }
  return items;
}

/** Pull Cursor cloud run history for a stored `cursorAgentId`. */
export async function loadIssueTranscript(input: {
  cursorAgentId: string;
  apiKey: string;
  live: boolean;
  cachedItems?: IssueTranscriptItem[];
  writeupMd?: string | null;
  issueError?: string | null;
}): Promise<IssueTranscript> {
  const cached = parseStoredTranscriptItems(input.cachedItems ?? []);
  if (!input.live && cached.length > 0) {
    return {
      cursorAgentId: input.cursorAgentId,
      available: true,
      live: false,
      error: null,
      runs: [],
      items: cached,
    };
  }

  const started = Date.now();
  const listed = await Agent.listRuns(input.cursorAgentId, {
    runtime: "cloud",
    apiKey: input.apiKey,
    limit: MAX_RUNS,
  });

  const listedRuns = [...(listed.items ?? [])].sort((a, b) => {
    const ta = a.createdAt ?? 0;
    const tb = b.createdAt ?? 0;
    if (ta !== tb) return ta - tb;
    return a.id.localeCompare(b.id);
  });

  const runs = await Promise.all(
    listedRuns.map((run) =>
      hydrateRun(run, input.cursorAgentId, input.apiKey),
    ),
  );
  const runInfos = runs.map(toRunInfo);
  let items = transcriptItemsFromListedRuns(runInfos);

  if (
    items.length === 0 ||
    items.every((item) => item.kind === "tool" && item.status === "running")
  ) {
    const needsStream = !input.live && items.filter((item) => item.kind === "assistant").length === 0;
    if (needsStream) {
      const streamRuns = runs.slice(-MAX_STREAM_RUNS);
      const streamed = await Promise.all(
        streamRuns.map((run) => itemsFromCloudStream(run, STREAM_TIMEOUT_MS)),
      );
      const fromStream = streamed.flat();
      if (fromStream.length) items = fromStream;
    }
  }

  if (items.length === 0 && cached.length) items = cached;
  if (items.length === 0) {
    items = fallbackItems({
      writeupMd: input.writeupMd,
      issueError: input.issueError,
    });
  }

  log("issues", "transcript listed", {
    cursorAgentId: input.cursorAgentId,
    runs: runInfos.length,
    items: items.length,
    hydrated: runInfos.filter((run) => Boolean(run.result || run.error)).length,
    ms: Date.now() - started,
  });

  return {
    cursorAgentId: input.cursorAgentId,
    available: true,
    live: input.live || runInfos.some((run) => run.status === "running"),
    error:
      items.length === 0
        ? "Cursor returned runs but no transcript text yet"
        : null,
    runs: runInfos,
    items,
  };
}

export function transcriptUnavailable(input: {
  cursorAgentId?: string | null;
  live: boolean;
  error?: string | null;
  items?: IssueTranscriptItem[];
}): IssueTranscript {
  return emptyIssueTranscript({
    cursorAgentId: input.cursorAgentId ?? null,
    live: input.live,
    error: input.error ?? null,
    items: input.items ?? [],
  });
}
