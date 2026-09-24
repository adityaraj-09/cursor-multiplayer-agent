import { describe, expect, it } from "vitest";
import * as db from "../server/db/sqlite.js";

describe("getMessagesPage", () => {
  it("returns the latest page and a cursor for older messages", () => {
    const room = db.createRoom({
      id: `room_${Date.now()}_page`,
      name: "History page",
      repoPath: "/tmp/repo",
      agentCommand: "cursor",
      runtime: "local",
      authMode: "cli",
      modelId: "auto",
      ownerId: "user_1",
    });
    const base = Date.now();
    for (let i = 1; i <= 90; i++) {
      db.insertMessage({
        id: `msg_${String(i).padStart(3, "0")}`,
        roomId: room.id,
        role: i % 2 === 0 ? "assistant" : "user",
        content: `m${i}`,
        status: "done",
        ts: base + i,
      });
    }

    const first = db.getMessagesPage(room.id, { limit: 80 });
    expect(first.hasMore).toBe(true);
    expect(first.messages).toHaveLength(80);
    expect(first.messages[0].content).toBe("m11");
    expect(first.messages[79].content).toBe("m90");

    const older = db.getMessagesPage(room.id, {
      limit: 80,
      beforeTs: first.messages[0].ts,
      beforeId: first.messages[0].id,
    });
    expect(older.hasMore).toBe(false);
    expect(older.messages).toHaveLength(10);
    expect(older.messages[0].content).toBe("m1");
    expect(older.messages[9].content).toBe("m10");

    const all = db.getMessages(room.id, 500);
    expect(all).toHaveLength(90);
    expect(all[0].content).toBe("m1");
    expect(all[89].content).toBe("m90");
  });

  it("keeps each agent's recent chat when joining a busy room", () => {
    const room = db.createRoom({
      id: `room_${Date.now()}_agents`,
      name: "Multi agent history",
      repoPath: "/tmp/repo",
      agentCommand: "cursor",
      runtime: "local",
      authMode: "cli",
      modelId: "auto",
      ownerId: "user_1",
    });
    const busy = db.createAgent({
      roomId: room.id,
      label: "Busy",
      createdBy: "user_1",
    });
    const quiet = db.createAgent({
      roomId: room.id,
      label: "Quiet",
      createdBy: "user_1",
    });
    const base = Date.now();
    db.insertMessage({
      id: "quiet_old",
      roomId: room.id,
      role: "assistant",
      content: "quiet history",
      status: "done",
      ts: base,
      agentId: quiet.id,
    });
    for (let i = 1; i <= 90; i++) {
      db.insertMessage({
        id: `busy_${String(i).padStart(3, "0")}`,
        roomId: room.id,
        role: "assistant",
        content: `busy ${i}`,
        status: "done",
        ts: base + i,
        agentId: busy.id,
      });
    }

    const global = db.getMessagesPage(room.id, { limit: 80 });
    expect(global.messages.some((message) => message.agentId === quiet.id)).toBe(
      false,
    );

    const join = db.getJoinMessages(room.id, [busy.id, quiet.id], 80);
    expect(join.messages.some((message) => message.content === "quiet history")).toBe(
      true,
    );
    expect(join.hasMoreByAgent[busy.id]).toBe(true);
    expect(join.hasMoreByAgent[quiet.id]).toBe(false);

    const quietPage = db.getMessagesPage(room.id, {
      limit: 80,
      agentId: quiet.id,
    });
    expect(quietPage.messages).toHaveLength(1);
    expect(quietPage.messages[0].content).toBe("quiet history");
  });
});
