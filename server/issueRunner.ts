import { nanoid } from "nanoid";
import * as db from "./db.js";
import { SdkAgentSession, type SdkStreamEvent, type RunGitInfo } from "./sdkAgent.js";
import { getOrgCursorKey } from "./orgKeys.js";
import { getUserByokKey } from "./userByok.js";
import { getServerApiKey } from "./serverKey.js";
import {
  buildIssueAttachmentPromptNotes,
  issueAttachmentsToPromptImages,
} from "./issueAttachments.js";
import {
  DEFAULT_MAX_CONCURRENT_ISSUES,
  DEFAULT_PICKUP_DELAY_MS,
  ISSUE_HEARTBEAT_MS,
  ISSUE_LEASE_MS,
  ISSUE_POLL_MS,
  MAX_ISSUE_ATTEMPTS,
  buildIssueFixPrompt,
  buildIssueWriteupPrompt,
  clampMaxConcurrent,
  clampPickupDelayMs,
  issueSettingsScopeKey,
  sanitizeIssueWriteup,
  looksLikeIssueWriteup,
  buildFallbackIssueWriteup,
  type IssueSettingsInfo,
} from "../shared/issues.js";
import type { IssueRow } from "./db.js";
import { log, logError, logWarn } from "./logger.js";
import {
  applyIssueStreamEvent,
  type IssueTranscriptItem,
} from "../shared/issueTranscript.js";

function addEvent(issueId: string, kind: string, message = ""): void {
  try {
    db.insertIssueEvent({
      id: `iev_${nanoid(10)}`,
      issueId,
      kind,
      message,
    });
  } catch (err) {
    logWarn("issues", "failed to record event", {
      kind,
      err,
    });
  }
}

export function settingsFromRow(
  scopeKey: string,
  row?: db.IssueSettingsRow,
): IssueSettingsInfo {
  return {
    scopeKey,
    defaultPickupDelayMs: clampPickupDelayMs(
      row?.default_pickup_delay_ms,
      DEFAULT_PICKUP_DELAY_MS,
    ),
    autoStart: row ? Boolean(row.auto_start) : true,
    modelId: row?.model_id?.trim() || "auto",
    maxConcurrent: clampMaxConcurrent(
      row?.max_concurrent ?? DEFAULT_MAX_CONCURRENT_ISSUES,
    ),
    updatedAt: row?.updated_at ?? 0,
  };
}

export function loadIssueSettings(input: {
  orgId?: string | null;
  userId: string;
}): IssueSettingsInfo {
  const scopeKey = issueSettingsScopeKey(input);
  return settingsFromRow(scopeKey, db.getIssueSettings(scopeKey));
}

export function resolveIssueCursorKey(issue: {
  org_id?: string | null;
  creator_id: string;
}): string {
  const orgId = issue.org_id?.trim() || "";
  if (orgId) {
    const orgKey = getOrgCursorKey(orgId);
    if (orgKey) return orgKey;
  }
  const byok = getUserByokKey(issue.creator_id);
  if (byok) return byok;
  const server = getServerApiKey();
  if (server) return server;
  throw new Error(
    orgId
      ? "No Cursor API key for this team — set a shared key in Team settings, or save your BYOK key"
      : "No Cursor API key — save a BYOK key or configure the server key",
  );
}

function pickPrFromGit(git?: RunGitInfo): { prUrl: string | null; branch: string | null } {
  const branch = git?.branches?.[0];
  return {
    prUrl: branch?.prUrl?.trim() || null,
    branch: branch?.branch?.trim() || null,
  };
}

function saveIssueTranscript(issueId: string, items: IssueTranscriptItem[]): void {
  try {
    db.updateIssue(issueId, { transcriptJson: JSON.stringify(items) });
  } catch (err) {
    logWarn("issues", "failed to save transcript", { err });
  }
}

