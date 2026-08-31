import type { ChatMessage } from "../../shared/events.js";
import {
  MEMORY_CONTENT_MAX,
  MEMORY_TITLE_MAX,
  looksLikeMemoryInjection,
  sanitizeMemoryText,
  type MemoryKind,
} from "../../shared/roomContext.js";

export interface AutoMemoryCandidate {
  kind: MemoryKind;
  title: string;
  content: string;
  sourceMessageId?: string | null;
  sourcePath?: string | null;
}

export interface ExtractAutoMemoryInput {
  agentLabel: string;
  messages: ChatMessage[];
  touchedPaths: string[];
  branch?: string | null;
  prUrl?: string | null;
  existing: Array<{
    kind: string;
    title: string;
    content: string;
    status?: string;
    source?: string;
  }>;
}

const SKIP_USER = /^(ok|okay|thanks|thank you|lgtm|cool|nice|yes|yep|yeah|sure|continue|go on)\.?$/i;

function compact(text: string, max: number): string {
  return sanitizeMemoryText(text.replace(/\s+/g, " "), max);
}

function isUserCorrection(text: string): boolean {
  const t = text.trim();
  if (t.length < 8 || SKIP_USER.test(t)) return false;
  if (
    /^(no|nope|wrong|don't|do not|never|stop|not that)\b/i.test(t) ||
    /\buse\s+\S[\w./-]*\s+(instead of|not)\s+/i.test(t) ||
    /\bwe (use|prefer|don't|do not)\b/i.test(t) ||
    /\bplease (don't|do not|use)\b/i.test(t) ||
    /\bprefer\s+\S/i.test(t)
  ) {
    return true;
  }
  return false;
}

export function isAutoAcceptable(candidate: AutoMemoryCandidate): boolean {
  if (candidate.kind === "goal" || candidate.kind === "constraint") return false;
  const blob = `${candidate.title}\n${candidate.content}`;
  if (looksLikeMemoryInjection(blob)) return false;
  if (!candidate.title.trim() || !candidate.content.trim()) return false;
  if (candidate.kind === "feedback") return Boolean(candidate.sourceMessageId);
  if (candidate.kind === "discovery") {
    return Boolean(candidate.sourcePath || candidate.sourceMessageId);
  }
  if (candidate.kind === "handoff") return true;
  return false;
}

function alreadyHave(
  candidate: AutoMemoryCandidate,
  existing: ExtractAutoMemoryInput["existing"],
): boolean {
  const title = candidate.title.toLowerCase();
  const content = candidate.content.toLowerCase();
  return existing.some((e) => {
    if (e.status === "archived" || e.status === "superseded") return false;
    if (e.title.toLowerCase() === title) return true;
    if (e.content.toLowerCase() === content) return true;
    if (
      candidate.sourcePath &&
      e.content.toLowerCase().includes(candidate.sourcePath.toLowerCase())
    ) {
      return true;
    }
    return false;
  });
}

function extractFeedback(messages: ChatMessage[]): AutoMemoryCandidate[] {
  const out: AutoMemoryCandidate[] = [];
  for (const m of messages) {
    if (m.role !== "user" || !m.content) continue;
    if (!isUserCorrection(m.content)) continue;
    const content = compact(m.content, MEMORY_CONTENT_MAX);
    const title = compact(
      content.length > 72 ? `${content.slice(0, 69)}…` : `Correction: ${content}`,
      MEMORY_TITLE_MAX,
    );
    const candidate: AutoMemoryCandidate = {
      kind: "feedback",
      title: title.startsWith("Correction:") ? title : `Correction: ${title}`,
      content,
      sourceMessageId: m.id,
    };
    if (isAutoAcceptable(candidate)) out.push(candidate);
    if (out.length >= 2) break;
  }
  return out;
}

function extractHandoff(input: ExtractAutoMemoryInput): AutoMemoryCandidate | null {
  const paths = input.touchedPaths.slice(0, 12);
  const lastAssistant = [...input.messages]
    .reverse()
    .find((m) => m.role === "assistant" && m.content.trim());
  const todos = lastAssistant?.todos
    ? lastAssistant.todos.filter(
        (t) => t.status === "pending" || t.status === "in_progress",
      )
    : [];
  if (!paths.length && !input.branch && !input.prUrl && !todos.length) {
    return null;
  }
  const lines = [
    `Agent ${input.agentLabel} finished work.`,
    paths.length ? `Touched: ${paths.join(", ")}` : "",
    input.branch ? `Branch: ${input.branch}` : "",
    input.prUrl ? `PR: ${input.prUrl}` : "",
    todos.length
      ? `Remaining todos:\n${todos.map((t) => `- [${t.status}] ${t.content}`).join("\n")}`
      : "",
    lastAssistant
      ? `Last result: ${compact(lastAssistant.content, 400)}`
      : "",
  ].filter(Boolean);
  const candidate: AutoMemoryCandidate = {
    kind: "handoff",
    title: compact(`Handoff from ${input.agentLabel}`, MEMORY_TITLE_MAX),
    content: compact(lines.join("\n"), MEMORY_CONTENT_MAX),
    sourcePath: paths[0] ?? null,
    sourceMessageId: lastAssistant?.id ?? null,
  };
  return isAutoAcceptable(candidate) ? candidate : null;
}

function extractDiscovery(input: ExtractAutoMemoryInput): AutoMemoryCandidate | null {
  const paths = [...new Set(input.touchedPaths)].slice(0, 8);
  if (!paths.length) return null;
  const candidate: AutoMemoryCandidate = {
    kind: "discovery",
    title: compact(`Edited by ${input.agentLabel}`, MEMORY_TITLE_MAX),
    content: compact(
      `${input.agentLabel} recently edited: ${paths.join(", ")}. Continue from these files instead of re-exploring.`,
      MEMORY_CONTENT_MAX,
    ),
    sourcePath: paths[0],
  };
  return isAutoAcceptable(candidate) ? candidate : null;
}

/** Deterministic, no-LLM extractor. Returns at most 3 auto-acceptable candidates. */
export function extractAutoMemories(
  input: ExtractAutoMemoryInput,
): AutoMemoryCandidate[] {
  const userTurns = input.messages.filter((m) => m.role === "user").length;
  if (userTurns === 0) return [];

  const picked: AutoMemoryCandidate[] = [];
  const push = (c: AutoMemoryCandidate | null) => {
    if (!c || picked.length >= 3) return;
    if (alreadyHave(c, [...input.existing, ...picked])) return;
    if (!isAutoAcceptable(c)) return;
    picked.push(c);
  };

  for (const fb of extractFeedback(input.messages)) push(fb);
  push(extractHandoff(input));
  if (picked.length < 3) push(extractDiscovery(input));
  return picked;
}
