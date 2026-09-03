import { describe, expect, it } from "vitest";
import { syncVisibleIds } from "../web/lib/splitViewSettings.ts";

describe("syncVisibleIds", () => {
  it("keeps stored panes that still exist", () => {
    expect(syncVisibleIds(["b", "c"], ["a", "b", "c", "d"])).toEqual(["b", "c"]);
  });

  it("drops stale panes and fills from the pool when empty", () => {
    expect(syncVisibleIds(["gone"], ["a", "b"])).toEqual(["a", "b"]);
  });
});
