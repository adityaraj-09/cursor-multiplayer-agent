import { describe, it, expect } from "vitest";

/**
 * DB CRUD for multi-agent. Relies on tests/setup.ts setting SQLITE_PATH
 * before the sqlite module is first imported.
 */
describe("multi-agent schema helpers (sqlite)", () => {
  it("creates two agents in one room and tags messages", async () => {
    const db = await import("../server/db/sqlite.js");

    const room = db.createRoom({
      id: `room_${Date.now()}`,
      name: "Test",
      repoPath: "/tmp/repo",
      agentCommand: "cursor",
      runtime: "local",
      authMode: "cli",
      modelId: "auto",
      ownerId: "user_1",
    });

    let agents = db.listAgents(room.id);
    if (agents.length === 0) {
      agents = [
        db.createAgent({
          roomId: room.id,
          label: "Agent 1",
          createdBy: "user_1",
        }),
      ];
    }
    const agent2 = db.createAgent({
      roomId: room.id,
      label: "Agent 2",
      scopePath: "frontend",
      sessionId: "sess-b",
      createdBy: "user_1",
    });
    agents = db.listAgents(room.id);
    expect(agents.length).toBeGreaterThanOrEqual(2);

    db.insertMessage({
      id: `m1_${Date.now()}`,
      roomId: room.id,
      role: "user",
      content: "hi a1",
      status: "done",
      ts: Date.now(),
      agentId: agents[0].id,
    });
    db.insertMessage({
      id: `m2_${Date.now()}`,
      roomId: room.id,
      role: "user",
      content: "hi a2",
      status: "done",
      ts: Date.now() + 1,
      agentId: agent2.id,
    });

    const msgs = db.getMessages(room.id);
    expect(msgs.some((m) => m.agentId === agents[0].id)).toBe(true);
    expect(msgs.some((m) => m.agentId === agent2.id)).toBe(true);

    db.setAgentSessionId(agents[0].id, "sess-a");
    expect(db.getAgent(agents[0].id)?.session_id).toBe("sess-a");
    expect(db.getAgent(agent2.id)?.session_id).toBe("sess-b");

    db.setAgentDriver(agents[0].id, "user_a");
    db.setAgentDriver(agent2.id, "user_b");
    let drivers = db.getAgentDrivers(room.id);
    expect(drivers.find((d) => d.agent_id === agents[0].id)?.user_id).toBe(
      "user_a",
    );
    expect(drivers.find((d) => d.agent_id === agent2.id)?.user_id).toBe(
      "user_b",
    );

    db.setAgentDriver(agent2.id, "user_a");
    drivers = db.getAgentDrivers(room.id);
    expect(drivers.every((d) => d.user_id === "user_a")).toBe(true);

    db.updateAgentStatus(agents[0].id, "error");
    expect(db.getAgent(agent2.id)?.status).toBe("idle");
    expect(db.getAgent(agents[0].id)?.status).toBe("error");
  });
});
