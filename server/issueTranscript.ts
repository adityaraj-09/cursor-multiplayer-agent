import { Agent, type Run } from "@cursor/sdk";
import {
  emptyIssueTranscript,
  transcriptItemsFromListedRuns,
  type IssueTranscript,
  type IssueTranscriptRun,
} from "../shared/issueTranscript.js";
import { log } from "./logger.js";

const MAX_RUNS = 8;

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

/** Pull Cursor cloud run history for a stored `cursorAgentId`. */
export async function loadIssueTranscript(input: {
  cursorAgentId: string;
  apiKey: string;
  live: boolean;
}): Promise<IssueTranscript> {
  const started = Date.now();
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
  const runInfos = runs.map(toRunInfo);

  log("issues", "transcript listed", {
    cursorAgentId: input.cursorAgentId,
    runs: runInfos.length,
    ms: Date.now() - started,
  });

  return {
    cursorAgentId: input.cursorAgentId,
    available: true,
    live: input.live || runInfos.some((run) => run.status === "running"),
    error: null,
    runs: runInfos,
    items: transcriptItemsFromListedRuns(runInfos),
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
