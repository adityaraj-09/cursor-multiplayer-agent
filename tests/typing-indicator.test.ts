import { describe, expect, it } from "vitest";
import { formatTypingIndicator } from "../shared/typing.js";

describe("formatTypingIndicator", () => {
  it("formats one, two, and many typists", () => {
    expect(formatTypingIndicator(["Jae"], "Agent A")).toBe(
      "Jae is typing to Agent A…",
    );
    expect(formatTypingIndicator(["Jae", "Sam"], "Agent A")).toBe(
      "Jae and Sam are typing to Agent A…",
    );
    expect(formatTypingIndicator(["Jae", "Sam", "Lee"], "Backend")).toBe(
      "Jae and 2 others are typing to Backend…",
    );
  });

  it("returns empty when nobody is typing", () => {
    expect(formatTypingIndicator([], "Agent")).toBe("");
    expect(formatTypingIndicator(["  "], "Agent")).toBe("");
  });
});
