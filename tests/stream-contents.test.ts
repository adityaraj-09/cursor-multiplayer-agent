import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("react", () => ({
  useEffect: () => undefined,
  useState: (value: unknown) => [value, () => undefined],
}));

import {
  applyChatDelta,
  peekStreamContent,
  resetStreamContents,
  subscribeStreamContent,
} from "../web/lib/streamContents.ts";

describe("applyChatDelta", () => {
  afterEach(() => {
    resetStreamContents();
  });

  it("replaces content unless append is set", () => {
    applyChatDelta("m1", "hel", "streaming");
    const next = applyChatDelta("m1", "lo", "streaming", true);
    expect(next.content).toBe("hello");
    expect(peekStreamContent("m1")?.content).toBe("hello");
  });

  it("notifies subscribers and clears on a terminal status", () => {
    const seen: string[] = [];
    const unsub = subscribeStreamContent("m2", (entry) => {
      seen.push(`${entry.status}:${entry.content}`);
    });
    applyChatDelta("m2", "hi", "streaming");
    applyChatDelta("m2", "hi!", "done");
    expect(seen).toEqual(["streaming:hi", "done:hi!"]);
    expect(peekStreamContent("m2")).toBeUndefined();
    unsub();
  });
});
