import { describe, expect, it } from "vitest";
import {
  CODEX_MODELS,
  DEFAULT_CODEX_MODEL,
  isCodexModelId,
} from "../shared/codexModels.js";

describe("CODEX_MODELS", () => {
  it("defaults to auto and accepts live Codex / GPT ids", () => {
    expect(DEFAULT_CODEX_MODEL).toBe("auto");
    expect(CODEX_MODELS.map((m) => m.id)).toEqual(["auto"]);
    expect(isCodexModelId("auto")).toBe(true);
    expect(isCodexModelId("gpt-6-sol")).toBe(true);
    expect(isCodexModelId("gpt-5.3-codex")).toBe(true);
    expect(isCodexModelId("o3")).toBe(true);
    expect(isCodexModelId("claude-sonnet-5")).toBe(false);
  });
});
