import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Agent, AgentBusyError } from "@cursor/sdk";
import type { Run, SDKAgent, SDKMessage } from "@cursor/sdk";
import { SdkAgentSession, type SdkStreamEvent } from "../server/sdkAgent.js";

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

const STREAM_GONE = new Error("Run stream is no longer available");
const AGENT_BUSY = new AgentBusyError(
  "[agent_busy] Agent already has an active run",
);

function assistantMsg(text: string): SDKMessage {
  return {
    type: "assistant",
    agent_id: "bc-test",
    run_id: "run-1",
    message: {
      role: "assistant",
      content: [{ type: "text", text }],
    },
  };
}

function makeRun(overrides: Partial<Run> & Pick<Run, "id">): Run {
  return {
    agentId: "bc-test",
    status: "running",
    supports: () => true,
    unsupportedReason: () => undefined,
    stream: async function* () {},
    wait: async () => ({
      id: overrides.id,
      status: "finished",
      result: "done",
    }),
    cancel: async () => {},
    conversation: async () => [],
    onDidChangeStatus: () => () => {},
    ...overrides,
  };
}

function fakeAgent(send: SDKAgent["send"]): SDKAgent {
  return {
    agentId: "bc-test",
    model: { id: "composer-1" },
    send,
    close: vi.fn(),
    reload: vi.fn(async () => {}),
    [Symbol.asyncDispose]: vi.fn(async () => {}),
    listArtifacts: vi.fn(async () => []),
    downloadArtifact: vi.fn(async () => Buffer.from("")),
  };
}

describe("SdkAgentSession run stream recovery", () => {
  beforeEach(() => {
    vi.mocked(Agent.resume).mockReset();
    vi.mocked(Agent.getRun).mockReset();
    vi.mocked(Agent.listRuns).mockReset();
    vi.mocked(Agent.getRun).mockRejectedValue(new Error("no run"));
    vi.mocked(Agent.listRuns).mockResolvedValue({ items: [] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function session() {
    return new SdkAgentSession({
      runtime: "cloud",
      apiKey: "test-key",
      model: { id: "composer-1" },
      name: "test",
      agentId: "bc-test",
      repoUrl: "https://github.com/acme/repo",
    });
  }

  it("waits out a dropped Send stream and still emits the run result", async () => {
    const run = makeRun({
      id: "run-dropped",
      stream: async function* () {
        yield assistantMsg("working");
        throw STREAM_GONE;
      },
      wait: async () => ({
        id: "run-dropped",
        status: "finished",
        result: "shipped in the background",
      }),
    });
    const send = vi.fn(async () => run);
    vi.mocked(Agent.resume).mockResolvedValue(fakeAgent(send));
    vi.mocked(Agent.getRun).mockResolvedValue({
      ...run,
      status: "finished",
      result: "shipped in the background",
      stream: async function* () {
        throw STREAM_GONE;
      },
    });

    const events: SdkStreamEvent[] = [];
    await session().run("do the thing", (e) => events.push(e));

    expect(send).toHaveBeenCalledTimes(1);
    expect(events.some((e) => e.kind === "assistant_delta")).toBe(true);
    expect(events).toContainEqual({
      kind: "done",
      result: "shipped in the background",
      git: undefined,
    });
    expect(
      events.filter(
        (e) =>
          e.kind === "error" &&
          e.message.toLowerCase().includes("no longer available"),
      ),
    ).toHaveLength(0);
  });

  it("joins a leftover cloud run on agent_busy then sends the new prompt", async () => {
    const leftover = makeRun({
      id: "run-old",
      stream: async function* () {
        throw STREAM_GONE;
      },
      wait: async () => ({
        id: "run-old",
        status: "finished",
        result: "previous turn finished",
      }),
    });
    const next = makeRun({
      id: "run-new",
      stream: async function* () {
        yield assistantMsg("new reply");
      },
      wait: async () => ({
        id: "run-new",
        status: "finished",
        result: "new reply",
      }),
    });
    const send = vi
      .fn()
      .mockRejectedValueOnce(AGENT_BUSY)
      .mockResolvedValueOnce(next);
    vi.mocked(Agent.resume).mockResolvedValue(fakeAgent(send));
    vi.mocked(Agent.listRuns).mockResolvedValue({ items: [leftover] });
    vi.mocked(Agent.getRun).mockImplementation(async (id: string) => {
      if (id === "run-old") {
        return { ...leftover, status: "finished", result: "previous turn finished" };
      }
      return next;
    });

    const events: SdkStreamEvent[] = [];
    await session().run("follow up", (e) => events.push(e));

    expect(send).toHaveBeenCalledTimes(2);
    expect(events.map((e) => e.kind)).toContain("done");
    expect(
      events.some(
        (e) => e.kind === "done" && e.result === "previous turn finished",
      ),
    ).toBe(true);
    expect(
      events.some((e) => e.kind === "done" && e.result === "new reply"),
    ).toBe(true);
    expect(
      events.filter(
        (e) =>
          e.kind === "error" && e.message.toLowerCase().includes("agent_busy"),
      ),
    ).toHaveLength(0);
  });
});
