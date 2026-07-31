import { describe, it, expect } from "vitest";
import {
  detectAgentConflicts,
  scopesOverlap,
  normalizePath,
  resolveAgentCwd,
  findScopeOverlap,
  formatScopeOverlapError,
} from "../server/agentConflicts.js";
import {
  CursorAgentBackend,
  coalesceTodoMessages,
  diffFromToolArgs,
  isTodoTool,
  resolveMessageTodos,
  todosFromToolArgs,
} from "../shared/backends/cursor.js";

describe("normalizePath", () => {
  it("normalizes slashes and trailing separators", () => {
    expect(normalizePath("backend\\api/")).toBe("backend/api");
    expect(normalizePath("./frontend")).toBe("frontend");
  });
});

describe("scopesOverlap", () => {
  it("detects equal and nested scopes", () => {
    expect(scopesOverlap("backend", "backend")).toBe(true);
    expect(scopesOverlap("backend", "backend/api")).toBe(true);
    expect(scopesOverlap("backend/api", "backend")).toBe(true);
    expect(scopesOverlap("backend", "frontend")).toBe(false);
  });
});

describe("resolveAgentCwd", () => {
  it("resolves relative scope under repo", () => {
    const cwd = resolveAgentCwd("/repo", "backend");
    expect(cwd.replace(/\\/g, "/")).toMatch(/\/repo\/backend$/);
  });

  it("rejects path traversal", () => {
    expect(() => resolveAgentCwd("/repo", "../outside")).toThrow(/escapes/);
  });
});

describe("findScopeOverlap", () => {
  it("rejects overlapping explicit scopes", () => {
    const overlap = findScopeOverlap(
      [
        {
          id: "a1",
          label: "Backend",
          status: "idle",
          scopePath: "backend",
        },
        {
          id: "a2",
          label: "API",
          status: "idle",
          scopePath: "backend/api",
        },
      ],
      "backend/services",
    );
    expect(overlap).toMatchObject({
      agentId: "a1",
      scopePath: "backend",
    });
    expect(formatScopeOverlapError(overlap!)).toContain("Backend");
  });

  it("allows whole-repo scope (null proposed)", () => {
    const overlap = findScopeOverlap(
      [
        {
          id: "a1",
          label: "Backend",
          status: "idle",
          scopePath: "backend",
        },
      ],
      null,
    );
    expect(overlap).toBeNull();
  });
});

describe("detectAgentConflicts", () => {
  it("flags shared touched files", () => {
    const conflicts = detectAgentConflicts([
      {
        id: "a1",
        status: "running",
        scopePath: null,
        touchedPaths: ["src/auth.ts"],
      },
      {
        id: "a2",
        status: "idle",
        scopePath: null,
        touchedPaths: ["src/auth.ts", "src/other.ts"],
      },
    ]);
    expect(conflicts.some((c) => c.paths.includes("src/auth.ts"))).toBe(true);
    expect(conflicts[0].agentIds.sort()).toEqual(["a1", "a2"]);
  });

  it("flags overlapping explicit scopes", () => {
    const conflicts = detectAgentConflicts([
      {
        id: "a1",
        status: "idle",
        scopePath: "backend",
        touchedPaths: [],
      },
      {
        id: "a2",
        status: "idle",
        scopePath: "backend/api",
        touchedPaths: [],
      },
    ]);
    expect(conflicts.length).toBeGreaterThan(0);
    expect(conflicts[0].agentIds.sort()).toEqual(["a1", "a2"]);
  });

  it("ignores stopped agents and null scopes for scope warnings", () => {
    const conflicts = detectAgentConflicts([
      {
        id: "a1",
        status: "stopped",
        scopePath: "backend",
        touchedPaths: ["x.ts"],
      },
      {
        id: "a2",
        status: "idle",
        scopePath: null,
        touchedPaths: ["x.ts"],
      },
      {
        id: "a3",
        status: "idle",
        scopePath: "frontend",
        touchedPaths: [],
      },
    ]);
    // stopped agent shouldn't create file conflict; null scope shouldn't create scope conflict
    expect(conflicts.length).toBe(0);
  });
});

