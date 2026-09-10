import { beforeEach, describe, expect, it, vi } from "vitest";
import { Agent } from "@cursor/sdk";
import type { Run } from "@cursor/sdk";
import { loadIssueTranscript } from "../server/issueTranscript.js";

vi.mock("@cursor/sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@cursor/sdk")>();
  return {
    ...actual,
    Agent: {
      create: vi.fn(),
      resume: vi.fn(),
      getRun: vi.fn(),
      listRuns: vi.fn(),
    },
  };
});

function makeRun(overrides: Partial<Run> & Pick<Run, "id">): Run {
  return {
    agentId: "bc-issue",
    status: "finished",
    supports: (op) => op === "conversation",
    unsupportedReason: () => undefined,
    stream: async function* () {},
    wait: async () => ({ id: overrides.id, status: "finished", result: "done" }),
    cancel: async () => {},
    conversation: async () => [],
    onDidChangeStatus: () => () => {},
    ...overrides,
  };
}

describe("loadIssueTranscript", () => {
  beforeEach(() => {
    vi.mocked(Agent.listRuns).mockReset();
  });

  it("loads conversation history only from the stored cursorAgentId", async () => {
    const conversation = vi.fn(async () => [
      {
        type: "agentConversationTurn",
        turn: {
          userMessage: { text: "You are fixing Steer issue iss_9." },
          steps: [
            {
              type: "assistantMessage",
              message: { text: "Opened a PR." },
            },
          ],
        },
      },
    ]);
    vi.mocked(Agent.listRuns).mockResolvedValue({
      items: [
        makeRun({
          id: "run_later",
          createdAt: 200,
          conversation,
        }),
        makeRun({
          id: "run_first",
          createdAt: 100,
          conversation: async () => [
            {
              type: "agentConversationTurn",
              turn: {
                steps: [
                  {
                    type: "toolCall",
                    message: { type: "read", args: { path: "src/a.ts" } },
                  },
                ],
              },
            },
          ],
        }),
      ],
    });

    const transcript = await loadIssueTranscript({
      cursorAgentId: "bc-issue",
      apiKey: "key-test",
      live: false,
    });

    expect(Agent.listRuns).toHaveBeenCalledWith("bc-issue", {
      runtime: "cloud",
      apiKey: "key-test",
      limit: 25,
    });
    expect(transcript.available).toBe(true);
    expect(transcript.runs.map((run) => run.id)).toEqual(["run_first", "run_later"]);
    expect(transcript.items.map((item) => item.kind)).toEqual([
      "tool",
      "user",
      "assistant",
    ]);
    expect(transcript.items[2]?.text).toBe("Opened a PR.");
    expect(conversation).toHaveBeenCalledTimes(1);
  });

  it("falls back to run.result when conversation is unsupported", async () => {
    vi.mocked(Agent.listRuns).mockResolvedValue({
      items: [
        makeRun({
          id: "run_plain",
          result: "All tests passed.",
          supports: () => false,
        }),
      ],
    });

    const transcript = await loadIssueTranscript({
      cursorAgentId: "bc-issue",
      apiKey: "key-test",
      live: true,
    });
    expect(transcript.live).toBe(true);
    expect(transcript.items).toEqual([
      {
        id: "run_plain:result",
        kind: "assistant",
        text: "All tests passed.",
        runId: "run_plain",
      },
    ]);
  });
});
