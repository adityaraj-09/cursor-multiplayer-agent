import { Router, type Router as RouterType } from "express";
import { nanoid } from "nanoid";
import { requireAuth } from "./auth.js";
import * as db from "./db.js";
import { canManageOrg, type OrgRole } from "../shared/orgs.js";
import {
  DEFAULT_PICKUP_DELAY_MS,
  MAX_ISSUE_DESCRIPTION,
  MAX_ISSUE_TITLE,
  canCancelIssue,
  canEditIssue,
  canQueueIssue,
  canRetryIssue,
  clampMaxConcurrent,
  clampPickupDelayMs,
  isIssuePriority,
  isIssueStatus,
  issueSettingsScopeKey,
  parseGithubHttpsRepo,
  type IssueAttachmentInfo,
  type IssueEventInfo,
  type IssueInfo,
} from "../shared/issues.js";
import {
  readIssueAttachmentFile,
  removeIssueAttachmentFiles,
  saveIssueUpload,
} from "./issueAttachments.js";
import {
  issueRunner,
  loadIssueSettings,
  resolveIssueCursorKey,
  settingsFromRow,
} from "./issueRunner.js";
import { loadIssueTranscript, transcriptUnavailable } from "./issueTranscript.js";
import { parseStoredTranscriptItems } from "../shared/issueTranscript.js";
import { log, logError } from "./logger.js";
import {
  contentDispositionInline,
  safeContentType,
} from "../shared/uploads.js";

const router: RouterType = Router();

function routeParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] || "";
  return value || "";
}

function orgRoleFor(orgId: string | null | undefined, userId: string): OrgRole | null {
  if (!orgId) return null;
  return db.getOrganizationMember(orgId, userId)?.role ?? null;
}

function actorCanView(issue: db.IssueRow, userId: string): boolean {
  if (issue.creator_id === userId) return true;
  if (issue.org_id && db.isOrganizationMember(issue.org_id, userId)) return true;
  return false;
}

function actorCanEdit(issue: db.IssueRow, userId: string): boolean {
  return canEditIssue(
    { creatorId: issue.creator_id, orgId: issue.org_id },
    { userId, orgRole: orgRoleFor(issue.org_id, userId) },
  );
}

function toAttachmentInfo(row: db.IssueAttachmentRow): IssueAttachmentInfo {
  return {
    id: row.id,
    issueId: row.issue_id,
    name: row.name,
    mime: row.mime,
    size: row.size,
    url: `/api/issues/${row.issue_id}/attachments/${row.id}`,
    createdAt: row.created_at,
  };
}

function toEventInfo(row: db.IssueEventRow): IssueEventInfo {
  return {
    id: row.id,
    issueId: row.issue_id,
    kind: row.kind,
    message: row.message,
    createdAt: row.created_at,
  };
}

function toIssueInfo(
  row: db.IssueRow,
  opts?: { includeEvents?: boolean },
): IssueInfo {
  const creator = db.getUserById(row.creator_id);
  const status = isIssueStatus(row.status) ? row.status : "queued";
  const priority = isIssuePriority(row.priority) ? row.priority : "medium";
  return {
    id: row.id,
    orgId: row.org_id,
    creatorId: row.creator_id,
    creatorName: creator?.name ?? null,
    title: row.title,
    description: row.description,
    repoUrl: row.repo_url,
    startingRef: row.starting_ref,
    priority,
    status,
    pickupDelayMs: row.pickup_delay_ms,
    runAfter: row.run_after,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    modelId: row.model_id,
    cursorAgentId: row.cursor_agent_id,
    prUrl: row.pr_url,
    branch: row.branch,
    error: row.error,
    writeupMd: row.writeup_md,
    attempt: row.attempt,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    attachments: db.listIssueAttachments(row.id).map(toAttachmentInfo),
    events: opts?.includeEvents
      ? db.listIssueEvents(row.id).map(toEventInfo)
      : undefined,
  };
}

function record(issueId: string, kind: string, message = ""): void {
  db.insertIssueEvent({
    id: `iev_${nanoid(10)}`,
    issueId,
    kind,
    message,
  });
}

function parseOrgId(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  if (!trimmed || trimmed === "personal") return undefined;
  return trimmed;
}

router.get("/settings", requireAuth, (req, res) => {
  const orgId = parseOrgId(req.query.orgId);
  if (orgId && !db.isOrganizationMember(orgId, req.user!.id)) {
    res.status(404).json({ error: "Organization not found" });
    return;
  }
  res.json(loadIssueSettings({ orgId, userId: req.user!.id }));
});

