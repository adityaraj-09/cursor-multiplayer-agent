import { Router, type Request, type Router as RouterType } from "express";
import type { RoomManager } from "./roomManager.js";
import * as db from "./db.js";
import { log, logWarn } from "./logger.js";
import { sarvamWebhookSecret } from "./config.js";
import {
  extractProvidedSecret,
  webhookSecretOk,
} from "./sarvam.js";
import {
  parseVoiceCallStatus,
  parseVoiceDecision,
  flattenVoiceWebhookBody,
  pickRawVoiceDecision,
  extractCallWebhookDecision,
} from "../shared/voiceApprovals.js";
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

function queryRecord(query: Request["query"]): Record<string, unknown> {
  return query as Record<string, unknown>;
}

function snippet(value: unknown): string {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  if (/^[a-f0-9]{32,}$/i.test(text)) return "(hex)";
  return text.length > 80 ? `${text.slice(0, 79)}…` : text;
}

export function createVoiceApprovalRoutes(roomManager: RoomManager): RouterType {
  const router: RouterType = Router();

  /**
   * Sarvam API tool hits this when the user says approve/deny on the call.
   * Auth: per-approval voice_token, or the shared webhook secret plus the
   * single in-flight voice call when the committed Sarvam agent has no vars.
   */
  router.post("/voice-approvals/decision", (req, res) => {
    const body = flattenVoiceWebhookBody(req.body);
    const provided = extractProvidedSecret({
      authorization: headerString(req.headers.authorization),
      apiKey: headerString(
        req.headers["x-api-key"] || req.headers["x-webhook-secret"],
      ),
      querySecret: String(req.query.secret || ""),
    });
    if (sarvamWebhookSecret() && !webhookSecretOk(provided)) {
      logWarn("voice-approval", "decision rejected: bad webhook secret", {
        contentType: headerString(req.headers["content-type"]),
      });
      res.status(401).json({ error: "Invalid webhook secret", status: "denied" });
      return;
    }

    const approvalId = readApprovalId(body);
    const rawDecision = pickRawVoiceDecision(body, queryRecord(req.query));
    const decision = parseVoiceDecision(rawDecision);
    const token = readToken(body);
    if (!decision) {
      logWarn("voice-approval", "decision body not understood", {
        contentType: headerString(req.headers["content-type"]),
        keys: Object.keys(body).join(",") || "(empty)",
        decisionRaw: snippet(rawDecision) || "(missing)",
        approvalId: approvalId || "(none)",
        hasToken: Boolean(token),
      });
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
      logWarn("voice-approval", "decision did not match an approval", {
        approvalId: approvalId || "(none)",
        hasToken: Boolean(token),
        error: target.error,
        httpStatus: target.httpStatus,
      });
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

    const body = flattenVoiceWebhookBody(req.body);
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

    const spoken =
      row.status === "pending" ? extractCallWebhookDecision(body) : null;
    log("voice-approval", "call-status", {
      approvalId: row.id,
      attemptId,
      status: next,
      duration: body.duration ?? undefined,
      interactionId: body.interaction_id || undefined,
      transcriptTurns: spoken?.userTurns.length || undefined,
      spokenSource: spoken?.source || undefined,
      spokenDecision: spoken?.decision || undefined,
      userSaid: spoken?.userTurns.slice(-2).join(" | ").slice(0, 160) || undefined,
    });

    if (row.status === "pending" && spoken?.decision) {
      const calleeId = row.voice_called_user_id || "";
      const callee = calleeId ? db.getUserById(calleeId) : undefined;
      if (!callee?.id) {
        logWarn("voice-approval", "call ended with a decision but no callee", {
          approvalId: row.id,
        });
      } else {
        const result = roomManager.applyVoiceApprovalDecision({
          requestId: row.id,
          approved: spoken.decision === "approved",
          decidedByUserId: callee.id,
          decidedByName: `${callee.name || "Someone"} (phone)`,
        });
        if (!result.ok) {
          logWarn("voice-approval", "call-status could not apply decision", {
            approvalId: row.id,
            error: result.error,
          });
        } else {
          log("voice-approval", "decision from call transcript", {
            approvalId: row.id,
            decision: spoken.decision,
            source: spoken.source,
          });
        }
      }
    } else if (row.status === "pending" && next === "connected") {
      logWarn("voice-approval", "call connected but no approve/deny in transcript", {
        approvalId: row.id,
        userSaid: spoken?.userTurns.slice(-2).join(" | ").slice(0, 160) || "(none)",
      });
    }

    res.json({ ok: true });
  });

  return router;
}
