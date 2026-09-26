import { describe, expect, it } from "vitest";
import { ClaudeCodeBackend } from "../shared/backends/claudeCode.js";
import { getBackend, isBackendAvailable } from "../shared/backends/index.js";

describe("ClaudeCodeBackend", () => {
  it("is available", () => {
    expect(isBackendAvailable("claude-code")).toBe(true);
    expect(getBackend("claude-code").kind).toBe("claude-code");
  });

  it("omits --model when the room is on auto", () => {
    const backend = new ClaudeCodeBackend();
    const args = backend.buildArgs({
      prompt: "fix the bug",
      modelId: "auto",
    });
    expect(args).not.toContain("--model");
    expect(args.at(-1)).toBe("fix the bug");
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

  it("emits tool_start from stream_event content_block_start tool_use", () => {
    const backend = new ClaudeCodeBackend();
    const start = backend.parseLine({
      type: "stream_event",
      event: {
        type: "content_block_start",
        index: 1,
        content_block: {
          type: "tool_use",
          id: "toolu_stream",
          name: "Read",
          input: {},
        },
      },
    });
    expect(start[0]).toMatchObject({
      kind: "tool_start",
      callId: "toolu_stream",
      name: "Read",
    });
  });

  it("accumulates input_json_delta and updates the tool card on stop", () => {
    const backend = new ClaudeCodeBackend();
    backend.parseLine({
      type: "stream_event",
      event: {
        type: "content_block_start",
        index: 1,
        content_block: {
          type: "tool_use",
          id: "toolu_json",
          name: "Read",
          input: {},
        },
      },
    });
    expect(
      backend.parseLine({
        type: "stream_event",
        event: {
          type: "content_block_delta",
          index: 1,
          delta: { type: "input_json_delta", partial_json: '{"file' },
        },
      }),
    ).toEqual([]);

    const mid = backend.parseLine({
      type: "stream_event",
      event: {
        type: "content_block_delta",
        index: 1,
        delta: {
          type: "input_json_delta",
          partial_json: '_path":"README.md"}',
        },
      },
    });
    expect(mid[0]).toMatchObject({
      kind: "tool_start",
      callId: "toolu_json",
      name: "Read",
      path: "README.md",
    });

    expect(
      backend.parseLine({
        type: "stream_event",
        event: { type: "content_block_stop", index: 1 },
      }),
    ).toEqual([]);

    const done = backend.parseLine({
      type: "user",
      message: {
        content: [
          { type: "tool_result", tool_use_id: "toolu_json", content: "ok" },
        ],
      },
    });
    expect(done[0]).toMatchObject({
      kind: "tool_done",
      callId: "toolu_json",
      name: "Read",
      path: "README.md",
    });
  });

  it("does not duplicate tool_start when assistant tool_use follows stream_event", () => {
    const backend = new ClaudeCodeBackend();
    backend.parseLine({
      type: "stream_event",
      event: {
        type: "content_block_start",
        index: 0,
        content_block: {
          type: "tool_use",
          id: "toolu_dup_stream",
          name: "Bash",
          input: {},
        },
      },
    });
    const later = backend.parseLine({
      type: "assistant",
      message: {
        content: [
          {
            type: "tool_use",
            id: "toolu_dup_stream",
            name: "Bash",
            input: { command: "pwd" },
          },
        ],
      },
    });
    expect(later).toHaveLength(1);
    expect(later[0]).toMatchObject({
      kind: "tool_start",
      callId: "toolu_dup_stream",
      name: "Bash",
      detail: "pwd",
    });
    expect(
      backend.parseLine({
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              id: "toolu_dup_stream",
              name: "Bash",
              input: { command: "pwd" },
            },
          ],
        },
      }),
    ).toEqual([]);
  });

  it("parses top-level content_block_start tool_use events", () => {
    const backend = new ClaudeCodeBackend();
    const events = backend.parseLine({
      type: "content_block_start",
      index: 0,
      content_block: {
        type: "tool_use",
        id: "toolu_top",
        name: "Glob",
        input: { pattern: "**/*.ts" },
      },
    });
    expect(events[0]).toMatchObject({
      kind: "tool_start",
      callId: "toolu_top",
      name: "Glob",
      detail: "**/*.ts",
    });
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
    expect((done[0] as { detail?: string }).detail).toBe("ok");
  });

  it("keeps full shell/tool_result text instead of truncating to 160 chars", () => {
    const backend = new ClaudeCodeBackend();
    const ctx = {
      assistantBuf: { value: "" },
      gotTerminalEvent: { value: false },
    };
    backend.parseLine(
      {
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              id: "bash_1",
              name: "Bash",
              input: { command: "seq 1 50" },
            },
          ],
        },
      },
      ctx,
    );
    const longOut = Array.from({ length: 40 }, (_, i) => `line-${i + 1}`).join(
      "\n",
    );
    const done = backend.parseLine(
      {
        type: "user",
        message: {
          content: [
            {
              type: "tool_result",
              tool_use_id: "bash_1",
              content: longOut,
            },
          ],
        },
      },
      ctx,
    );
    expect(done[0]).toMatchObject({ kind: "tool_done", name: "Bash" });
    expect((done[0] as { detail: string }).detail).toContain("line-1");
    expect((done[0] as { detail: string }).detail).toContain("line-40");
    expect((done[0] as { detail: string }).detail.length).toBeGreaterThan(160);
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

  it("extracts a readable message from object result / error payloads", () => {
    const backend = new ClaudeCodeBackend();
    const objResult = backend.parseLine({
      type: "result",
      subtype: "success",
      result: [{ type: "text", text: "Hello there" }],
    });
    expect(objResult).toContainEqual({
      kind: "done",
      result: "Hello there",
    });

    const objError = backend.parseLine({
      type: "result",
      subtype: "error_during_execution",
      is_error: true,
      result: { message: "invalid api key" },
    });
    expect(objError).toContainEqual({
      kind: "error",
      message: "invalid api key",
    });

    const typed = backend.parseLine({
      type: "error",
      error: { message: "sandbox exploded" },
    });
    expect(typed).toContainEqual({
      kind: "error",
      message: "sandbox exploded",
    });
  });

  it("does not emit duplicate tool_start for the same tool_use id", () => {
    const backend = new ClaudeCodeBackend();
    const toolUse = {
      type: "assistant",
      message: {
        content: [
          {
            type: "tool_use",
            id: "toolu_dup",
            name: "Bash",
            input: { command: "pwd" },
          },
        ],
      },
    };
    const first = backend.parseLine(toolUse);
    const second = backend.parseLine(toolUse);
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({
      kind: "tool_start",
      callId: "toolu_dup",
    });
    expect(second).toEqual([]);
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