router.put("/settings", requireAuth, (req, res) => {
  const orgId = parseOrgId(req.body?.orgId ?? req.query.orgId);
  if (orgId) {
    const role = orgRoleFor(orgId, req.user!.id);
    if (!canManageOrg(role)) {
      res.status(403).json({ error: "Only team admins can change issue settings" });
      return;
    }
  }
  const current = loadIssueSettings({ orgId, userId: req.user!.id });
  const next = db.upsertIssueSettings({
    scopeKey: issueSettingsScopeKey({ orgId, userId: req.user!.id }),
    defaultPickupDelayMs: clampPickupDelayMs(
      req.body?.defaultPickupDelayMs,
      current.defaultPickupDelayMs,
    ),
    autoStart:
      typeof req.body?.autoStart === "boolean"
        ? req.body.autoStart
        : current.autoStart,
    modelId:
      typeof req.body?.modelId === "string" && req.body.modelId.trim()
        ? req.body.modelId.trim()
        : current.modelId,
    maxConcurrent: clampMaxConcurrent(
      req.body?.maxConcurrent ?? current.maxConcurrent,
    ),
  });
  res.json(settingsFromRow(next.scope_key, next));
});

router.get("/", requireAuth, (req, res) => {
  const orgId = parseOrgId(req.query.orgId);
  if (orgId) {
    if (!db.isOrganizationMember(orgId, req.user!.id)) {
      res.status(404).json({ error: "Organization not found" });
      return;
    }
    res.json(db.listIssuesByOrg(orgId).map((row) => toIssueInfo(row)));
    return;
  }
  res.json(
    db.listPersonalIssuesByUser(req.user!.id).map((row) => toIssueInfo(row)),
  );
});

router.post("/", requireAuth, (req, res) => {
  try {
    const title = String(req.body?.title || "").trim();
    if (!title) {
      res.status(400).json({ error: "Title is required" });
      return;
    }
    if (title.length > MAX_ISSUE_TITLE) {
      res.status(400).json({ error: `Title must be under ${MAX_ISSUE_TITLE} characters` });
      return;
    }
    const description = String(req.body?.description || "");
    if (description.length > MAX_ISSUE_DESCRIPTION) {
      res.status(400).json({
        error: `Description must be under ${MAX_ISSUE_DESCRIPTION} characters`,
      });
      return;
    }
    const repoUrl = parseGithubHttpsRepo(String(req.body?.repoUrl || ""));
    if (!repoUrl) {
      res.status(400).json({
        error: "repoUrl must be an https://github.com/owner/repo URL",
      });
      return;
    }
    const orgId = parseOrgId(req.body?.orgId);
    if (orgId && !db.isOrganizationMember(orgId, req.user!.id)) {
      res.status(403).json({ error: "Not a member of that organization" });
      return;
    }

    const settings = loadIssueSettings({ orgId, userId: req.user!.id });
    const pickupDelayMs = clampPickupDelayMs(
      req.body?.pickupDelayMs,
      settings.defaultPickupDelayMs,
    );
    const autoStart =
      typeof req.body?.autoStart === "boolean"
        ? req.body.autoStart
        : settings.autoStart;
    const now = Date.now();
    const status = autoStart ? "queued" : "draft";
    const id = `iss_${nanoid(10)}`;
    const row = db.createIssue({
      id,
      orgId,
      creatorId: req.user!.id,
      title,
      description,
      repoUrl,
      startingRef: String(req.body?.startingRef || "main").trim() || "main",
      priority: isIssuePriority(req.body?.priority) ? req.body.priority : "medium",
      status,
      pickupDelayMs,
      runAfter: autoStart ? now + pickupDelayMs : now,
      modelId:
        typeof req.body?.modelId === "string" && req.body.modelId.trim()
          ? req.body.modelId.trim()
          : settings.modelId,
    });
    record(
      id,
      "created",
      autoStart
        ? `Queued · pickup in ${Math.round(pickupDelayMs / 60000)} min`
        : "Saved as draft",
    );
    if (autoStart) record(id, "queued", `Runs after ${new Date(row.run_after).toISOString()}`);

    const files = Array.isArray(req.body?.attachments) ? req.body.attachments : [];
    for (const file of files) {
      const name = String(file?.name || "file");
      const dataRaw = String(file?.data || "");
      if (!dataRaw) continue;
      const buf = Buffer.from(dataRaw, "base64");
      saveIssueUpload({
        issueId: id,
        name,
        mime: typeof file?.mime === "string" ? file.mime : undefined,
        data: buf,
      });
    }

    if (autoStart && pickupDelayMs === 0) issueRunner.kick();
    log("issues", "created", {
      id,
      user: req.user!.id,
      orgId: orgId || "personal",
      status,
      repoUrl,
      pickupDelayMs,
    });
    res.status(201).json(toIssueInfo(row, { includeEvents: true }));
  } catch (err) {
    logError("issues", "create failed", { err });
    res.status(400).json({
      error: err instanceof Error ? err.message : "Failed to create issue",
    });
  }
});

