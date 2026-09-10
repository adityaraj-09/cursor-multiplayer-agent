import { Agent, type Run } from "@cursor/sdk";
import {
  conversationTurnsToItems,
  emptyIssueTranscript,
  type IssueTranscript,
  type IssueTranscriptItem,
  type IssueTranscriptRun,
} from "../shared/issueTranscript.js";
import { logError } from "./logger.js";

const MAX_RUNS = 25;

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

function fallbackItems(run: Run): IssueTranscriptItem[] {
  const items: IssueTranscriptItem[] = [];
  const result = run.result?.trim();
  if (result) {
    items.push({
      id: `${run.id}:result`,
      kind: "assistant",
      text: result,
      runId: run.id,
    });
  }
  if (run.status === "error" && run.error?.message) {
    items.push({
      id: `${run.id}:error`,
      kind: "error",
      text: run.error.message,
      runId: run.id,
    });
  }
  return items;
}

/** Pull Cursor cloud run history for a stored `cursorAgentId`. */
export async function loadIssueTranscript(input: {
  cursorAgentId: string;
  apiKey: string;
  live: boolean;
}): Promise<IssueTranscript> {
  const listed = await Agent.listRuns(input.cursorAgentId, {
    runtime: "cloud",
    apiKey: input.apiKey,
    limit: MAX_RUNS,
  });

  const runs = [...(listed.items ?? [])].sort((a, b) => {
    const ta = a.createdAt ?? 0;
    const tb = b.createdAt ?? 0;
    if (ta !== tb) return ta - tb;
    return a.id.localeCompare(b.id);
  });

  const items: IssueTranscriptItem[] = [];
  for (const run of runs) {
    if (!run.supports("conversation")) {
      items.push(...fallbackItems(run));
      continue;
    }
    try {
      const turns = await run.conversation();
      const converted = conversationTurnsToItems(run.id, turns);
      if (converted.length > 0) {
        items.push(...converted);
      } else {
        items.push(...fallbackItems(run));
      }
    } catch (err) {
      logError("issues", "transcript conversation failed", {
        runId: run.id,
        err,
      });
      const fallback = fallbackItems(run);
      if (fallback.length) {
        items.push(...fallback);
      } else {
        items.push({
          id: `${run.id}:error`,
          kind: "error",
          text:
            err instanceof Error
              ? err.message
              : "Failed to load this Cursor run",
          runId: run.id,
        });
      }
    }
  }

  return {
    cursorAgentId: input.cursorAgentId,
    available: true,
    live: input.live || runs.some((run) => run.status === "running"),
    error: null,
    runs: runs.map(toRunInfo),
    items,
  };
}

export function transcriptUnavailable(input: {
  cursorAgentId?: string | null;
  live: boolean;
  error?: string | null;
}): IssueTranscript {
  return emptyIssueTranscript({
    cursorAgentId: input.cursorAgentId ?? null,
    live: input.live,
    error: input.error ?? null,
  });
}
