import { describe, expect, it } from "vitest";
import {
  CODEX_MODELS,
  DEFAULT_CODEX_MODEL,
  isCodexModelId,
} from "../shared/codexModels.js";

describe("CODEX_MODELS", () => {
  it("exposes the latest GPT-6 Codex ids", () => {
    expect(DEFAULT_CODEX_MODEL).toBe("gpt-6-sol");
    expect(CODEX_MODELS.map((m) => m.id)).toEqual([
      "gpt-6-sol",
      "gpt-6-luna",
      "gpt-6-astra-medium",
    ]);
    for (const m of CODEX_MODELS) {
      expect(m.displayName.length).toBeGreaterThan(0);
      expect(isCodexModelId(m.id)).toBe(true);
    }
    expect(isCodexModelId("auto")).toBe(false);
    expect(isCodexModelId("gpt-6-sol")).toBe(true);
    expect(isCodexModelId("gpt-5.3-codex")).toBe(true);
    expect(isCodexModelId("o3")).toBe(true);
  });
});
