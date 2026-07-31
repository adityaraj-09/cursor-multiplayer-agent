import type { ModelInfo } from "./events.js";

/**
 * Claude Code model choices for `--model`.
 * Prefer versioned Anthropic model ids so the UI shows which generation is selected.
 * Short aliases (sonnet/opus/haiku/fable) remain accepted for older sessions.
 */
export const CLAUDE_MODELS: ModelInfo[] = [
  {
    id: "claude-sonnet-4-6",
    displayName: "Claude Sonnet 4.6",
    description: "Best balance of speed and quality for most coding tasks",
  },
  {
    id: "claude-opus-4-8",
    displayName: "Claude Opus 4.8",
    description: "Highest capability for complex multi-file work",
  },
  {
    id: "claude-haiku-4-5",
    displayName: "Claude Haiku 4.5",
    description: "Fastest / cheapest for small edits and Q&A",
  },
  {
    id: "claude-fable-5",
    displayName: "Claude Fable 5",
    description: "Latest frontier Claude model for long autonomous sessions",
  },
];

export const DEFAULT_CLAUDE_MODEL = "claude-sonnet-4-6";

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
