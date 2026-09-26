import { describe, expect, it } from "vitest";
import {
  CODEX_MODELS,
  DEFAULT_CODEX_MODEL,
  isCodexModelId,
} from "../shared/codexModels.js";

describe("CODEX_MODELS", () => {
  it("exposes Codex-tuned and GPT-5.4 ids", () => {
    expect(DEFAULT_CODEX_MODEL).toBe("gpt-5.3-codex");
    expect(CODEX_MODELS.map((m) => m.id)).toEqual([
      "gpt-5.3-codex",
      "gpt-5.4",
      "gpt-5.4-mini",
    ]);
    for (const m of CODEX_MODELS) {
      expect(m.displayName.length).toBeGreaterThan(0);
      expect(isCodexModelId(m.id)).toBe(true);
    }
    expect(isCodexModelId("auto")).toBe(false);
    expect(isCodexModelId("gpt-4.1")).toBe(true);
    expect(isCodexModelId("o3")).toBe(true);
  });
});
