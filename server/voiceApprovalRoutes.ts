import { Router, type Router as RouterType } from "express";
import type { RoomManager } from "./roomManager.js";
import * as db from "./db.js";
import { log, logWarn } from "./logger.js";
import { sarvamWebhookSecret } from "./config.js";
import {
  extractProvidedSecret,
  webhookSecretOk,
} from "./sarvam.js";
import { parseVoiceCallStatus, parseVoiceDecision } from "../shared/voiceApprovals.js";
import { resolveVoiceDecisionTarget } from "./voiceApprovalCall.js";

function headerString(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] || "";
  return value || "";
}

function readApprovalId(body: Record<string, unknown>): string {
  return String(
    body.approvalId ||
      body.approval_id ||
      body.requestId ||
      body.request_id ||
      "",
  ).trim();
}

function readToken(body: Record<string, unknown>): string {
  return String(body.token || body.voice_token || body.voiceToken || "").trim();
}

export function createVoiceApprovalRoutes(roomManager: RoomManager): RouterType {
  const router: RouterType = Router();

  /**
   * Sarvam API tool hits this when the user says approve/deny on the call.
   * Auth: per-approval voice_token, or the shared webhook secret plus the
   * single in-flight voice call when the committed Sarvam agent has no vars.
   */
  router.post("/voice-approvals/decision", (req, res) => {
    const body = (req.body || {}) as Record<string, unknown>;
    const provided = extractProvidedSecret({
      authorization: headerString(req.headers.authorization),
      apiKey: headerString(
        req.headers["x-api-key"] || req.headers["x-webhook-secret"],
      ),
      querySecret: String(req.query.secret || ""),
    });
    if (sarvamWebhookSecret() && !webhookSecretOk(provided)) {
      res.status(401).json({ error: "Invalid webhook secret", status: "denied" });
      return;
    }

    const approvalId = readApprovalId(body);
    const decision = parseVoiceDecision(
      body.decision ?? body.approved ?? body.result ?? body.choice,
    );
    const token = readToken(body);
    if (!decision) {
      res.status(400).json({
        error: "decision must be approved or denied",
        status: "unclear",
      });
      return;
    }

    const allowTokenless =
      Boolean(sarvamWebhookSecret()) && webhookSecretOk(provided);
    const target = resolveVoiceDecisionTarget({
      approvalId,
      token,
      allowTokenless,
    });
    if (!target.ok) {
      res.status(target.httpStatus).json({
        error: target.error,
        status: target.status,
      });
      return;
    }
    const row = target.row;
    if (target.tokenless) {
      log("voice-approval", "decision matched in-flight call", {
        approvalId: row.id,
      });
    }
    if (row.status !== "pending") {
      res.json({
        status: "ok",
        alreadyDecided: true,
        decision: row.status,
      });
      return;
    }

    const calleeId = row.voice_called_user_id || "";
    const callee = calleeId ? db.getUserById(calleeId) : undefined;
    const decidedByUserId = callee?.id;
    if (!decidedByUserId) {
      res.status(403).json({
        error: "No callee on this approval",
        status: "error",
      });
      return;
    }

    const result = roomManager.applyVoiceApprovalDecision({
      requestId: row.id,
      approved: decision === "approved",
      decidedByUserId,
      decidedByName: `${callee?.name || "Someone"} (phone)`,
    });
    if (!result.ok) {
      res.status(result.status).json({ error: result.error, status: "error" });
      return;
    }

    log("voice-approval", "decision from call", {
      approvalId: row.id,
      decision,
      tokenless: target.tokenless || undefined,
    });
    res.json({ status: "ok", decision });
  });

  /** Instant Outbound finished-call webhook (no_answer / busy / failed / connected). */
  router.post("/voice-approvals/call-status", (req, res) => {
    const provided = extractProvidedSecret({
      authorization: headerString(req.headers.authorization),
      apiKey: headerString(
        req.headers["x-api-key"] || req.headers["x-webhook-secret"],
      ),
      querySecret: String(req.query.secret || ""),
    });
    if (sarvamWebhookSecret() && !webhookSecretOk(provided)) {
      res.status(401).json({ error: "Invalid webhook secret" });
      return;
    }

    const body = (req.body || {}) as Record<string, unknown>;
    const attemptId = String(body.attempt_id || body.attemptId || "").trim();
    const meta =
      body.webhook_config && typeof body.webhook_config === "object"
        ? ((body.webhook_config as Record<string, unknown>).metadata as
            | Record<string, unknown>
            | undefined)
        : (body.metadata as Record<string, unknown> | undefined);
    const approvalId = String(
      meta?.approvalId || meta?.approval_id || body.approvalId || "",
    ).trim();

    const row = attemptId
      ? db.getApprovalByVoiceAttempt(attemptId)
      : approvalId
        ? db.getApprovalRequest(approvalId)
        : undefined;
    if (!row) {
      logWarn("voice-approval", "call-status for unknown attempt", {
        attemptId,
        approvalId,
      });
      res.json({ ok: true, ignored: true });
      return;
    }

    const rawStatus = String(body.status || "").trim().toLowerCase();
    let next = parseVoiceCallStatus(rawStatus);
    if (!next) {
      if (rawStatus === "connected") next = "connected";
      else if (rawStatus === "no_answer" || rawStatus === "no-answer")
        next = "no_answer";
      else if (rawStatus === "busy") next = "busy";
      else if (rawStatus === "failed") next = "failed";
      else next = row.status === "pending" ? "completed" : "completed";
    }
    if (row.status === "pending" && next === "connected") {
      db.setApprovalVoiceCallStatus(row.id, "connected");
    } else if (row.status === "pending") {
      db.setApprovalVoiceCallStatus(row.id, next);
    } else {
      db.setApprovalVoiceCallStatus(row.id, "completed");
    }

    log("voice-approval", "call-status", {
      approvalId: row.id,
      attemptId,
      status: next,
    });
    res.json({ ok: true });
  });

  return router;
}