router.get("/:id", requireAuth, (req, res) => {
  const id = routeParam(req.params.id);
  const row = db.getIssue(id);
  if (!row || !actorCanView(row, req.user!.id)) {
    res.status(404).json({ error: "Issue not found" });
    return;
  }
  res.json(toIssueInfo(row, { includeEvents: true }));
});

router.get("/:id/transcript", requireAuth, async (req, res) => {
  const id = routeParam(req.params.id);
  const row = db.getIssue(id);
  if (!row || !actorCanView(row, req.user!.id)) {
    res.status(404).json({ error: "Issue not found" });
    return;
  }

  const live = row.status === "running";
  const cursorAgentId = row.cursor_agent_id?.trim() || null;
  const cachedItems = parseStoredTranscriptItems(row.transcript_json);
  if (!cursorAgentId) {
    const items = cachedItems.length
      ? cachedItems
      : row.writeup_md?.trim()
        ? [
            {
              id: "issue:writeup",
              kind: "assistant" as const,
              text: row.writeup_md,
            },
          ]
        : [];
    res.json(
      transcriptUnavailable({
        live,
        cursorAgentId: null,
        items,
      }),
    );
    return;
  }

  let apiKey: string;
  try {
    apiKey = resolveIssueCursorKey(row);
  } catch (err) {
    res.json(
      transcriptUnavailable({
        cursorAgentId,
        live,
        error: err instanceof Error ? err.message : "No Cursor API key",
        items: cachedItems,
      }),
    );
    return;
  }

  try {
    const transcript = await loadIssueTranscript({
      cursorAgentId,
      apiKey,
      live,
      cachedItems,
      writeupMd: row.writeup_md,
      issueError: row.error,
    });
    if (
      !live &&
      transcript.items.length > 0 &&
      cachedItems.length === 0
    ) {
      try {
        db.updateIssue(id, {
          transcriptJson: JSON.stringify(transcript.items),
        });
      } catch (err) {
        logError("issues", "transcript cache failed", { issueId: id, err });
      }
    }
    res.json(transcript);
  } catch (err) {
    logError("issues", "transcript fetch failed", { issueId: id, err });
    res.json(
      transcriptUnavailable({
        cursorAgentId,
        live,
        error:
          err instanceof Error
            ? err.message
            : "Failed to load Cursor run history",
        items: cachedItems,
      }),
    );
  }
});

router.patch("/:id", requireAuth, (req, res) => {
  const id = routeParam(req.params.id);
  const row = db.getIssue(id);
  if (!row || !actorCanView(row, req.user!.id)) {
    res.status(404).json({ error: "Issue not found" });
    return;
  }
  if (!actorCanEdit(row, req.user!.id)) {
    res.status(403).json({ error: "Not allowed to edit this issue" });
    return;
  }
  if (row.status === "running") {
    res.status(409).json({ error: "Cannot edit an issue while the agent is running" });
    return;
  }

  const patch: db.IssuePatch = {};
  if (typeof req.body?.title === "string") {
    const title = req.body.title.trim();
    if (!title) {
      res.status(400).json({ error: "Title is required" });
      return;
    }
    if (title.length > MAX_ISSUE_TITLE) {
      res.status(400).json({ error: `Title must be under ${MAX_ISSUE_TITLE} characters` });
      return;
    }
    patch.title = title;
  }
  if (typeof req.body?.description === "string") {
    if (req.body.description.length > MAX_ISSUE_DESCRIPTION) {
      res.status(400).json({
        error: `Description must be under ${MAX_ISSUE_DESCRIPTION} characters`,
      });
      return;
    }
    patch.description = req.body.description;
  }
  if (typeof req.body?.repoUrl === "string") {
    const repoUrl = parseGithubHttpsRepo(req.body.repoUrl);
    if (!repoUrl) {
      res.status(400).json({
        error: "repoUrl must be an https://github.com/owner/repo URL",
      });
      return;
    }
    patch.repoUrl = repoUrl;
  }
  if (typeof req.body?.startingRef === "string" && req.body.startingRef.trim()) {
    patch.startingRef = req.body.startingRef.trim();
  }
  if (isIssuePriority(req.body?.priority)) patch.priority = req.body.priority;
  if (typeof req.body?.modelId === "string" && req.body.modelId.trim()) {
    patch.modelId = req.body.modelId.trim();
  }
  if (req.body?.pickupDelayMs !== undefined) {
    patch.pickupDelayMs = clampPickupDelayMs(
      req.body.pickupDelayMs,
      row.pickup_delay_ms || DEFAULT_PICKUP_DELAY_MS,
    );
    if (row.status === "queued") {
      patch.runAfter = Date.now() + patch.pickupDelayMs;
    }
  }
  if (req.body?.writeupMd !== undefined) {
    if (typeof req.body.writeupMd !== "string") {
      res.status(400).json({ error: "writeupMd must be markdown text" });
      return;
    }
    patch.writeupMd = req.body.writeupMd;
  }
  if (req.body?.status === "done" && row.status === "in_review") {
    patch.status = "done";
  }

  const updated = db.updateIssue(id, patch);
  res.json(toIssueInfo(updated!, { includeEvents: true }));
});

