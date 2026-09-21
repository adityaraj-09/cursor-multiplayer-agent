import { nanoid } from "nanoid";
import type { ApprovalRequestInfo } from "../shared/approvals.js";
import {
  isVoiceCallInFlight,
  maskPhoneE164,
} from "../shared/voiceApprovals.js";
import { APP_ORIGIN, sarvamMissingConfigKeys, voiceApprovalCooldownMs } from "./config.js";
import * as db from "./db.js";
import { log, logWarn } from "./logger.js";
import {
  createInstantOutboundCall,
  generateVoiceToken,
  hashVoiceToken,
  voiceTokensEqual,
} from "./sarvam.js";

export interface PlaceVoiceApprovalInput {
  roomId: string;
  roomName: string;
  ownerId: string | null;
  agentId: string;
  agentLabel: string;
  driverUserId?: string | null;
  approval: ApprovalRequestInfo;
}

function candidateUserIds(roomId: string, ownerId: string | null): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  const push = (id: string | null | undefined) => {
    const v = String(id || "").trim();
    if (!v || seen.has(v)) return;
    seen.add(v);
    ids.push(v);
  };
  push(ownerId);
  for (const member of db.getRoomMembers(roomId)) {
    const role = String(member.role || "").toLowerCase();
    if (role === "owner" || role === "editor") push(member.user_id);
  }
  return ids;
}

function eligibleCallee(userId: string): db.UserRow | null {
  const user = db.getUserById(userId);
  if (!user) return null;
  if (!user.voice_approvals_opt_in) return null;
  if (!user.phone_e164?.trim()) return null;
  return user;
}

function describeCandidates(
  roomId: string,
  ownerId: string | null,
  driverUserId?: string | null,
): string {
  const ids = candidateUserIds(roomId, ownerId);
  if (ids.length === 0) return "no owner/editor candidates";
  const driver = driverUserId?.trim() || "";
  return ids
    .map((id) => {
      const user = db.getUserById(id);
      const driving = id === driver ? " driving" : "";
      if (!user) return `${id}: missing user${driving}`;
      if (!user.voice_approvals_opt_in) {
        return `${user.name}: opt-in off${driving}`;
      }
      if (!user.phone_e164?.trim()) {
        return `${user.name}: no phone${driving}`;
      }
      return `${user.name}: ${maskPhoneE164(user.phone_e164)} opted-in${driving}`;
    })
    .join("; ");
}

export function pickVoiceApprovalCallee(input: {
  roomId: string;
  ownerId: string | null;
  driverUserId?: string | null;
}): db.UserRow | null {
  const candidates = candidateUserIds(input.roomId, input.ownerId);
  const driver = input.driverUserId?.trim() || "";
  const preferred = candidates
    .filter((id) => id !== driver)
    .map(eligibleCallee)
    .find(Boolean);
  if (preferred) return preferred ?? null;
  for (const id of candidates) {
    const user = eligibleCallee(id);
    if (user) return user;
  }
  return null;
}

export type VoiceDecisionTarget =
  | { ok: true; row: db.ApprovalRequestRow; tokenless: boolean }
  | { ok: false; httpStatus: number; error: string; status: string };

/**
 * Match a spoken approve/deny to a pending approval.
 * Tokenless matching is only allowed when the shared webhook secret already checked out.
 */
export function resolveVoiceDecisionTarget(input: {
  approvalId: string;
  token: string;
  allowTokenless: boolean;
}): VoiceDecisionTarget {
  if (input.approvalId) {
    const row = db.getApprovalRequest(input.approvalId);
    if (!row) {
      return {
        ok: false,
        httpStatus: 404,
        error: "Approval request not found",
        status: "error",
      };
    }
    if (row.voice_token_hash && voiceTokensEqual(input.token, row.voice_token_hash)) {
      return { ok: true, row, tokenless: false };
    }
    if (input.token) {
      return {
        ok: false,
        httpStatus: 401,
        error: "Invalid voice token",
        status: "denied",
      };
    }
    if (input.allowTokenless && row.status === "pending" && row.voice_called_user_id) {
      return { ok: true, row, tokenless: true };
    }
    return {
      ok: false,
      httpStatus: 401,
      error: "Invalid voice token",
      status: "denied",
    };
  }

  if (!input.allowTokenless) {
    return {
      ok: false,
      httpStatus: 400,
      error: "approvalId is required",
      status: "error",
    };
  }

  const pending = db.listPendingVoiceCalledApprovals();
  if (pending.length === 0) {
    return {
      ok: false,
      httpStatus: 404,
      error: "No in-flight voice approval",
      status: "error",
    };
  }
  if (pending.length > 1) {
    return {
      ok: false,
      httpStatus: 409,
      error: "Multiple in-flight voice approvals",
      status: "error",
    };
  }
  return { ok: true, row: pending[0], tokenless: true };
}