describe("CursorAgentBackend", () => {
  const backend = new CursorAgentBackend();

  it("builds cursor agent args with resume", () => {
    const args = backend.buildArgs({
      prompt: "hello",
      modelId: "composer-2",
      sessionId: "sess-1",
    });
    expect(args).toContain("--resume");
    expect(args).toContain("sess-1");
    expect(args).toContain("--model");
    expect(args[args.length - 1]).toBe("hello");
  });

  it("parses system init session events", () => {
    const events = backend.parseLine({
      type: "system",
      subtype: "init",
      session_id: "abc",
    });
    expect(events).toEqual([{ kind: "session", sessionId: "abc" }]);
  });

  it("parses assistant deltas and tools", () => {
    const ctx = {
      assistantBuf: { value: "" },
      gotTerminalEvent: { value: false },
    };
    const delta = backend.parseLine(
      {
        type: "assistant",
        timestamp_ms: 1,
        message: { content: [{ text: "Hi" }] },
      },
      ctx,
    );
    expect(delta[0]).toMatchObject({ kind: "assistant_delta", text: "Hi" });

    const tool = backend.parseLine(
      {
        type: "tool_call",
        subtype: "started",
        call_id: "c1",
        tool_call: {
          writeToolCall: { args: { path: "a.ts", contents: "x" } },
        },
      },
      ctx,
    );
    expect(tool[0]).toMatchObject({
      kind: "tool_start",
      callId: "c1",
      name: "write",
      path: "a.ts",
    });
  });

  it("maps nested subagent tools", () => {
    const events = backend.parseLine({
      type: "tool_call",
      subtype: "started",
      call_id: "child",
      tool_call: {
        parentToolCallId: "parent",
        shellToolCall: { args: { command: "ls" } },
      },
    });
    expect(events[0]).toMatchObject({
      kind: "subagent_nested",
      parentCallId: "parent",
      callId: "child",
    });
  });

  it("parses TodoWrite tools with full structured todos", () => {
    const events = backend.parseLine({
      type: "tool_call",
      subtype: "completed",
      call_id: "t1",
      tool_call: {
        todoWriteToolCall: {
          args: {
            todos: [
              { id: "1", content: "Explore chat rendering", status: "completed" },
              {
                id: "2",
                content: "Show edit diffs in chat",
                status: "in_progress",
              },
              { id: "3", content: "Open PR", status: "pending" },
            ],
            merge: true,
          },
        },
      },
    });
    expect(events[0]).toMatchObject({
      kind: "tool_done",
      callId: "t1",
      name: "todoWrite",
    });
    expect(events[0].kind === "tool_done" && events[0].todos).toEqual([
      {
        id: "1",
        content: "Explore chat rendering",
        status: "completed",
      },
      {
        id: "2",
        content: "Show edit diffs in chat",
        status: "in_progress",
      },
      { id: "3", content: "Open PR", status: "pending" },
    ]);
    expect(
      events[0].kind === "tool_done" && events[0].detail,
    ).toContain("3 todos");
  });

  it("synthesizes a unified diff for StrReplace tool args", () => {
    const events = backend.parseLine({
      type: "tool_call",
      subtype: "completed",
      call_id: "e1",
      tool_call: {
        strReplaceToolCall: {
          args: {
            path: "web/components/ChatPanel.tsx",
            old_string: "const [open, setOpen] = useState(false);",
            new_string: "const [open, setOpen] = useState(true);",
          },
        },
      },
    });
    expect(events[0]).toMatchObject({
      kind: "tool_done",
      name: "strReplace",
      path: "web/components/ChatPanel.tsx",
    });
    expect(events[0].kind === "tool_done" && events[0].diffPatch).toContain(
      "-const [open, setOpen] = useState(false);",
    );
    expect(events[0].kind === "tool_done" && events[0].diffPatch).toContain(
      "+const [open, setOpen] = useState(true);",
    );
  });
});

