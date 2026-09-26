import type { ModelInfo } from "./events.js";

/**
 * Codex CLI `--model` choices.
 * Prefer Codex-tuned ids for cloud sandbox work; GPT-5.4 for general coding.
 */
export const CODEX_MODELS: ModelInfo[] = [
  {
    id: "gpt-5.3-codex",
    displayName: "GPT-5.3 Codex",
    description: "Codex-tuned model for autonomous coding in the sandbox",
  },
  {
    id: "gpt-5.4",
    displayName: "GPT-5.4",
    description: "Best general-purpose model for mixed coding and reasoning",
  },
  {
    id: "gpt-5.4-mini",
    displayName: "GPT-5.4 mini",
    description: "Faster / cheaper for small edits and Q&A",
  },
];

export const DEFAULT_CODEX_MODEL = "gpt-5.3-codex";

export function isCodexModelId(id: string): boolean {
  if (CODEX_MODELS.some((m) => m.id === id)) return true;
  return (
    id.startsWith("gpt-5") ||
    id.startsWith("gpt-4") ||
    id.includes("codex") ||
    id === "o3" ||
    id === "o4-mini"
  );
}