router.delete("/:id", requireAuth, (req, res) => {
  const id = routeParam(req.params.id);
  const row = db.getIssue(id);
  if (!row || !actorCanView(row, req.user!.id)) {
    res.status(404).json({ error: "Issue not found" });
    return;
  }
  if (!actorCanEdit(row, req.user!.id)) {
    res.status(403).json({ error: "Not allowed to delete this issue" });
    return;
  }
  if (row.status === "running") {
    res.status(409).json({ error: "Cancel the run before deleting" });
    return;
  }
  removeIssueAttachmentFiles(id);
  db.deleteIssue(id);
  res.json({ ok: true });
});

router.post("/:id/attachments", requireAuth, (req, res) => {
  const id = routeParam(req.params.id);
  const row = db.getIssue(id);
  if (!row || !actorCanView(row, req.user!.id)) {
    res.status(404).json({ error: "Issue not found" });
    return;
  }
  if (!actorCanEdit(row, req.user!.id)) {
    res.status(403).json({ error: "Not allowed to attach files" });
    return;
  }
  if (row.status === "running") {
    res.status(409).json({ error: "Cannot add files while the agent is running" });
    return;
  }
  try {
    const name = String(req.body?.name || "file");
    const data = Buffer.from(String(req.body?.data || ""), "base64");
    const saved = saveIssueUpload({
      issueId: id,
      name,
      mime: typeof req.body?.mime === "string" ? req.body.mime : undefined,
      data,
    });
    db.updateIssue(id, {});
    res.status(201).json(toAttachmentInfo(saved));
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : "Failed to save attachment",
    });
  }
});

router.get("/:id/attachments/:fileId", requireAuth, (req, res) => {
  const id = routeParam(req.params.id);
  const fileId = routeParam(req.params.fileId);
  const row = db.getIssue(id);
  if (!row || !actorCanView(row, req.user!.id)) {
    res.status(404).json({ error: "Issue not found" });
    return;
  }
  const att = db.getIssueAttachment(id, fileId);
  if (!att) {
    res.status(404).json({ error: "Attachment not found" });
    return;
  }
  const buf = readIssueAttachmentFile(att);
  if (!buf) {
    res.status(404).json({ error: "Attachment file missing" });
    return;
  }
  res.setHeader("Content-Type", safeContentType(att.mime));
  res.setHeader("Content-Disposition", contentDispositionInline(att.name));
  res.send(buf);
});

router.delete("/:id/attachments/:fileId", requireAuth, (req, res) => {
  const id = routeParam(req.params.id);
  const fileId = routeParam(req.params.fileId);
  const row = db.getIssue(id);
  if (!row || !actorCanView(row, req.user!.id)) {
    res.status(404).json({ error: "Issue not found" });
    return;
  }
  if (!actorCanEdit(row, req.user!.id)) {
    res.status(403).json({ error: "Not allowed to remove attachments" });
    return;
  }
  if (row.status === "running") {
    res.status(409).json({ error: "Cannot remove files while the agent is running" });
    return;
  }
  removeIssueAttachmentFiles(id, fileId);
  db.deleteIssueAttachment(id, fileId);
  res.json({ ok: true });
});

