/**
 * Phone-call approvals via Sarvam Instant Outbound.
 * The in-room Approve/Deny button stays the source of truth; voice is a second channel.
 */

export const VOICE_DECISIONS = ["approved", "denied"] as const;
export type VoiceDecision = (typeof VOICE_DECISIONS)[number];

export type VoiceCallStatus =
  | "dialing"
  | "connected"
  | "no_answer"
  | "busy"
  | "failed"
  | "completed";

export interface VoiceApprovalSettings {
  phoneE164: string | null;
  phoneMasked: string | null;
  optIn: boolean;
  callingConfigured: boolean;
}

export interface VoiceApprovalDecisionBody {
  approvalId: string;
  decision: VoiceDecision;
  token?: string;
}

const E164_RE = /^\+[1-9]\d{7,14}$/;

/** Normalize user-entered phones to E.164. Bare 10-digit numbers are treated as India (+91). */
export function normalizePhoneE164(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let s = raw.trim();
  if (!s) return null;
  s = s.replace(/[()\s.\-]/g, "");
  if (s.startsWith("00")) s = `+${s.slice(2)}`;
  if (s.startsWith("0") && /^\d{11}$/.test(s)) {
    s = `+91${s.slice(1)}`;
  }
  if (/^\d{10}$/.test(s)) s = `+91${s}`;
  if (/^\d{11,15}$/.test(s)) s = `+${s}`;
  if (!s.startsWith("+")) return null;
  if (!E164_RE.test(s)) return null;
  return s;
}

export function maskPhoneE164(phone: string | null | undefined): string | null {
  const p = phone?.trim() || "";
  if (!p) return null;
  if (p.length < 6) return "••••";
  return `${p.slice(0, 3)}••••${p.slice(-4)}`;
}

export function parseVoiceDecision(raw: unknown): VoiceDecision | null {
  if (typeof raw === "boolean") return raw ? "approved" : "denied";
  if (typeof raw === "number") {
    if (raw === 1) return "approved";
    if (raw === 0) return "denied";
    return null;
  }
  const original = String(raw ?? "").trim();
  if (!original) return null;

  const compact = original
    .toLowerCase()
    .replace(/[_\s-]+/g, "")
    .replace(/[^a-z0-9]+/g, "");
  if (
    compact === "approved" ||
    compact === "approve" ||
    compact === "yes" ||
    compact === "y" ||
    compact === "true" ||
    compact === "ok" ||
    compact === "okay" ||
    compact === "goahead"
  ) {
    return "approved";
  }
  if (
    compact === "denied" ||
    compact === "deny" ||
    compact === "no" ||
    compact === "n" ||
    compact === "false" ||
    compact === "reject" ||
    compact === "rejected" ||
    compact === "stop"
  ) {
    return "denied";
  }

  const text = original.toLowerCase();
  const yes =
    /\b(approved?|yes|yeah|yep|yup|ok(?:ay)?|go\s*ahead|proceed|confirm(?:ed)?)\b/.test(
      text,
    );
  const no =
    /\b(den(?:y|ied)|no(?:pe)?|reject(?:ed)?|stop|cancel(?:led)?|don'?t)\b/.test(
      text,
    );
  if (yes && !no) return "approved";
  if (no && !yes) return "denied";
  return null;
}

const NESTED_BODY_KEYS = [
  "data",
  "payload",
  "parameters",
  "params",
  "arguments",
  "args",
  "input",
  "body",
  "variables",
  "agent_variables",
  "tool",
  "request",
] as const;

const DECISION_KEYS = [
  "decision",
  "approved",
  "result",
  "choice",
  "action",
  "intent",
  "verdict",
  "outcome",
  "user_decision",
  "spoken_decision",
  "answer",
  "status",
] as const;

const TRANSCRIPT_KEYS = [
  "transcript",
  "call_transcript",
  "callTranscript",
  "conversation",
  "user_response",
  "message",
  "text",
  "utterance",
] as const;

/** Unwrap Sarvam API-tool envelopes and JSON-as-text bodies. */
export function flattenVoiceWebhookBody(
  body: unknown,
): Record<string, unknown> {
  if (typeof body === "string") {
    const trimmed = body.trim();
    if (!trimmed) return {};
    try {
      return flattenVoiceWebhookBody(JSON.parse(trimmed));
    } catch {
      return { decision: trimmed };
    }
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return {};
  const rec = body as Record<string, unknown>;
  let out: Record<string, unknown> = { ...rec };
  for (const key of NESTED_BODY_KEYS) {
    const inner = rec[key];
    if (inner && typeof inner === "object" && !Array.isArray(inner)) {
      out = { ...(inner as Record<string, unknown>), ...out };
    }
  }
  return out;
}

export function pickRawVoiceDecision(
  body: Record<string, unknown>,
  query?: Record<string, unknown>,
): unknown {
  for (const key of DECISION_KEYS) {
    const value = body[key] ?? query?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return value;
    }
  }
  for (const key of TRANSCRIPT_KEYS) {
    const value = body[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return undefined;
}

export function parseVoiceCallStatus(raw: unknown): VoiceCallStatus | null {
  const v = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (
    v === "dialing" ||
    v === "connected" ||
    v === "no_answer" ||
    v === "busy" ||
    v === "failed" ||
    v === "completed"
  ) {
    return v;
  }
  return null;
}

export function isVoiceCallInFlight(status: string | null | undefined): boolean {
  return status === "dialing" || status === "connected";
}
