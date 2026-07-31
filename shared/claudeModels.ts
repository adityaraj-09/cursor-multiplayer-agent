import type { ModelInfo } from "./events.js";

/** Stable Claude Code model aliases (CLI `--model`). */
export const CLAUDE_MODELS: ModelInfo[] = [
  {
    id: "sonnet",
    displayName: "Claude Sonnet",
    description: "Best balance of speed and quality for most coding tasks",
  },
  {
    id: "opus",
    displayName: "Claude Opus",
    description: "Highest capability for complex multi-file work",
  },
  {
    id: "haiku",
    displayName: "Claude Haiku",
    description: "Fastest / cheapest for small edits and Q&A",
  },
  {
    id: "fable",
    displayName: "Claude Fable",
    description: "Latest frontier Claude model alias when available",
  },
];

export const DEFAULT_CLAUDE_MODEL = "sonnet";

export function isClaudeModelId(id: string): boolean {
  return CLAUDE_MODELS.some((m) => m.id === id);
}
