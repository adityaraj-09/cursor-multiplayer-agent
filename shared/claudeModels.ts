import type { ModelInfo } from "./events.js";

/**
 * Claude Code model choices for `--model`.
 * Prefer versioned Anthropic model ids so the UI shows which generation is selected.
 * Short aliases (sonnet/opus/haiku/fable) remain accepted for older sessions.
 */
export const CLAUDE_MODELS: ModelInfo[] = [
  {
    id: "claude-sonnet-5",
    displayName: "Claude Sonnet 5",
    description: "Latest daily-driver Sonnet — best balance of speed and quality",
  },
  {
    id: "claude-opus-5-5",
    displayName: "Claude Opus 5.5",
    description: "Latest Opus — strongest model for autonomous coding",
  },
  {
    id: "claude-fable-5-1",
    displayName: "Claude Fable 5.1",
    description: "Highest-capability model for long autonomous sessions",
  },
  {
    id: "claude-haiku-4-5",
    displayName: "Claude Haiku 4.5",
    description: "Fastest / cheapest for small edits and Q&A",
  },
];

export const DEFAULT_CLAUDE_MODEL = "claude-sonnet-5";

const LEGACY_CLAUDE_ALIASES = new Set([
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
  if (CLAUDE_MODELS.some((m) => m.id === id)) return true;
  if (LEGACY_CLAUDE_ALIASES.has(id)) return true;
  return id.startsWith("claude-");
}