router.post("/:id/queue", requireAuth, (req, res) => {
  const id = routeParam(req.params.id);
  const row = db.getIssue(id);
  if (!row || !actorCanView(row, req.user!.id)) {
    res.status(404).json({ error: "Issue not found" });
    return;
  }
  if (!actorCanEdit(row, req.user!.id)) {
    res.status(403).json({ error: "Not allowed to queue this issue" });
    return;
  }
  if (!canQueueIssue(isIssueStatus(row.status) ? row.status : "draft")) {
    res.status(409).json({ error: "Issue cannot be queued from its current status" });
    return;
  }
  const delay = clampPickupDelayMs(
    req.body?.pickupDelayMs,
    row.pickup_delay_ms || DEFAULT_PICKUP_DELAY_MS,
  );
  const now = Date.now();
  const updated = db.updateIssue(id, {
    status: "queued",
    pickupDelayMs: delay,
    runAfter: now + delay,
    finishedAt: null,
    error: null,
    cancelRequested: false,
    claimedAt: null,
    leaseUntil: null,
  });
  record(id, "queued", `Runs after ${new Date(now + delay).toISOString()}`);
  if (delay === 0) issueRunner.kick();
  log("issues", "queued", { id, user: req.user!.id, pickupDelayMs: delay });
  res.json(toIssueInfo(updated!, { includeEvents: true }));
});

router.post("/:id/run-now", requireAuth, (req, res) => {
  const id = routeParam(req.params.id);
  const row = db.getIssue(id);
  if (!row || !actorCanView(row, req.user!.id)) {
    res.status(404).json({ error: "Issue not found" });
    return;
  }
  if (!actorCanEdit(row, req.user!.id)) {
    res.status(403).json({ error: "Not allowed to run this issue" });
    return;
  }
  const status = isIssueStatus(row.status) ? row.status : "draft";
  if (status === "running") {
    res.status(409).json({ error: "Issue is already running" });
    return;
  }
  if (status !== "queued" && !canQueueIssue(status) && status !== "in_review") {
    res.status(409).json({ error: "Issue cannot be started from its current status" });
    return;
  }
  const updated = db.updateIssue(id, {
    status: "queued",
    runAfter: Date.now(),
    pickupDelayMs: 0,
    finishedAt: null,
    error: null,
    cancelRequested: false,
    claimedAt: null,
    leaseUntil: null,
  });
  record(id, "queued", "Run now requested");
  issueRunner.kick();
  log("issues", "run-now", { id, user: req.user!.id });
  res.json(toIssueInfo(updated!, { includeEvents: true }));
});

router.post("/:id/cancel", requireAuth, (req, res) => {
  const id = routeParam(req.params.id);
  const row = db.getIssue(id);
  if (!row || !actorCanView(row, req.user!.id)) {
    res.status(404).json({ error: "Issue not found" });
    return;
  }
  if (!actorCanEdit(row, req.user!.id)) {
    res.status(403).json({ error: "Not allowed to cancel this issue" });
    return;
  }
  const status = isIssueStatus(row.status) ? row.status : "draft";
  if (!canCancelIssue(status)) {
    res.status(409).json({ error: "Issue cannot be cancelled from its current status" });
    return;
  }
  if (status === "running") {
    const updated = db.updateIssue(id, { cancelRequested: true });
    record(id, "cancel_requested", "Cancel requested");
    log("issues", "cancel requested", { id, user: req.user!.id });
    res.json(toIssueInfo(updated!, { includeEvents: true }));
    return;
  }
  const updated = db.updateIssue(id, {
    status: "cancelled",
    finishedAt: Date.now(),
    cancelRequested: false,
    claimedAt: null,
    leaseUntil: null,
    error: null,
  });
  record(id, "cancelled", "Cancelled");
  log("issues", "cancelled", { id, user: req.user!.id });
  res.json(toIssueInfo(updated!, { includeEvents: true }));
});

router.post("/:id/retry", requireAuth, (req, res) => {
  const id = routeParam(req.params.id);
  const row = db.getIssue(id);
  if (!row || !actorCanView(row, req.user!.id)) {
    res.status(404).json({ error: "Issue not found" });
    return;
  }
  if (!actorCanEdit(row, req.user!.id)) {
    res.status(403).json({ error: "Not allowed to retry this issue" });
    return;
  }
  const status = isIssueStatus(row.status) ? row.status : "failed";
  if (!canRetryIssue(status)) {
    res.status(409).json({ error: "Issue cannot be retried from its current status" });
    return;
  }
  const delay = clampPickupDelayMs(req.body?.pickupDelayMs, 0);
  const now = Date.now();
  const updated = db.updateIssue(id, {
    status: "queued",
    pickupDelayMs: delay,
    runAfter: now + delay,
    finishedAt: null,
    error: null,
    cancelRequested: false,
    claimedAt: null,
    leaseUntil: null,
  });
  record(id, "retried", delay === 0 ? "Retrying now" : `Retry queued`);
  if (delay === 0) issueRunner.kick();
  log("issues", "retried", { id, user: req.user!.id, pickupDelayMs: delay });
  res.json(toIssueInfo(updated!, { includeEvents: true }));
});

export default router;
