import { describe, it, expect } from "vitest";
import {
  detectAgentConflicts,
  scopesOverlap,
  normalizePath,
  resolveAgentCwd,
} from "../server/agentConflicts.js";
import { CursorAgentBackend } from "../shared/backends/cursor.js";

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
});
