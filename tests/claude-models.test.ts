import { describe, expect, it } from "vitest";
import {
  CLAUDE_MODELS,
  DEFAULT_CLAUDE_MODEL,
  isClaudeModelId,
} from "../shared/claudeModels.js";

describe("CLAUDE_MODELS", () => {
  it("exposes stable CLI aliases with display names", () => {
    expect(DEFAULT_CLAUDE_MODEL).toBe("sonnet");
    expect(CLAUDE_MODELS.map((m) => m.id)).toEqual([
      "sonnet",
      "opus",
      "haiku",
      "fable",
    ]);
    for (const m of CLAUDE_MODELS) {
      expect(m.displayName.length).toBeGreaterThan(0);
      expect(isClaudeModelId(m.id)).toBe(true);
    }
    expect(isClaudeModelId("auto")).toBe(false);
  });
});
