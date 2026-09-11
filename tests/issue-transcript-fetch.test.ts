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
  const conversation = vi.fn(async () => {
    throw new Error("conversation() should not be called");
  });
  return {
    agentId: "bc-issue",
    status: "finished",
    supports: (op) => op === "conversation",
    unsupportedReason: () => undefined,
    stream: async function* () {},
    wait: async () => ({ id: overrides.id, status: "finished", result: "done" }),
    cancel: async () => {},
    conversation,
    onDidChangeStatus: () => () => {},
    ...overrides,
  };
}

describe("loadIssueTranscript", () => {
  beforeEach(() => {
    vi.mocked(Agent.listRuns).mockReset();
  });

  it("loads run summaries from the stored cursorAgentId without replaying streams", async () => {
    const conversation = vi.fn(async () => []);
    vi.mocked(Agent.listRuns).mockResolvedValue({
      items: [
        makeRun({
          id: "run_later",
          createdAt: 200,
          result: "Opened a PR.",
          conversation,
        }),
        makeRun({
          id: "run_first",
          createdAt: 100,
          result: "Inspected src/a.ts",
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
      limit: 8,
    });
    expect(transcript.available).toBe(true);
    expect(transcript.runs.map((run) => run.id)).toEqual(["run_first", "run_later"]);
    expect(transcript.items.map((item) => item.text)).toEqual([
      "Inspected src/a.ts",
      "Opened a PR.",
    ]);
    expect(conversation).not.toHaveBeenCalled();
  });

  it("keeps a running marker when the latest Cursor run has no result yet", async () => {
    vi.mocked(Agent.listRuns).mockResolvedValue({
      items: [
        makeRun({
          id: "run_plain",
          status: "running",
          result: undefined,
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
        id: "run_plain:running",
        kind: "tool",
        text: "Run in progress",
        toolName: "run",
        status: "running",
        runId: "run_plain",
      },
    ]);
  });
});
