import { describe, expect, it, beforeEach } from "vitest";
import { randomUUID } from "crypto";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

process.env.SQLITE_PATH = join(
  mkdtempSync(join(tmpdir(), "steer-smoke-")),
  "test.db",
);

describe("new db features smoke test", () => {
  it("supports plan_mode, approval_mode, sender_user_id, approval_requests", async () => {
    const db = await import("../server/db/index.js");

    const roomId = randomUUID();
    const room = db.createRoom({
      id: roomId,
      name: "Test Room",
      repoPath: "/tmp",
      agentCommand: "echo",
      runtime: "local",
      authMode: "cli",
      modelId: "auto",
      approvalMode: "dangerous",
    });
    expect(room.approval_mode).toBe("dangerous");

    db.setRoomApprovalMode(roomId, "all");
    const roomAfter = db.getRoom(roomId);
    expect(roomAfter?.approval_mode).toBe("all");

    const roomId2 = randomUUID();
    const roomDefault = db.createRoom({
      id: roomId2,
      name: "Test Room 2",
      repoPath: "/tmp",
      agentCommand: "echo",
      runtime: "local",
      authMode: "cli",
      modelId: "auto",
    });
    expect(roomDefault.approval_mode).toBe("off");

    const agent = db.createAgent({
      roomId,
      label: "Agent 1",
      planMode: true,
    });
    expect(agent.plan_mode).toBe(1);

    db.setAgentPlanMode(agent.id, false);
    const agentAfter = db.getAgent(agent.id);
    expect(agentAfter?.plan_mode).toBe(0);

    const agentDefault = db.createAgent({ roomId, label: "Agent 2" });
    expect(agentDefault.plan_mode).toBe(0);

    const msgId = randomUUID();
    db.insertMessage({
      id: msgId,
      roomId,
      role: "user",
      content: "hello",
      status: "done",
      ts: Date.now(),
      senderUserId: "user_123",
    });
    const messages = db.getMessages(roomId);
    const msg = messages.find((m) => m.id === msgId);
    expect(msg?.senderUserId).toBe("user_123");

    const ar = db.createApprovalRequest({
      roomId,
      agentId: agent.id,
      callId: "call1",
      toolName: "shell",
      detail: "rm -rf /",
      path: "/tmp/foo",
    });
    expect(ar.status).toBe("pending");

    const fetched = db.getApprovalRequest(ar.id);
    expect(fetched?.id).toBe(ar.id);

    const pending = db.listPendingApprovals(roomId);
    expect(pending.length).toBe(1);

    const resolved = db.resolveApprovalRequest(
      ar.id,
      "approved",
      "user_123",
      "Alice",
    );
    expect(resolved?.status).toBe("approved");
    expect(resolved?.decided_by_name).toBe("Alice");

    const pendingAfter = db.listPendingApprovals(roomId);
    expect(pendingAfter.length).toBe(0);

    const ar2 = db.createApprovalRequest({
      roomId,
      agentId: agent.id,
      callId: "call2",
      toolName: "delete",
    });
    db.expireApprovalRequest(ar2.id);
    const expired = db.getApprovalRequest(ar2.id);
    expect(expired?.status).toBe("expired");
  });
});
