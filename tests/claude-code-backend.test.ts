import { describe, expect, it } from "vitest";
import { ClaudeCodeBackend } from "../shared/backends/claudeCode.js";
import { getBackend, isBackendAvailable } from "../shared/backends/index.js";

describe("ClaudeCodeBackend", () => {
  it("is available", () => {
    expect(isBackendAvailable("claude-code")).toBe(true);
    expect(getBackend("claude-code").kind).toBe("claude-code");
  });

  it("builds headless stream-json args with resume and model", () => {
    const backend = new ClaudeCodeBackend();
    const args = backend.buildArgs({
      prompt: "fix the bug",
      modelId: "sonnet",
      sessionId: "sess-abc",
    });
    expect(args).toEqual([
      "-p",
      "--output-format",
      "stream-json",
      "--verbose",
      "--include-partial-messages",
      "--dangerously-skip-permissions",
      "--model",
      "sonnet",
      "--resume",
      "sess-abc",
      "fix the bug",
    ]);
  });

  it("parses system init session events", () => {
    const backend = new ClaudeCodeBackend();
    const events = backend.parseLine({
      type: "system",
      subtype: "init",
      session_id: "claude-sess-1",
    });
    expect(events).toEqual([{ kind: "session", sessionId: "claude-sess-1" }]);
  });

  it("parses stream_event text deltas", () => {
    const backend = new ClaudeCodeBackend();
    const ctx = {
      assistantBuf: { value: "" },
      gotTerminalEvent: { value: false },
    };
    const events = backend.parseLine(
      {
        type: "stream_event",
        event: {
          type: "content_block_delta",
          delta: { type: "text_delta", text: "Hello" },
        },
      },
      ctx,
    );
    expect(events[0]).toMatchObject({ kind: "assistant_delta", text: "Hello" });
    expect(ctx.assistantBuf.value).toBe("Hello");
  });

  it("pairs tool_use and tool_result into tool_start / tool_done", () => {
    const backend = new ClaudeCodeBackend();
    const ctx = {
      assistantBuf: { value: "" },
      gotTerminalEvent: { value: false },
    };

    const start = backend.parseLine(
      {
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              id: "toolu_1",
              name: "Edit",
              input: {
                file_path: "src/a.ts",
                old_string: "foo",
                new_string: "bar",
              },
            },
          ],
        },
      },
      ctx,
    );
    expect(start[0]).toMatchObject({
      kind: "tool_start",
      callId: "toolu_1",
      name: "Edit",
      path: "src/a.ts",
    });

    const done = backend.parseLine(
      {
        type: "user",
        message: {
          content: [
            {
              type: "tool_result",
              tool_use_id: "toolu_1",
              content: "ok",
            },
          ],
        },
      },
      ctx,
    );
    expect(done[0]).toMatchObject({
      kind: "tool_done",
      callId: "toolu_1",
      name: "Edit",
      path: "src/a.ts",
    });
    expect((done[0] as { diffPatch?: string }).diffPatch).toContain(
      "src/a.ts",
    );
  });

  it("maps nested subagent tools via parent_tool_use_id", () => {
    const backend = new ClaudeCodeBackend();
    const events = backend.parseLine({
      type: "assistant",
      parent_tool_use_id: "parent_task",
      message: {
        content: [
          {
            type: "tool_use",
            id: "child_1",
            name: "Bash",
            input: { command: "ls" },
          },
        ],
      },
    });
    expect(events[0]).toMatchObject({
      kind: "subagent_nested",
      parentCallId: "parent_task",
      callId: "child_1",
      name: "Bash",
      status: "started",
    });
  });

  it("parses success and error result events", () => {
    const backend = new ClaudeCodeBackend();
    const ctx = {
      assistantBuf: { value: "final" },
      gotTerminalEvent: { value: false },
    };
    const ok = backend.parseLine(
      {
        type: "result",
        subtype: "success",
        session_id: "s2",
        result: "done text",
      },
      ctx,
    );
    expect(ctx.gotTerminalEvent.value).toBe(true);
    expect(ok).toEqual(
      expect.arrayContaining([
        { kind: "session", sessionId: "s2" },
        { kind: "done", result: "done text" },
      ]),
    );

    const ctx2 = {
      assistantBuf: { value: "" },
      gotTerminalEvent: { value: false },
    };
    const err = backend.parseLine(
      {
        type: "result",
        subtype: "error_during_execution",
        is_error: true,
        result: "boom",
      },
      ctx2,
    );
    expect(err).toContainEqual({ kind: "error", message: "boom" });
  });

  it("isolates pending tools across backend instances", () => {
    const a = new ClaudeCodeBackend();
    const b = new ClaudeCodeBackend();
    a.parseLine({
      type: "assistant",
      message: {
        content: [
          {
            type: "tool_use",
            id: "t1",
            name: "Write",
            input: { file_path: "x.ts", content: "1" },
          },
        ],
      },
    });
    const doneOnB = b.parseLine({
      type: "user",
      message: {
        content: [{ type: "tool_result", tool_use_id: "t1", content: "ok" }],
      },
    });
    // Instance B never saw the tool_use, so name falls back to "tool"
    expect(doneOnB[0]).toMatchObject({ kind: "tool_done", name: "tool" });
  });
});
