import { describe, expect, it } from "vitest";
import {
  displayNameFromId,
  ensureModelPresent,
  mergeModelLists,
  parseAnthropicModelsResponse,
  parseCodexDebugModels,
  parseOpenaiModelsResponse,
} from "../shared/providerModels.js";

describe("providerModels", () => {
  it("parses Anthropic /v1/models newest first", () => {
    const models = parseAnthropicModelsResponse({
      data: [
        {
          id: "claude-haiku-4-5-20251001",
          display_name: "Claude Haiku 4.5",
          created_at: "2025-10-01T00:00:00Z",
        },
        {
          id: "claude-sonnet-4-6",
          display_name: "Claude Sonnet 4.6",
          created_at: "2026-02-01T00:00:00Z",
        },
      ],
    });
    expect(models.map((m) => m.id)).toEqual([
      "claude-sonnet-4-6",
      "claude-haiku-4-5-20251001",
    ]);
    expect(models[0].displayName).toBe("Claude Sonnet 4.6");
  });

  it("filters OpenAI catalog to coding models and ranks Codex / GPT-6 first", () => {
    const models = parseOpenaiModelsResponse({
      data: [
        { id: "text-embedding-3-large", created: 1 },
        { id: "whisper-1", created: 2 },
        { id: "gpt-4o", created: 10 },
        { id: "gpt-5.4", created: 20 },
        { id: "gpt-6-sol", created: 30 },
        { id: "gpt-5.3-codex", created: 25 },
      ],
    });
    expect(models.map((m) => m.id)).toEqual([
      "gpt-5.3-codex",
      "gpt-6-sol",
      "gpt-5.4",
      "gpt-4o",
    ]);
  });

  it("parses `codex debug models` JSON, labeled lines, and bare ids", () => {
    expect(
      parseCodexDebugModels(
        JSON.stringify([{ slug: "gpt-6-sol", display_name: "GPT-6 Sol" }]),
      ),
    ).toEqual([{ id: "gpt-6-sol", displayName: "GPT-6 Sol" }]);

    expect(
      parseCodexDebugModels(
        "Available models:\ngpt-6-luna — Faster Codex\no3\nwhisper-1\n",
      ).map((m) => m.id),
    ).toEqual(["gpt-6-luna", "o3"]);
  });

  it("merges catalogs without duplicating ids and keeps the current selection", () => {
    const merged = mergeModelLists(
      [{ id: "auto", displayName: "Auto" }],
      [
        { id: "auto", displayName: "should not win" },
        { id: "sonnet", displayName: "Sonnet" },
      ],
    );
    expect(merged.map((m) => m.id)).toEqual(["auto", "sonnet"]);
    expect(merged[0].displayName).toBe("Auto");

    const withCurrent = ensureModelPresent(merged, "claude-opus-4-6");
    expect(withCurrent.at(-1)).toMatchObject({
      id: "claude-opus-4-6",
      displayName: displayNameFromId("claude-opus-4-6"),
    });
    expect(ensureModelPresent(merged, "auto")).toEqual(merged);
  });
});
