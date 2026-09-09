import { describe, expect, it } from "vitest";
import {
  pinVisibleId,
  syncVisibleIds,
} from "../web/lib/splitViewSettings.ts";

describe("syncVisibleIds", () => {
  it("keeps stored panes that still exist", () => {
    expect(syncVisibleIds(["b", "c"], ["a", "b", "c", "d"])).toEqual(["b", "c"]);
  });

  it("drops stale panes and fills from the pool when empty", () => {
    expect(syncVisibleIds(["gone"], ["a", "b"])).toEqual(["a", "b"]);
  });

  it("keeps a pinned integrator when the split pool includes it", () => {
    const pinned = pinVisibleId(["feature-1"], "integrator-1");
    expect(pinned).toEqual(["feature-1", "integrator-1"]);
    expect(
      syncVisibleIds(pinned, ["feature-1", "feature-2", "integrator-1"]),
    ).toEqual(["feature-1", "integrator-1"]);
  });
});
