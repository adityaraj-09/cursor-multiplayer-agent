import { createHash, randomBytes, timingSafeEqual } from "crypto";
import {
  API_PUBLIC_ORIGIN,
  sarvamAgentPhone,
  sarvamAgentVariableAllowlist,
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
const MAX_OUTBOUND_ATTEMPTS = 3;

/** Names Instant Outbound already rejected for this process (committed app version). */
const rejectedAgentVariableKeys = new Set<string>();
let rejectedAgentVariableVersion: number | null = null;

export function resetRejectedAgentVariableKeys(): void {
  rejectedAgentVariableKeys.clear();
  rejectedAgentVariableVersion = null;
}

function rejectedKeysForCurrentVersion(): Set<string> {
  const version = sarvamAppVersion();
  if (rejectedAgentVariableVersion !== version) {
    rejectedAgentVariableKeys.clear();
    rejectedAgentVariableVersion = version;
  }
  return rejectedAgentVariableKeys;
}

/** Parse `Agent variables '{'a', 'b'}' not found` from a Sarvam 422 body. */
export function parseUnknownAgentVariableNames(
  detail: string,
): string[] | null {
  const m = detail.match(/Agent variables\s+['"]?\{([^}]*)\}['"]?/i);
  if (!m) return null;
  return m[1]
    .split(",")
    .map((part) => part.trim().replace(/^['"]|['"]$/g, ""))
    .filter(Boolean);
}

export function sarvamErrorText(
  data: Record<string, unknown>,
  raw: string,
): string {
  const err = data.error;
  if (err && typeof err === "object") {
    const nested = err as Record<string, unknown>;
    const inner = nested.data;
    if (inner && typeof inner === "object") {
      const details = (inner as Record<string, unknown>).details;
      if (typeof details === "string" && details.trim()) return details.trim();
    }
    if (typeof nested.message === "string" && nested.message.trim()) {
      return nested.message.trim();
    }
  }
  if (typeof data.detail === "string" && data.detail.trim()) return data.detail.trim();
  if (typeof data.message === "string" && data.message.trim()) {
    return data.message.trim();
  }
  return raw.slice(0, 500);
}

function rememberRejectedKeys(keys: string[]): void {
  const rejected = rejectedKeysForCurrentVersion();
  for (const key of keys) {
    const name = key.trim();
    if (name) rejected.add(name);
  }
}

export function filterAgentVariables(
  variables: Record<string, string>,
): Record<string, string> {
  const allow = sarvamAgentVariableAllowlist();
  const rejected = rejectedKeysForCurrentVersion();
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(variables)) {
    if (allow && !allow.includes(key)) continue;
    if (rejected.has(key)) continue;
    out[key] = value;
  }
  return out;
}

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

function buildOutboundPayload(
  input: InstantOutboundInput,
  userPhone: string,
  agentPhone: string,
  variables: Record<string, string>,
): Record<string, unknown> {
  const appConfig: Record<string, unknown> = {
    app_id: sarvamAppId(),
    app_version: sarvamAppVersion(),
    connection_config: {
      connection_id: sarvamConnectionId(),
      agent_phone_number: agentPhone,
    },
    app_type: "agent",
  };
  if (Object.keys(variables).length > 0) {
    appConfig.agent_variables = variables;
  }
  if (input.initialBotMessage) {
    appConfig.initial_bot_message = input.initialBotMessage;
  }
  if (input.language) {
    appConfig.initial_language_name = input.language;
  }
  return {
    app_config: appConfig,
    user_config: { user_phone_number: userPhone },
    webhook_config: {
      url: voiceCallStatusWebhookUrl(),
      metadata: {
        approvalId: input.variables.approval_id || variables.approval_id || "",
        source: "steer",
      },
    },
  };
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

  let variables = filterAgentVariables(input.variables);
  const droppedUpFront = Object.keys(input.variables).filter(
    (key) => !(key in variables),
  );
  if (droppedUpFront.length) {
    log("sarvam", "omitting agent variables not on committed app", {
      appVersion: sarvamAppVersion(),
      dropped: droppedUpFront.join(","),
      kept: Object.keys(variables).join(",") || "(none)",
    });
  }

  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= MAX_OUTBOUND_ATTEMPTS; attempt++) {
    const payload = buildOutboundPayload(input, userPhone, agentPhone, variables);
    if (attempt === 1) {
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
        variableKeys: Object.keys(variables).join(",") || "(none)",
      });
    } else {
      logWarn("sarvam", "retrying Instant Outbound without undeclared variables", {
        appVersion: sarvamAppVersion(),
        attempt,
        variableKeys: Object.keys(variables).join(",") || "(none)",
      });
    }

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
      const detail = sarvamErrorText(data, text);
      log("sarvam", `outbound response ${res.status}`, {
        ok: res.ok,
        attempt,
        body: text.slice(0, 500),
        detail: res.ok ? undefined : detail.slice(0, 400),
      });
      if (!res.ok) {
        const unknown = parseUnknownAgentVariableNames(detail);
        const looksLikeUnknownVars =
          res.status === 422 &&
          (/agent variables/i.test(detail) || (unknown && unknown.length > 0));
        if (looksLikeUnknownVars && attempt < MAX_OUTBOUND_ATTEMPTS) {
          const drop =
            unknown && unknown.length > 0 ? unknown : Object.keys(variables);
          rememberRejectedKeys(drop);
          let next = filterAgentVariables(variables);
          if (
            Object.keys(next).length === Object.keys(variables).length &&
            Object.keys(variables).length > 0
          ) {
            rememberRejectedKeys(Object.keys(variables));
            next = {};
          }
          const droppedAuth =
            !("approval_id" in next) || !("voice_token" in next);
          logWarn("sarvam", "committed agent is missing those input variables", {
            appVersion: sarvamAppVersion(),
            dropped: drop.join(","),
            kept: Object.keys(next).join(",") || "(none)",
            spokenAuth: droppedAuth
              ? "decision webhook will match the in-flight call"
              : "kept",
          });
          variables = next;
          lastError = new Error(`Sarvam outbound ${res.status}: ${detail}`);
          continue;
        }
        throw new Error(`Sarvam outbound ${res.status}: ${detail}`);
      }
      const attemptId = String(data.attempt_id || data.attemptId || "").trim();
      if (!attemptId) {
        throw new Error("Sarvam outbound did not return attempt_id");
      }
      log("sarvam", "outbound accepted", { attemptId, attempt });
      return { attemptId };
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        logWarn("sarvam", "outbound call timed out", { url, attempt });
        throw new Error("Sarvam outbound timed out");
      }
      logError("sarvam", "outbound call failed", { err });
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
  const err = lastError || new Error("Sarvam outbound failed");
  logError("sarvam", "outbound call failed", { err });
  throw err;
}
