import { describe, expect, it } from "vitest";
import {
  CLAUDE_MODELS,
  DEFAULT_CLAUDE_MODEL,
  isClaudeModelId,
} from "../shared/claudeModels.js";

describe("CLAUDE_MODELS", () => {
  it("exposes versioned model ids with display names", () => {
    expect(DEFAULT_CLAUDE_MODEL).toBe("claude-sonnet-4-6");
    expect(CLAUDE_MODELS.map((m) => m.id)).toEqual([
      "claude-sonnet-4-6",
      "claude-opus-4-8",
      "claude-haiku-4-5",
      "claude-fable-5",
    ]);
    for (const m of CLAUDE_MODELS) {
      expect(m.displayName.length).toBeGreaterThan(0);
      expect(m.displayName).toMatch(/\d/);
      expect(isClaudeModelId(m.id)).toBe(true);
    }
    expect(isClaudeModelId("auto")).toBe(false);
    // Legacy aliases from older sessions remain recognized.
    expect(isClaudeModelId("sonnet")).toBe(true);
    expect(isClaudeModelId("opus")).toBe(true);
  });
});
