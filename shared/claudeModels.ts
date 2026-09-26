import type { ModelInfo } from "./events.js";

/**
 * Claude Code `--model` aliases. These always track the current generation —
 * do not hardcode versioned ids here. The room page merges this list with
 * Anthropic's live `/v1/models` catalog (and the local worker when available).
 */
export const CLAUDE_MODELS: ModelInfo[] = [
  {
    id: "auto",
    displayName: "Auto",
    description: "Claude Code default — omit --model and use the CLI's latest recommended model",
  },
  {
    id: "sonnet",
    displayName: "Sonnet",
    description: "Latest Sonnet alias — daily driver, tracks the current generation",
  },
  {
    id: "opus",
    displayName: "Opus",
    description: "Latest Opus alias — strongest model for autonomous coding",
  },
  {
    id: "haiku",
    displayName: "Haiku",
    description: "Latest Haiku alias — fastest / cheapest for small edits",
  },
  {
    id: "fable",
    displayName: "Fable",
    description: "Latest Fable alias — long autonomous sessions",
  },
];

/** Leave `--model` unset so Claude Code picks its current default. */
export const DEFAULT_CLAUDE_MODEL = "auto";

const CLAUDE_ALIASES = new Set([
  "auto",
  "sonnet",
  "opus",
  "haiku",
  "fable",
  "sonnet[1m]",
  "opus[1m]",
  "opusplan",
  "best",
]);

export function isClaudeModelId(id: string): boolean {
  if (CLAUDE_ALIASES.has(id)) return true;
  if (CLAUDE_MODELS.some((m) => m.id === id)) return true;
  return id.startsWith("claude-");
}