describe("todo helpers", () => {
  it("detects todo tool names", () => {
    expect(isTodoTool("todoWrite")).toBe(true);
    expect(isTodoTool("TodoWriteToolCall")).toBe(true);
    expect(isTodoTool("write")).toBe(false);
  });

  it("normalizes todo statuses from mixed arg shapes", () => {
    const todos = todosFromToolArgs({
      items: [
        { id: "a", text: "One", status: "complete" },
        { content: "Two", status: "IN_PROGRESS" },
        { title: "Three", status: "canceled" },
      ],
    });
    expect(todos).toEqual([
      { id: "a", content: "One", status: "completed" },
      { id: "todo-2", content: "Two", status: "in_progress" },
      { id: "todo-3", content: "Three", status: "cancelled" },
    ]);
  });

  it("normalizes Cursor TODO_STATUS_* enums", () => {
    const todos = todosFromToolArgs({
      todos: [
        {
          id: "1",
          content: "Update LandingPage copy",
          status: "TODO_STATUS_COMPLETED",
        },
        {
          id: "2",
          content: "Show parsed todos",
          status: "TODO_STATUS_IN_PROGRESS",
        },
        {
          id: "3",
          content: "Open PR",
          status: "TODO_STATUS_PENDING",
        },
      ],
    });
    expect(todos).toEqual([
      {
        id: "1",
        content: "Update LandingPage copy",
        status: "completed",
      },
      {
        id: "2",
        content: "Show parsed todos",
        status: "in_progress",
      },
      { id: "3", content: "Open PR", status: "pending" },
    ]);
  });

  it("parses todoToolCall events with Cursor status enums", () => {
    const cursor = new CursorAgentBackend();
    const events = cursor.parseLine({
      type: "tool_call",
      subtype: "completed",
      call_id: "todo-1",
      tool_call: {
        todoToolCall: {
          args: {
            merge: true,
            todos: [
              {
                id: "1",
                content: "Update LandingPage copy + diagrams",
                status: "TODO_STATUS_COMPLETED",
                createdAt: "1785481521069",
              },
              {
                id: "2",
                content: "Fix tool lifecycle",
                status: "TODO_STATUS_IN_PROGRESS",
              },
            ],
          },
        },
      },
    });
    expect(events[0]).toMatchObject({
      kind: "tool_done",
      callId: "todo-1",
      name: "todo",
    });
    expect(events[0].kind === "tool_done" && events[0].todos).toEqual([
      {
        id: "1",
        content: "Update LandingPage copy + diagrams",
        status: "completed",
      },
      {
        id: "2",
        content: "Fix tool lifecycle",
        status: "in_progress",
      },
    ]);
    expect(
      events[0].kind === "tool_done" && events[0].detail,
    ).toContain("2 todos");
    expect(
      events[0].kind === "tool_done" && events[0].detail,
    ).not.toContain('{"todos"');
  });

  it("recovers todos from truncated JSON content", () => {
    const truncated =
      '{"todos":[{"id":"1","content":"Update LandingPage copy + diagrams for multi-agent Cursor/Claude","status":"TODO_STATUS_COMPLETED","createdAt":"1785481521069","u';
    const todos = resolveMessageTodos({ content: truncated });
    expect(todos.length).toBeGreaterThanOrEqual(1);
    expect(todos[0].content).toContain("Update LandingPage");
    expect(todos[0].status).toBe("completed");
  });

  it("coalesces stacked todo cards to the latest per agent", () => {
    const msgs = [
      {
        id: "t2",
        role: "tool",
        agentId: "a1",
        toolName: "todo",
        todos: [
          { id: "1", content: "One", status: "completed" as const },
          { id: "2", content: "Two", status: "pending" as const },
        ],
      },
      { id: "m1", role: "assistant", agentId: "a1" },
      {
        id: "t3",
        role: "tool",
        agentId: "a1",
        toolName: "todoWrite",
        todos: [
          { id: "1", content: "One", status: "completed" as const },
          { id: "2", content: "Two", status: "completed" as const },
          { id: "3", content: "Three", status: "in_progress" as const },
        ],
      },
      {
        id: "t4",
        role: "tool",
        agentId: "a1",
        toolName: "todo",
        todos: [
          { id: "1", content: "One", status: "completed" as const },
          { id: "2", content: "Two", status: "completed" as const },
          { id: "3", content: "Three", status: "completed" as const },
          { id: "4", content: "Four", status: "pending" as const },
        ],
      },
      {
        id: "other",
        role: "tool",
        agentId: "a2",
        toolName: "todo",
        todos: [{ id: "x", content: "Other agent", status: "pending" as const }],
      },
    ];
    const coalesced = coalesceTodoMessages(msgs);
    expect(coalesced.map((m) => m.id)).toEqual(["m1", "t4", "other"]);
    expect(coalesced.find((m) => m.id === "t4")?.todos).toHaveLength(4);
  });

  it("builds write diffs from contents", () => {
    const patch = diffFromToolArgs("Write", {
      path: "hello.ts",
      contents: "export const x = 1;\n",
    });
    expect(patch).toContain("new file mode");
    expect(patch).toContain("+export const x = 1;");
  });
});
