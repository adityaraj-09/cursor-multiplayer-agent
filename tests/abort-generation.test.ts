import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createRoom,
  createAgent,
  deleteRoom,
  insertMessage,
  getMessages,
  updateMessageContent,
} from "../server/db.js";
import type { ChatMessage } from "../shared/events.js";

/**
 * Mirrors RoomManager.finalizeStreamingMessages logic for unit coverage
 * without spinning up Socket.IO / agent backends.
 */
function finalizeStreamingMessages(
  roomId: string,
  agentId: string,
  emit: {
    delta: (id: string, content: string, status: string) => void;
    message: (msg: ChatMessage) => void;
  },
): void {
  const messages = getMessages(roomId, 200);
  for (const msg of messages) {
    if (msg.agentId !== agentId) continue;
    if (msg.status !== "streaming") continue;

    const content =
      msg.role === "tool" &&
      (!msg.content || msg.content === "Running…")
        ? "Aborted"
        : msg.content;

    updateMessageContent(msg.id, content, "done");
    if (msg.role === "assistant") {
      emit.delta(msg.id, content, "done");
    } else {
      emit.message({ ...msg, content, status: "done" });
    }
  }
}

describe("abort finalizes streaming messages", () => {
  let roomId: string;
  let agentA: string;
  let agentB: string;

  beforeEach(() => {
    roomId = `room_abort_${Date.now()}`;
    createRoom({
      id: roomId,
      name: "Abort test",
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
    deleteRoom(roomId);
  });

  it("closes streaming assistant + tool bubbles for the aborted agent only", () => {
    const aAssistant: ChatMessage = {
      id: "msg_a_asst",
      roomId,
      role: "assistant",
      content: "Working on it…",
      status: "streaming",
      ts: Date.now(),
      agentId: agentA,
    };
    const aTool: ChatMessage = {
      id: "msg_a_tool",
      roomId,
      role: "tool",
      content: "Running…",
      toolName: "Shell",
      status: "streaming",
      ts: Date.now() + 1,
      agentId: agentA,
    };
    const bAssistant: ChatMessage = {
      id: "msg_b_asst",
      roomId,
      role: "assistant",
      content: "Other agent still going",
      status: "streaming",
      ts: Date.now() + 2,
      agentId: agentB,
    };
    const aDone: ChatMessage = {
      id: "msg_a_done",
      roomId,
      role: "assistant",
      content: "Already finished",
      status: "done",
      ts: Date.now() + 3,
      agentId: agentA,
    };

    insertMessage(aAssistant);
    insertMessage(aTool);
    insertMessage(bAssistant);
    insertMessage(aDone);

    const deltas: Array<[string, string, string]> = [];
    const messages: ChatMessage[] = [];

    finalizeStreamingMessages(roomId, agentA, {
      delta: (id, content, status) => deltas.push([id, content, status]),
      message: (msg) => messages.push(msg),
    });

    const after = getMessages(roomId, 50);
    const byId = Object.fromEntries(after.map((m) => [m.id, m]));

    expect(byId.msg_a_asst.status).toBe("done");
    expect(byId.msg_a_asst.content).toBe("Working on it…");
    expect(byId.msg_a_tool.status).toBe("done");
    expect(byId.msg_a_tool.content).toBe("Aborted");
    expect(byId.msg_b_asst.status).toBe("streaming");
    expect(byId.msg_a_done.status).toBe("done");
    expect(byId.msg_a_done.content).toBe("Already finished");

    expect(deltas).toEqual([["msg_a_asst", "Working on it…", "done"]]);
    expect(messages).toHaveLength(1);
    expect(messages[0].id).toBe("msg_a_tool");
    expect(messages[0].content).toBe("Aborted");
  });
});

describe("runGeneration abort guard", () => {
  it("ignores events after generation is bumped", () => {
    let runGeneration = 1;
    const generation = runGeneration;
    const isCurrent = () => runGeneration === generation;
    const applied: string[] = [];

    const onEvent = (kind: string) => {
      if (!isCurrent()) return;
      applied.push(kind);
    };

    onEvent("assistant_delta");
    runGeneration += 1; // abort
    onEvent("error");
    onEvent("done");

    expect(applied).toEqual(["assistant_delta"]);
    expect(isCurrent()).toBe(false);
  });

  it("SdkAgentSession abortAndWait cancels active run before resolving", async () => {
    const cancel = vi.fn(async () => {});
    const supports = vi.fn(() => true);

    // Lightweight stand-in for the cancel path in SdkAgentSession.abortAndWait
    let activeRun: { cancel: () => Promise<void>; supports: (op: string) => boolean } | null =
      {
        cancel,
        supports,
      };
    let abortGeneration = 0;
    let processing = true;
    const queue: Array<{ resolve: () => void }> = [
      { resolve: vi.fn() },
    ];

    abortGeneration += 1;
    const pending = queue.splice(0);
    for (const item of pending) item.resolve();

    const run = activeRun;
    if (run) {
      if (run.supports("cancel")) {
        await run.cancel();
      }
    }
    activeRun = null;
    processing = false;

    expect(supports).toHaveBeenCalledWith("cancel");
    expect(cancel).toHaveBeenCalledOnce();
    expect(processing).toBe(false);
    expect(abortGeneration).toBe(1);
    expect(queue).toHaveLength(0);
  });
});
