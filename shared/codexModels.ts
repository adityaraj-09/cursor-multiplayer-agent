import type { ModelInfo } from "./events.js";

/**
 * Codex CLI `--model` choices.
 * Prefer Codex-tuned ids for cloud sandbox work; GPT-5.4 for general coding.
 */
export const CODEX_MODELS: ModelInfo[] = [
  {
    id: "gpt-6-sol",
    displayName: "GPT-6 Sol",
    description: "Latest Codex default for autonomous coding and agentic work",
  },
  {
    id: "gpt-6-luna",
    displayName: "GPT-6 Luna",
    description: "Faster / cheaper Codex model for small edits and subagents",
  },
  {
    id: "gpt-6-astra-medium",
    displayName: "GPT-6 Astra",
    description: "Highest-capability Codex model for the hardest long-horizon work",
  },
];

export const DEFAULT_CODEX_MODEL = "gpt-6-sol";

export function isCodexModelId(id: string): boolean {
  if (CODEX_MODELS.some((m) => m.id === id)) return true;
  return (
    id.startsWith("gpt-6") ||
    id.startsWith("gpt-5") ||
    id.startsWith("gpt-4") ||
    id.includes("codex") ||
    id === "o3" ||
    id === "o4-mini"
  );
}
