import { describe, expect, it } from "vitest";
import { CodexBackend } from "../shared/backends/codex.js";
import {
  getBackend,
  isBackendAvailable,
  isCliSandboxBackend,
  parseAgentBackendKind,
} from "../shared/backends/index.js";

describe("CodexBackend", () => {
  it("is available and registered", () => {
    expect(isBackendAvailable("codex")).toBe(true);
    expect(getBackend("codex").kind).toBe("codex");
    expect(isCliSandboxBackend("codex")).toBe(true);
    expect(parseAgentBackendKind("codex")).toBe("codex");
  });

  it("builds headless exec args with model and resume", () => {
    const backend = new CodexBackend();
    const args = backend.buildArgs({
      prompt: "fix the bug",
      modelId: "gpt-6-sol",
      sessionId: "thread-abc",
    });
    expect(args).toEqual([
      "exec",
      "--json",
      "--dangerously-bypass-approvals-and-sandbox",
      "--model",
      "gpt-6-sol",
      "resume",
      "thread-abc",
      "fix the bug",
    ]);
  });

  it("uses read-only sandbox in plan mode", () => {
    const backend = new CodexBackend();
    const args = backend.buildArgs({
      prompt: "propose a plan",
      modelId: "auto",
      mode: "plan",
    });
    expect(args).toEqual([
      "exec",
      "--json",
      "--sandbox",
      "read-only",
      "propose a plan",
    ]);
  });

  it("parses thread.started as session", () => {
    const backend = new CodexBackend();
    expect(
      backend.parseLine({ type: "thread.started", thread_id: "thr_1" }),
    ).toEqual([{ kind: "session", sessionId: "thr_1" }]);
  });

  it("maps agent_message item updates to assistant events", () => {
    const backend = new CodexBackend();
    const ctx = {
      assistantBuf: { value: "" },
      gotTerminalEvent: { value: false },
    };
    const delta = backend.parseLine(
      {
        type: "item.updated",
        item: { id: "m1", type: "agent_message", text: "Hello" },
      },
      ctx,
    );
    expect(delta[0]).toMatchObject({ kind: "assistant_delta", text: "Hello" });
    const final = backend.parseLine(
      {
        type: "item.completed",
        item: { id: "m1", type: "agent_message", text: "Hello world" },
      },
      ctx,
    );
    expect(final[0]).toMatchObject({
      kind: "assistant_final",
      text: "Hello world",
    });
  });

  it("maps command_execution items to Bash tools", () => {
    const backend = new CodexBackend();
    const start = backend.parseLine({
      type: "item.started",
      item: { id: "c1", type: "command_execution", command: "ls -la" },
    });
    expect(start[0]).toMatchObject({
      kind: "tool_start",
      callId: "c1",
      name: "Bash",
      detail: "ls -la",
    });
    const done = backend.parseLine({
      type: "item.completed",
      item: {
        id: "c1",
        type: "command_execution",
        command: "ls -la",
        aggregated_output: "README.md",
      },
    });
    expect(done[0]).toMatchObject({
      kind: "tool_done",
      callId: "c1",
      name: "Bash",
    });
    expect((done[0] as { detail: string }).detail).toContain("README.md");
  });

  it("maps file_change items and turn.completed", () => {
    const backend = new CodexBackend();
    const ctx = {
      assistantBuf: { value: "done" },
      gotTerminalEvent: { value: false },
    };
    const start = backend.parseLine({
      type: "item.started",
      item: {
        id: "f1",
        type: "file_change",
        path: "src/a.ts",
      },
    });
    expect(start[0]).toMatchObject({
      kind: "tool_start",
      name: "Edit",
      path: "src/a.ts",
    });
    const done = backend.parseLine(
      { type: "turn.completed" },
      ctx,
    );
    expect(ctx.gotTerminalEvent.value).toBe(true);
    expect(done).toEqual([{ kind: "done", result: "done" }]);
  });

  it("maps turn.failed and error events", () => {
    const backend = new CodexBackend();
    const failed = backend.parseLine({
      type: "turn.failed",
      error: { message: "boom" },
    });
    expect(failed).toEqual([{ kind: "error", message: "boom" }]);
    const err = backend.parseLine({ type: "error", message: "nope" });
    expect(err).toEqual([{ kind: "error", message: "nope" }]);
  });
});