async function runPrompt(
  session: SdkAgentSession,
  prompt: Parameters<SdkAgentSession["run"]>[0],
  sink?: { issueId: string; items: IssueTranscriptItem[] },
): Promise<{
  text: string;
  error: string | null;
  git?: RunGitInfo;
  askedQuestion: boolean;
}> {
  let text = "";
  let error: string | null = null;
  let git: RunGitInfo | undefined;
  let askedQuestion = false;
  const promptText = typeof prompt === "string" ? prompt : prompt.text;
  if (sink && promptText.trim()) {
    sink.items = applyIssueStreamEvent(sink.items, {
      kind: "user",
      text: promptText,
    });
  }
  await session.run(prompt, (event: SdkStreamEvent) => {
    if (event.kind === "assistant_delta" || event.kind === "assistant_final") {
      text = event.text || text;
      if (sink) {
        sink.items = applyIssueStreamEvent(sink.items, {
          kind: "assistant",
          text,
        });
      }
    } else if (event.kind === "done") {
      text = event.result || text;
      git = event.git;
      if (sink) {
        if (text) {
          sink.items = applyIssueStreamEvent(sink.items, {
            kind: "assistant",
            text,
          });
        }
        saveIssueTranscript(sink.issueId, sink.items);
      }
    } else if (event.kind === "error") {
      error = event.message;
      if (sink) {
        sink.items = applyIssueStreamEvent(sink.items, {
          kind: "error",
          text: event.message,
        });
        saveIssueTranscript(sink.issueId, sink.items);
      }
    } else if (event.kind === "tool_start" || event.kind === "tool_done") {
      if (event.questions?.length) askedQuestion = true;
      if (sink) {
        sink.items = applyIssueStreamEvent(sink.items, {
          kind: event.kind,
          callId: event.callId,
          name: event.name,
          detail: event.detail,
          path: event.path,
        });
        if (event.kind === "tool_done") {
          saveIssueTranscript(sink.issueId, sink.items);
        }
      }
    }
  });
  if (sink) saveIssueTranscript(sink.issueId, sink.items);
  return { text, error, git, askedQuestion };
}

async function collectIssueWriteup(input: {
  session: SdkAgentSession;
  issue: IssueRow;
  prUrl: string | null;
  firstTurnText: string;
  sink: { issueId: string; items: IssueTranscriptItem[] };
}): Promise<string> {
  const prompt = buildIssueWriteupPrompt({
    issueId: input.issue.id,
    title: input.issue.title,
    prUrl: input.prUrl,
  });
  let turn = await runPrompt(input.session, prompt, input.sink);
  let writeup = sanitizeIssueWriteup(turn.text);

  if (!writeup) {
    const fromFix = sanitizeIssueWriteup(input.firstTurnText);
    if (looksLikeIssueWriteup(fromFix)) writeup = fromFix;
  }

  if (!writeup) {
    logWarn("issues", "writeup empty, retrying", {
      id: input.issue.id,
      textLen: turn.text.length,
      error: turn.error,
    });
    turn = await runPrompt(
      input.session,
      [
        "Reply with the issue writeup now.",
        "Start with ## Summary. Markdown only. No tools. No preamble.",
        `Issue: ${input.issue.title}`,
        input.prUrl ? `PR: ${input.prUrl}` : "No PR URL.",
      ].join("\n"),
      input.sink,
    );
    writeup = sanitizeIssueWriteup(turn.text);
  }

  if (writeup) {
    addEvent(input.issue.id, "writeup_saved", "Markdown writeup saved");
    return writeup;
  }

  logWarn("issues", "writeup missing after retry", {
    id: input.issue.id,
    textLen: turn.text.length,
    error: turn.error,
  });
  const fallback = buildFallbackIssueWriteup({
    title: input.issue.title,
    description: input.issue.description,
    prUrl: input.prUrl,
  });
  addEvent(
    input.issue.id,
    "writeup_fallback",
    "Agent returned no writeup; saved a fallback note",
  );
  return fallback;
}

