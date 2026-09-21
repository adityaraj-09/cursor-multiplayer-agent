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
  const v = String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, "");
  if (
    v === "approved" ||
    v === "approve" ||
    v === "yes" ||
    v === "y" ||
    v === "true" ||
    v === "ok" ||
    v === "okay" ||
    v === "goahead"
  ) {
    return "approved";
  }
  if (
    v === "denied" ||
    v === "deny" ||
    v === "no" ||
    v === "n" ||
    v === "false" ||
    v === "reject" ||
    v === "rejected" ||
    v === "stop"
  ) {
    return "denied";
  }
  return null;
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
