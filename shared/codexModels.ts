import type { ModelInfo } from "./events.js";

/**
 * Codex CLI fallback `--model` choices.
 * Do not hardcode versioned GPT ids — the room page fetches the live catalog
 * from `codex debug models` and/or OpenAI `/v1/models`.
 */
export const CODEX_MODELS: ModelInfo[] = [
  {
    id: "auto",
    displayName: "Auto",
    description: "Codex CLI default — omit --model and use the latest recommended model",
  },
];

/** Leave `--model` unset so Codex picks its current default. */
export const DEFAULT_CODEX_MODEL = "auto";

export function isCodexModelId(id: string): boolean {
  if (id === "auto") return true;
  if (CODEX_MODELS.some((m) => m.id === id)) return true;
  return (
    id.startsWith("gpt-") ||
    id.includes("codex") ||
    id === "o1" ||
    id === "o3" ||
    id === "o4-mini" ||
    id.startsWith("o1-") ||
    id.startsWith("o3-") ||
    id.startsWith("o4-")
  );
}