function wasCancelled(issueId: string): boolean {
  const row = db.getIssue(issueId);
  return Boolean(row?.cancel_requested) || row?.status === "cancelled";
}

async function executeIssue(issue: IssueRow): Promise<void> {
  const heartbeat = setInterval(() => {
    try {
      db.heartbeatIssue(issue.id, Date.now() + ISSUE_LEASE_MS);
    } catch {
      // ignore
    }
  }, ISSUE_HEARTBEAT_MS);

  let session: SdkAgentSession | null = null;
  try {
    if (wasCancelled(issue.id)) {
      db.updateIssue(issue.id, {
        status: "cancelled",
        finishedAt: Date.now(),
        leaseUntil: null,
        claimedAt: null,
        error: null,
      });
      addEvent(issue.id, "cancelled", "Cancelled before the agent started");
      return;
    }

    db.updateIssue(issue.id, { transcriptJson: "[]" });
    const sink = { issueId: issue.id, items: [] as IssueTranscriptItem[] };
    const apiKey = resolveIssueCursorKey(issue);
    const modelId = issue.model_id?.trim() || "auto";
    log("issues", "run started", {
      id: issue.id,
      orgId: issue.org_id || "personal",
      repoUrl: issue.repo_url,
      modelId,
      attempt: issue.attempt,
      keySource: issue.org_id
        ? "org-or-fallback"
        : "user-or-server",
    });
    session = new SdkAgentSession({
      runtime: "cloud",
      apiKey,
      model: { id: modelId },
      name: `issue-${issue.id}`,
      repoUrl: issue.repo_url,
      startingRef: issue.starting_ref || "main",
      autoCreatePR: true,
      mode: "agent",
    });

    addEvent(issue.id, "started", `Cursor Cloud started on ${issue.repo_url}`);

    const images = issueAttachmentsToPromptImages(issue.id);
    const attachmentNotes = buildIssueAttachmentPromptNotes(issue.id);
    const fixPrompt = buildIssueFixPrompt({
      issueId: issue.id,
      title: issue.title,
      description: issue.description,
      repoUrl: issue.repo_url,
      startingRef: issue.starting_ref || "main",
      attachmentNotes,
    });

    const first = await runPrompt(
      session,
      images.length ? { text: fixPrompt, images } : fixPrompt,
      sink,
    );
    const agentId = session.getAgentId();
    if (agentId) {
      db.updateIssue(issue.id, { cursorAgentId: agentId });
    }

    if (wasCancelled(issue.id)) {
      await session.abortAndWait();
      db.updateIssue(issue.id, {
        status: "cancelled",
        finishedAt: Date.now(),
        leaseUntil: null,
        claimedAt: null,
        cursorAgentId: agentId,
        error: null,
      });
      addEvent(issue.id, "cancelled", "Cancelled during the fix run");
      return;
    }

    if (first.error) {
      throw new Error(first.error);
    }

    const git = pickPrFromGit(first.git);
    if (git.prUrl || git.branch) {
      db.updateIssue(issue.id, {
        prUrl: git.prUrl,
        branch: git.branch,
        cursorAgentId: agentId,
      });
      if (git.prUrl) {
        addEvent(issue.id, "pr_opened", git.prUrl);
      }
    }

    if (first.askedQuestion) {
      const nudge = await runPrompt(
        session,
        "Do not wait for the user. Use the safest reasonable default and finish the fix and pull request.",
        sink,
      );
      const nudged = pickPrFromGit(nudge.git);
      if (nudged.prUrl || nudged.branch) {
        db.updateIssue(issue.id, {
          prUrl: nudged.prUrl || git.prUrl,
          branch: nudged.branch || git.branch,
        });
        if (nudged.prUrl && nudged.prUrl !== git.prUrl) {
          addEvent(issue.id, "pr_opened", nudged.prUrl);
        }
      }
      if (nudge.askedQuestion) {
        db.updateIssue(issue.id, {
          status: "needs_input",
          finishedAt: Date.now(),
          leaseUntil: null,
          claimedAt: null,
          error: "Agent asked a clarifying question and could not continue unattended",
          prUrl: nudged.prUrl || git.prUrl,
          branch: nudged.branch || git.branch,
          cursorAgentId: agentId,
        });
        addEvent(issue.id, "needs_input", "Agent asked a clarifying question");
        return;
      }
      if (nudge.error) throw new Error(nudge.error);
    }

    const latest = db.getIssue(issue.id);
    const prUrl = latest?.pr_url || git.prUrl || null;
    const writeup = await collectIssueWriteup({
      session,
      issue,
      prUrl,
      firstTurnText: first.text,
      sink,
    });

    db.updateIssue(issue.id, {
      status: "in_review",
      finishedAt: Date.now(),
      leaseUntil: null,
      claimedAt: null,
      writeupMd: writeup || latest?.writeup_md || null,
      prUrl,
      branch: latest?.branch || git.branch,
      cursorAgentId: agentId,
      error: null,
    });
    addEvent(
      issue.id,
      "finished",
      prUrl ? `Ready for review · ${prUrl}` : "Finished without a pull request URL",
    );
    log("issues", "run finished", {
      id: issue.id,
      prUrl,
      branch: latest?.branch || git.branch,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Issue run failed";
    if (wasCancelled(issue.id)) {
      db.updateIssue(issue.id, {
        status: "cancelled",
        finishedAt: Date.now(),
        leaseUntil: null,
        claimedAt: null,
        error: null,
      });
      addEvent(issue.id, "cancelled", "Cancelled during the run");
      return;
    }
    db.updateIssue(issue.id, {
      status: "failed",
      finishedAt: Date.now(),
      leaseUntil: null,
      claimedAt: null,
      error: message,
    });
    addEvent(issue.id, "failed", message);
    logError("issues", "run failed", { id: issue.id, err: message });
  } finally {
    clearInterval(heartbeat);
    if (session) {
      try {
        await session.dispose();
      } catch {
        // ignore
      }
    }
  }
}

export class IssueRunner {
  private timer: ReturnType<typeof setInterval> | null = null;
  private ticking = false;
  private readonly inFlight = new Set<string>();

  start(): void {
    if (this.timer) return;
    void this.tick();
    this.timer = setInterval(() => {
      void this.tick();
    }, ISSUE_POLL_MS);
    log("issues", "runner started", { pollMs: ISSUE_POLL_MS });
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const now = Date.now();
      db.recoverStaleIssueLeases(now, MAX_ISSUE_ATTEMPTS);
      const due = db.listDueIssueCandidates(now);
      for (const candidate of due) {
        if (this.inFlight.has(candidate.id)) continue;
        const settings = loadIssueSettings({
          orgId: candidate.org_id,
          userId: candidate.creator_id,
        });
        const running = db.countRunningIssues({
          orgId: candidate.org_id,
          creatorId: candidate.creator_id,
        });
        if (running >= settings.maxConcurrent) continue;
        const claimed = db.claimIssue(
          candidate.id,
          now,
          now + ISSUE_LEASE_MS,
        );
        if (!claimed) continue;
        log("issues", "claimed", {
          id: claimed.id,
          orgId: claimed.org_id || "personal",
          attempt: claimed.attempt,
        });
        this.inFlight.add(claimed.id);
        void executeIssue(claimed).finally(() => {
          this.inFlight.delete(claimed.id);
        });
      }
    } catch (err) {
      logError("issues", "poller error", { err });
    } finally {
      this.ticking = false;
    }
  }

  /** Used by run-now / retry so pickup does not wait for the next poll. */
  kick(): void {
    void this.tick();
  }
}

export const issueRunner = new IssueRunner();
