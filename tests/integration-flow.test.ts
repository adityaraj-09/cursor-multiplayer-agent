import { describe, expect, it } from "vitest";
import { isFeatureAgent, isIntegratorAgent } from "../shared/events.js";
import {
  buildIntegratePrompt,
  buildIntegrationPrBody,
  featureAgentSnapshots,
  integrationBranchName,
} from "../server/integration.js";

describe("integration helpers", () => {
  it("builds a stable integration branch name", () => {
    expect(integrationBranchName("room_abc12345", "My Room!!")).toBe(
      "steer/integration-my-room-roomabc1",
    );
  });

  it("filters feature agents and skips the integrator", () => {
    const agents = [
      { id: "a1", label: "A", kind: "feature", status: "idle", branch: "feat/a" },
      { id: "int", label: "Integrator", kind: "integrator", status: "idle" },
      { id: "a2", label: "B", kind: "feature", status: "stopped", branch: "feat/b" },
    ];
    expect(featureAgentSnapshots(agents).map((a) => a.id)).toEqual(["a1"]);
    expect(isIntegratorAgent({ kind: "integrator" })).toBe(true);
    expect(isFeatureAgent({ kind: "integrator" })).toBe(false);
    expect(isFeatureAgent({ kind: "feature" })).toBe(true);
  });

  it("writes a merge prompt that keeps every feature and reuses one PR", () => {
    const prompt = buildIntegratePrompt({
      roomName: "Launch",
      repoUrl: "https://github.com/acme/app",
      startingRef: "main",
      integrationBranch: "steer/integration-launch-abc",
      existingPrUrl: "https://github.com/acme/app/pull/4",
      source: {
        id: "ag_a",
        label: "Agent A",
        branch: "steer/claude-a",
        prUrl: "https://github.com/acme/app/pull/2",
      },
      agents: [
        {
          id: "ag_a",
          label: "Agent A",
          branch: "steer/claude-a",
          kind: "feature",
          status: "idle",
        },
        {
          id: "ag_b",
          label: "Agent B",
          branch: "steer/claude-b",
          kind: "feature",
          status: "idle",
        },
        {
          id: "ag_int",
          label: "Integrator",
          kind: "integrator",
          status: "idle",
        },
      ],
    });

    expect(prompt).toContain("steer/integration-launch-abc");
    expect(prompt).toContain("steer/claude-a");
    expect(prompt).toContain("Agent B");
    expect(prompt).toContain("Do not open a second PR");
    expect(prompt).toContain("BOTH sides");
    expect(prompt).not.toContain("Integrator (ag_int)");
    expect(prompt).toContain("https://github.com/acme/app/pull/4");
  });

  it("lists included branches in the integration PR body", () => {
    const body = buildIntegrationPrBody({
      roomName: "Launch",
      startingRef: "main",
      integrationBranch: "steer/integration-launch-abc",
      sourceId: "ag_b",
      agents: [
        { id: "ag_a", label: "A", branch: "feat/a", kind: "feature" },
        { id: "ag_b", label: "B", branch: "feat/b", kind: "feature" },
        { id: "ag_int", label: "Integrator", kind: "integrator" },
      ],
    });
    expect(body).toContain("feat/a");
    expect(body).toContain("feat/b");
    expect(body).toContain("(just merged)");
    expect(body).not.toContain("Integrator");
  });
});
