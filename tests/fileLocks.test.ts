import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { FileLockRegistry } from "../server/fileLocks.js";
import * as db from "../server/db.js";
import { createRoom, createAgent, deleteRoom } from "../server/db.js";

describe("FileLockRegistry", () => {
  let roomId: string;
  let agentA: string;
  let agentB: string;
  let registry: FileLockRegistry;

  beforeEach(() => {
    roomId = `room_${Date.now()}`;
    registry = new FileLockRegistry();
    createRoom({
      id: roomId,
      name: "Lock test",
      repoPath: "/tmp/repo",
      agentCommand: "cursor agent",
      runtime: "local",
      authMode: "cli",
      modelId: "auto",
    });
    agentA = createAgent({
      roomId,
      label: "Agent A",
      modelId: "auto",
    }).id;
    agentB = createAgent({
      roomId,
      label: "Agent B",
      modelId: "auto",
    }).id;
  });

  afterEach(() => {
    registry.releaseAllForRoom(roomId);
    deleteRoom(roomId);
  });

  it("grants exclusive lease to first agent", () => {
    const first = registry.tryAcquire(roomId, agentA, "src/auth.ts", "c1");
    expect(first).toEqual({ ok: true });
    const second = registry.tryAcquire(roomId, agentB, "src/auth.ts", "c2");
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.holderAgentId).toBe(agentA);
    }
  });

  it("allows same agent to re-acquire", () => {
    expect(registry.tryAcquire(roomId, agentA, "src/a.ts")).toEqual({ ok: true });
    expect(registry.tryAcquire(roomId, agentA, "src/a.ts")).toEqual({ ok: true });
  });

  it("releases lock for other agents", () => {
    registry.tryAcquire(roomId, agentA, "src/a.ts");
    registry.release(roomId, agentA, "src/a.ts");
    expect(registry.tryAcquire(roomId, agentB, "src/a.ts")).toEqual({ ok: true });
  });

  it("force release clears holder", () => {
    registry.tryAcquire(roomId, agentA, "src/x.ts");
    expect(registry.forceRelease(roomId, "src/x.ts")).toBe(true);
    expect(registry.tryAcquire(roomId, agentB, "src/x.ts")).toEqual({ ok: true });
  });
});
