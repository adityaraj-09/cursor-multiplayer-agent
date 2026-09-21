import { createHash, randomBytes, timingSafeEqual } from "crypto";
import {
  API_PUBLIC_ORIGIN,
  sarvamAgentPhone,
  sarvamApiKey,
  sarvamAppId,
  sarvamAppVersion,
  sarvamCallingConfigured,
  sarvamConnectionId,
  sarvamOrgId,
  sarvamWebhookSecret,
  sarvamWorkspaceId,
} from "./config.js";
import { log, logError, logWarn } from "./logger.js";
import { maskPhoneE164, normalizePhoneE164 } from "../shared/voiceApprovals.js";

export { sarvamCallingConfigured };

const OUTBOUND_TIMEOUT_MS = 15_000;

export function generateVoiceToken(): string {
  return randomBytes(24).toString("hex");
}

export function hashVoiceToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function voiceTokensEqual(
  plain: string | undefined | null,
  hash: string | undefined | null,
): boolean {
  if (!plain || !hash) return false;
  const actual = hashVoiceToken(plain);
  if (actual.length !== hash.length) return false;
  try {
    return timingSafeEqual(Buffer.from(actual), Buffer.from(hash));
  } catch {
    return false;
  }
}

export function secretsEqual(
  provided: string | undefined | null,
  expected: string | undefined | null,
): boolean {
  if (!provided || !expected) return false;
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

export function voiceDecisionWebhookUrl(): string {
  return `${API_PUBLIC_ORIGIN.replace(/\/+$/, "")}/api/voice-approvals/decision`;
}

function redactUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.searchParams.has("secret")) u.searchParams.set("secret", "***");
    return u.toString();
  } catch {
    return url.replace(/secret=[^&]+/gi, "secret=***");
  }
}

export function voiceCallStatusWebhookUrl(): string {
  const origin = API_PUBLIC_ORIGIN.replace(/\/+$/, "");
  const base = `${origin}/api/voice-approvals/call-status`;
  const secret = sarvamWebhookSecret();
  if (!secret) return base;
  try {
    const url = new URL(base);
    url.searchParams.set("secret", secret);
    return url.toString();
  } catch {
    const sep = base.includes("?") ? "&" : "?";
    return `${base}${sep}secret=${encodeURIComponent(secret)}`;
  }
}

export function extractProvidedSecret(input: {
  authorization?: string;
  apiKey?: string;
  querySecret?: string;
}): string {
  const auth = input.authorization?.trim() || "";
  if (auth.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  return (input.apiKey || input.querySecret || "").trim();
}

export function webhookSecretOk(provided: string): boolean {
  const expected = sarvamWebhookSecret();
  if (!expected) return true;
  return secretsEqual(provided, expected);
}

export interface InstantOutboundInput {
  userPhone: string;
  variables: Record<string, string>;
  initialBotMessage?: string;
  language?: string;
}

export interface InstantOutboundResult {
  attemptId: string;
}

export async function createInstantOutboundCall(
  input: InstantOutboundInput,
): Promise<InstantOutboundResult> {
  if (!sarvamCallingConfigured()) {
    throw new Error("Sarvam calling is not configured");
  }
  const userPhone = normalizePhoneE164(input.userPhone);
  const agentPhone = normalizePhoneE164(sarvamAgentPhone()) || sarvamAgentPhone();
  if (!userPhone) throw new Error("Invalid destination phone number");

  const orgId = encodeURIComponent(sarvamOrgId());
  const workspaceId = encodeURIComponent(sarvamWorkspaceId());
  const url = `https://apps.sarvam.ai/api/outbounds/v1/orgs/${orgId}/workspaces/${workspaceId}/outbounds`;

  const payload = {
    app_config: {
      app_id: sarvamAppId(),
      app_version: sarvamAppVersion(),
      connection_config: {
        connection_id: sarvamConnectionId(),
        agent_phone_number: agentPhone,
      },
      agent_variables: input.variables,
      app_type: "agent",
      ...(input.initialBotMessage
        ? { initial_bot_message: input.initialBotMessage }
        : {}),
      ...(input.language ? { initial_language_name: input.language } : {}),
    },
    user_config: { user_phone_number: userPhone },
    webhook_config: {
      url: voiceCallStatusWebhookUrl(),
      metadata: {
        approvalId: input.variables.approval_id || "",
        source: "steer",
      },
    },
  };

  log("sarvam", "POST Instant Outbound", {
    url,
    appId: sarvamAppId(),
    appVersion: sarvamAppVersion(),
    orgId: sarvamOrgId(),
    workspaceId: sarvamWorkspaceId(),
    connectionId: sarvamConnectionId(),
    agentPhone: maskPhoneE164(agentPhone) || agentPhone,
    userPhone: maskPhoneE164(userPhone),
    approvalId: input.variables.approval_id || "",
    webhook: redactUrl(voiceCallStatusWebhookUrl()),
    variableKeys: Object.keys(input.variables).join(","),
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OUTBOUND_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": sarvamApiKey(),
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const text = await res.text();
    let data: Record<string, unknown> = {};
    try {
      data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      data = { raw: text };
    }
    log("sarvam", `outbound response ${res.status}`, {
      ok: res.ok,
      body: text.slice(0, 500),
    });
    if (!res.ok) {
      const detail =
        typeof data.detail === "string"
          ? data.detail
          : typeof data.message === "string"
            ? data.message
            : text.slice(0, 240);
      throw new Error(`Sarvam outbound ${res.status}: ${detail}`);
    }
    const attemptId = String(data.attempt_id || data.attemptId || "").trim();
    if (!attemptId) {
      throw new Error("Sarvam outbound did not return attempt_id");
    }
    log("sarvam", "outbound accepted", { attemptId });
    return { attemptId };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      logWarn("sarvam", "outbound call timed out", { url });
      throw new Error("Sarvam outbound timed out");
    }
    logError("sarvam", "outbound call failed", { err });
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
