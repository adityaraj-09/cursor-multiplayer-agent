import { describe, expect, it } from "vitest";
import { computeRoomAttention } from "../shared/roomAttention.js";

describe("computeRoomAttention", () => {
  const base = {
    pendingApprovals: [],
    openPings: [],
    agentError: "",
    errorByAgent: {},
    agentStatus: "idle" as const,
    statusByAgent: {},
    pendingDrive: false,
    unreadCount: 0,
  };

  it("prioritizes approvals over running", () => {
    const attention = computeRoomAttention({
      ...base,
      pendingApprovals: [{ id: "a" } as never],
      agentStatus: "running",
    });
    expect(attention?.kind).toBe("approval");
  });

  it("returns running when an agent is busy", () => {
    const attention = computeRoomAttention({
      ...base,
      statusByAgent: { x: "running" },
    });
    expect(attention?.kind).toBe("running");
  });

  it("returns unread when nothing else is pending", () => {
    const attention = computeRoomAttention({
      ...base,
      unreadCount: 3,
    });
    expect(attention).toEqual({
      kind: "unread",
      label: "New messages",
      count: 3,
    });
  });
});
