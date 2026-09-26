import { describe, expect, it } from "vitest";
import {
  CLAUDE_MODELS,
  DEFAULT_CLAUDE_MODEL,
  isClaudeModelId,
} from "../shared/claudeModels.js";

describe("CLAUDE_MODELS", () => {
  it("defaults to auto and exposes generation aliases, not versioned ids", () => {
    expect(DEFAULT_CLAUDE_MODEL).toBe("auto");
    expect(CLAUDE_MODELS.map((m) => m.id)).toEqual([
      "auto",
      "sonnet",
      "opus",
      "haiku",
      "fable",
    ]);
    for (const m of CLAUDE_MODELS) {
      expect(m.displayName.length).toBeGreaterThan(0);
      expect(isClaudeModelId(m.id)).toBe(true);
    }
    expect(isClaudeModelId("auto")).toBe(true);
    expect(isClaudeModelId("sonnet")).toBe(true);
    expect(isClaudeModelId("opus")).toBe(true);
    expect(isClaudeModelId("claude-opus-4-6")).toBe(true);
    expect(isClaudeModelId("composer-2.5")).toBe(false);
  });
});