/**
 * Call the opted-in owner/editor about a pending tool gate.
 * Returns the callee when a call was queued; never throws.
 */
export function placeVoiceApprovalCall(
  input: PlaceVoiceApprovalInput,
): db.UserRow | null {
  const base = {
    approvalId: input.approval.id,
    roomId: input.roomId,
    room: input.roomName,
    tool: input.approval.toolName,
    agent: input.agentLabel,
  };
  log("voice-approval", "considering call", base);

  const missing = sarvamMissingConfigKeys();
  if (missing.length) {
    logWarn("voice-approval", "skip call: Sarvam not configured", {
      ...base,
      missing: missing.join(","),
    });
    return null;
  }
  const existing = db.getApprovalRequest(input.approval.id);
  if (!existing || existing.status !== "pending") {
    logWarn("voice-approval", "skip call: approval not pending", {
      ...base,
      status: existing?.status || "missing",
    });
    return null;
  }
  if (existing.voice_call_attempt_id || isVoiceCallInFlight(existing.voice_call_status)) {
    log("voice-approval", "skip call: already dialing", {
      ...base,
      attemptId: existing.voice_call_attempt_id,
      callStatus: existing.voice_call_status,
    });
    return null;
  }

  const callee = pickVoiceApprovalCallee({
    roomId: input.roomId,
    ownerId: input.ownerId,
    driverUserId: input.driverUserId,
  });
  if (!callee?.phone_e164) {
    logWarn("voice-approval", "skip call: no opted-in phone", {
      ...base,
      ownerId: input.ownerId,
      driverUserId: input.driverUserId || "",
      candidates: describeCandidates(
        input.roomId,
        input.ownerId,
        input.driverUserId,
      ),
    });
    return null;
  }

  if (db.listInFlightVoiceCallsForUser(callee.id).length > 0) {
    log("voice-approval", "skip call: user already on an approval call", {
      ...base,
      userId: callee.id,
    });
    return null;
  }

  const cooldown = voiceApprovalCooldownMs();
  if (
    cooldown > 0 &&
    callee.voice_last_call_at &&
    Date.now() - callee.voice_last_call_at < cooldown
  ) {
    log("voice-approval", "skip call: cooldown", {
      ...base,
      userId: callee.id,
      cooldownMs: cooldown,
      lastCallAt: callee.voice_last_call_at,
    });
    return null;
  }

  log("voice-approval", "dialing", {
    ...base,
    userId: callee.id,
    phone: maskPhoneE164(callee.phone_e164),
  });

  const token = generateVoiceToken();
  db.setApprovalVoiceCall(input.approval.id, {
    tokenHash: hashVoiceToken(token),
    attemptId: null,
    status: "dialing",
    calledUserId: callee.id,
  });
  db.touchUserVoiceCall(callee.id);

  const tool = input.approval.toolName.replace(/ToolCall$/i, "");
  const pathBit = input.approval.path ? ` on ${input.approval.path}` : "";
  const detail = (input.approval.detail || "").slice(0, 400);
  const greeting = `Hi ${callee.name.split(" ")[0] || "there"}. This is Steer. ${input.agentLabel} in ${input.roomName} wants to run ${tool}${pathBit}. ${detail} Should I approve or deny this?`;

  void (async () => {
    try {
      const result = await createInstantOutboundCall({
        userPhone: callee.phone_e164!,
        initialBotMessage: greeting,
        language: "English",
        variables: {
          user_name: callee.name,
          room_name: input.roomName,
          agent_label: input.agentLabel,
          tool_name: tool,
          tool_detail: detail,
          file_path: input.approval.path || "",
          approval_id: input.approval.id,
          voice_token: token,
          join_url: `${APP_ORIGIN.replace(/\/+$/, "")}/room/${input.roomId}`,
        },
      });
      db.setApprovalVoiceCall(input.approval.id, {
        tokenHash: hashVoiceToken(token),
        attemptId: result.attemptId,
        status: "dialing",
        calledUserId: callee.id,
      });
      log("voice-approval", "placed outbound call", {
        approvalId: input.approval.id,
        attemptId: result.attemptId,
        phone: maskPhoneE164(callee.phone_e164),
      });
    } catch (err) {
      db.setApprovalVoiceCallStatus(input.approval.id, "failed");
      logWarn("voice-approval", "failed to place call", {
        approvalId: input.approval.id,
        err: err instanceof Error ? err.message : err,
      });
    }
  })();
  return callee;
}

export function voiceCallSystemMessage(opts: {
  roomId: string;
  agentId: string;
  calleeName: string;
  phone: string | null;
}): import("../shared/events.js").ChatMessage {
  const masked = maskPhoneE164(opts.phone) || "their phone";
  return {
    id: nanoid(12),
    roomId: opts.roomId,
    role: "system",
    content: `Calling ${opts.calleeName} at ${masked} for approval.`,
    status: "done",
    ts: Date.now(),
    agentId: opts.agentId,
  };
}
