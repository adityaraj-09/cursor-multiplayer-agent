import { describe, expect, it } from "vitest";
import { AgentBusyError } from "@cursor/sdk";
import { isTransientRunStreamError } from "../server/sdkAgent.js";

describe("isTransientRunStreamError", () => {
  it("detects a dropped run stream", () => {
    expect(
      isTransientRunStreamError(new Error("Run stream is no longer available")),
    ).toBe(true);
  });

  it("detects agent_busy from a leftover cloud run", () => {
    expect(
      isTransientRunStreamError(
        new Error("[agent_busy] Agent already has an active run"),
      ),
    ).toBe(true);
    expect(
      isTransientRunStreamError(
        new AgentBusyError("[agent_busy] Agent already has an active run"),
      ),
    ).toBe(true);
  });

  it("ignores unrelated failures", () => {
    expect(isTransientRunStreamError(new Error("invalid API key"))).toBe(
      false,
    );
    expect(isTransientRunStreamError("boom")).toBe(false);
  });
});
