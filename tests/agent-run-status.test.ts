import { describe, expect, it } from "vitest";
import { resolveAgentRunStatus } from "../shared/agentRunStatus.js";

describe("resolveAgentRunStatus", () => {
  const idle = { id: "a", status: "idle" as const };
  const running = { id: "b", status: "running" as const };

  it("uses the selected agent's live status even when another agent is running", () => {
    expect(
      resolveAgentRunStatus(idle, { a: "idle", b: "running" }),
    ).toBe("idle");
  });

  it("does not treat a missing live entry as the room-level busy state", () => {
    expect(resolveAgentRunStatus(idle, { b: "running" })).toBe("idle");
  });

  it("marks the selected agent busy from its own snapshot", () => {
    expect(resolveAgentRunStatus(running, { a: "idle" })).toBe("running");
  });

  it("prefers live socket status over a stale snapshot", () => {
    expect(
      resolveAgentRunStatus(
        { id: "a", status: "idle" },
        { a: "running" },
      ),
    ).toBe("running");
    expect(
      resolveAgentRunStatus(
        { id: "a", status: "running" },
        { a: "idle" },
      ),
    ).toBe("idle");
  });

  it("treats stopped / waiting agents as idle for the input lock", () => {
    expect(
      resolveAgentRunStatus({ id: "a", status: "stopped" }, {}),
    ).toBe("idle");
    expect(
      resolveAgentRunStatus({ id: "a", status: "waiting_input" }, {}),
    ).toBe("idle");
  });

  it("is idle when no agent is selected", () => {
    expect(resolveAgentRunStatus(null, { b: "running" })).toBe("idle");
  });
});
