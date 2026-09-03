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

    const planId = randomUUID();
    db.insertMessage({
      id: planId,
      roomId,
      role: "assistant",
      content: "# Plan\n1. Attach files\n2. Approve in chat",
      status: "done",
      ts: Date.now(),
      planStatus: "pending",
      attachments: [
        {
          id: "upl_test",
          name: "shot.png",
          mime: "image/png",
          size: 12,
          url: `/api/rooms/${roomId}/uploads/upl_test`,
        },
      ],
    });
    const pendingPlan = db.getMessage(planId);
    expect(pendingPlan?.planStatus).toBe("pending");
    expect(pendingPlan?.attachments?.[0]?.name).toBe("shot.png");
    const approved = db.updateMessagePlanStatus(planId, "approved");
    expect(approved?.planStatus).toBe("approved");

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

  it("stores an integrator agent and room integration PR", async () => {
    const db = await import("../server/db/index.js");
    const roomId = randomUUID();
    db.createRoom({
      id: roomId,
      name: "Integration Room",
      repoPath: "/tmp",
      agentCommand: "echo",
      runtime: "cloud",
      authMode: "server",
      modelId: "auto",
      repoUrl: "https://github.com/acme/app",
      startingRef: "main",
    });
    const feature = db.createAgent({
      roomId,
      label: "Agent A",
      branch: "steer/claude-a",
    });
    expect(feature.kind).toBe("feature");
    const integrator = db.createAgent({
      roomId,
      label: "Integrator",
      kind: "integrator",
      branch: "steer/integration-x",
    });
    expect(integrator.kind).toBe("integrator");
    db.setRoomIntegration(roomId, {
      branch: "steer/integration-x",
      prUrl: "https://github.com/acme/app/pull/4",
      agentId: integrator.id,
    });
    const room = db.getRoom(roomId);
    expect(room?.integration_branch).toBe("steer/integration-x");
    expect(room?.integration_pr_url).toBe("https://github.com/acme/app/pull/4");
    expect(room?.integration_agent_id).toBe(integrator.id);
    expect(room?.pr_url).toBeNull();
  });
});
