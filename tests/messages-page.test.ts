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
});
