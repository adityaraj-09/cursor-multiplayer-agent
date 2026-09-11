import { describe, expect, it } from "vitest";
import {
  conversationTurnsToItems,
  emptyIssueTranscript,
} from "../shared/issueTranscript.js";

describe("conversationTurnsToItems", () => {
  it("flattens an agent conversation turn into chat items", () => {
    const items = conversationTurnsToItems("run_1", [
      {
        type: "agentConversationTurn",
        turn: {
          userMessage: { text: "You are fixing Steer issue iss_1 in https://github.com/acme/widget (base branch: main)." },
          steps: [
            {
              type: "thinkingMessage",
              message: { text: "Look at the button handler" },
            },
            {
              type: "toolCall",
              message: {
                type: "grep",
                args: { pattern: "onClick", path: "src/App.tsx" },
              },
            },
            {
              type: "toolCall",
              message: {
                type: "shell",
                args: { command: "npm test" },
                result: {
                  status: "success",
                  value: { exitCode: 0, stdout: "ok\n", stderr: "", signal: "", executionTime: 12 },
                },
              },
            },
            {
              type: "assistantMessage",
              message: { text: "## Cause\nNull check\n" },
            },
          ],
        },
      },
    ]);

    expect(items.map((item) => item.kind)).toEqual([
      "user",
      "thinking",
      "tool",
      "tool",
      "assistant",
    ]);
    expect(items[0]?.text).toContain("Steer issue iss_1");
    expect(items[2]).toMatchObject({
      kind: "tool",
      toolName: "grep",
      path: "src/App.tsx",
      status: "running",
    });
    expect(items[3]).toMatchObject({
      kind: "tool",
      toolName: "shell",
      detail: "ok",
      status: "done",
    });
    expect(items[4]?.text).toContain("## Cause");
    expect(items.every((item) => item.runId === "run_1")).toBe(true);
    expect(new Set(items.map((item) => item.id)).size).toBe(items.length);
  });

  it("converts shell conversation turns and ignores empty payloads", () => {
    const items = conversationTurnsToItems("run_2", [
      {
        type: "shellConversationTurn",
        turn: {
          shellCommand: { command: "ls src" },
          shellOutput: { stdout: "App.tsx\n", stderr: "", exitCode: 0 },
        },
      },
      { type: "agentConversationTurn", turn: { steps: [] } },
      null,
      "nope",
    ]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      kind: "tool",
      toolName: "shell",
      text: "ls src",
      status: "done",
    });
  });

  it("marks failed tools and surfaces error text", () => {
    const items = conversationTurnsToItems("run_3", [
      {
        type: "agentConversationTurn",
        turn: {
          steps: [
            {
              type: "toolCall",
              message: {
                type: "write",
                args: { path: "src/fix.ts", fileText: "export const x = 1" },
                result: { status: "error", error: { message: "permission denied" } },
              },
            },
          ],
        },
      },
    ]);
    expect(items[0]).toMatchObject({
      kind: "tool",
      toolName: "write",
      path: "src/fix.ts",
      status: "error",
      detail: "permission denied",
    });
  });

  it("returns an empty transcript helper without Cursor fields invented", () => {
    expect(emptyIssueTranscript({ live: true })).toEqual({
      cursorAgentId: null,
      available: false,
      live: true,
      error: null,
      runs: [],
      items: [],
    });
  });
});
