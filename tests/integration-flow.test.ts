import { describe, expect, it } from "vitest";
import { randomUUID } from "crypto";
import { isFeatureAgent, isIntegratorAgent } from "../shared/events.js";
import {
  buildFeatureAgentGitRules,
  buildIntegratePrompt,
  buildIntegrationPrBody,
  buildIntegrationPrComment,
  cursorModelForIntegrator,
  extractGithubPrUrl,
  featureAgentSnapshots,
  integrationBranchName,
  isBaseBranch,
  isUsableIntegrator,
  liveFeatureAgents,
  resolveIntegratorGitResult,
} from "../server/integration.js";
import {
  dequeueNextIntegrationJob,
  enqueueIntegrationJob,
  isLockFresh,
  releaseIntegrationLock,
  tryAcquireIntegrationLock,
} from "../server/integrationLock.js";

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
    expect(prompt).toContain("Never open a PR from any other branch");
    expect(prompt).toContain("BOTH sides");
    expect(prompt).toContain("HARD GATE");
    expect(prompt).toContain("merge origin/main");
    expect(prompt).toContain("never force-push");
    expect(prompt).not.toContain("Integrator (ag_int)");
    expect(prompt).toContain("https://github.com/acme/app/pull/4");
    expect(prompt).toContain("Cursor cloud agent");
    expect(prompt).toContain("steer/claude-*");
    expect(prompt).toContain("Fetch origin");
    expect(prompt).toContain("sandbox branch");
    expect(prompt).toContain("gh pr create");
    expect(prompt).toContain("Do not wait for human approval");
  });

  it("extracts a GitHub PR URL from integrator notes", () => {
    expect(
      extractGithubPrUrl(
        "Done.\nPR: https://github.com/acme/app/pull/12\nChecks passed.",
      ),
    ).toBe("https://github.com/acme/app/pull/12");
    expect(extractGithubPrUrl("PR is queued for you")).toBeNull();
  });

  it("only reuses a live Cursor integrator", () => {
    expect(
      isUsableIntegrator({
        kind: "integrator",
        backend: "cursor",
        status: "idle",
      }),
    ).toBe(true);
    expect(
      isUsableIntegrator({
        kind: "integrator",
        backend: "claude-code",
        status: "idle",
      }),
    ).toBe(false);
    expect(
      isUsableIntegrator({
        kind: "integrator",
        backend: "cursor",
        status: "stopped",
      }),
    ).toBe(false);
    expect(
      isUsableIntegrator({
        kind: "feature",
        backend: "cursor",
        status: "idle",
      }),
    ).toBe(false);
  });

  it("picks a Cursor model for the Integrator", () => {
    expect(
      cursorModelForIntegrator("claude-sonnet-4-6", "composer-2.5"),
    ).toBe("composer-2.5");
    expect(cursorModelForIntegrator("gpt-5.2", "composer-2.5")).toBe("gpt-5.2");
    expect(cursorModelForIntegrator("sonnet", "claude-opus-4-8", "auto")).toBe(
      "auto",
    );
  });

  it("does not adopt a Cursor sandbox branch as the integration head", () => {
    const kept = resolveIntegratorGitResult({
      assignedBranch: "steer/integration-launch-abc",
      reportedBranch: "cursor/sandbox-xyz",
      reportedPrUrl: "https://github.com/acme/app/pull/99",
      existingPrUrl: "https://github.com/acme/app/pull/4",
    });
    expect(kept.branch).toBe("steer/integration-launch-abc");
    expect(kept.prUrl).toBe("https://github.com/acme/app/pull/4");

    const matched = resolveIntegratorGitResult({
      assignedBranch: "steer/integration-launch-abc",
      reportedBranch: "steer/integration-launch-abc",
      reportedPrUrl: "https://github.com/acme/app/pull/8",
    });
    expect(matched.prUrl).toBe("https://github.com/acme/app/pull/8");
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

  it("tells feature agents to stay on one branch and not PR main", () => {
    const rules = buildFeatureAgentGitRules({
      agentLabel: "Agent A",
      assignedBranch: "steer/claude-a-1",
      startingRef: "main",
    });
    expect(rules).toContain("<steer_git_rules>");
    expect(rules).toContain("steer/claude-a-1");
    expect(rules).toContain("Do not open a pull request targeting `main`");
    expect(rules).toContain("Never push");
    expect(isBaseBranch("main", "main")).toBe(true);
    expect(isBaseBranch("steer/claude-a", "main")).toBe(false);
    expect(
      liveFeatureAgents([
        { kind: "feature", status: "idle" },
        { kind: "integrator", status: "idle" },
        { kind: "feature", status: "stopped" },
      ]).length,
    ).toBe(1);
  });

  it("asks humans to spot-check the resolution on the PR comment", () => {
    const comment = buildIntegrationPrComment({
      sourceLabel: "Agent B",
      sourceBranch: "feat/b",
      integrationBranch: "steer/integration-x",
      notes: "Kept both login forms under /login and /login-v2.",
    });
    expect(comment).toContain("Agent B");
    expect(comment).toContain("spot-check");
    expect(comment).toContain("Kept both login forms");
  });
});

describe("integration lock + queue", () => {
  it("treats expired locks as stale", () => {
    expect(isLockFresh({ expires_at: Date.now() - 1 })).toBe(false);
    expect(isLockFresh({ expires_at: Date.now() + 10_000 })).toBe(true);
  });

  it("queues a second integrate instead of stealing a live lock", async () => {
    const db = await import("../server/db/index.js");
    const roomId = randomUUID();
    db.createRoom({
      id: roomId,
      name: "Lock room",
      repoPath: "/tmp",
      agentCommand: "echo",
      runtime: "cloud",
      authMode: "server",
      modelId: "auto",
    });

    const first = tryAcquireIntegrationLock({
      roomId,
      heldBy: "ij_a",
      sourceAgentId: "ag_a",
      actorUserId: "user_a",
    });
    expect(first.ok).toBe(true);

    const second = tryAcquireIntegrationLock({
      roomId,
      heldBy: "ij_b",
      sourceAgentId: "ag_b",
      actorUserId: "user_b",
    });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.lock.source_agent_id).toBe("ag_a");

    const queued = enqueueIntegrationJob({
      roomId,
      sourceAgentId: "ag_b",
      actorUserId: "user_b",
    });
    const again = enqueueIntegrationJob({
      roomId,
      sourceAgentId: "ag_b",
      actorUserId: "user_b",
    });
    expect(again.id).toBe(queued.id);

    expect(releaseIntegrationLock(roomId, "ij_a")).toBe(true);
    const next = dequeueNextIntegrationJob(roomId);
    expect(next?.source_agent_id).toBe("ag_b");
    expect(dequeueNextIntegrationJob(roomId)).toBeUndefined();
  });

  it("extends a stale lock when the holder is still running", async () => {
    const db = await import("../server/db/index.js");
    const roomId = randomUUID();
    db.createRoom({
      id: roomId,
      name: "Stale room",
      repoPath: "/tmp",
      agentCommand: "echo",
      runtime: "cloud",
      authMode: "server",
      modelId: "auto",
    });
    const now = Date.now();
    tryAcquireIntegrationLock({
      roomId,
      heldBy: "ij_old",
      sourceAgentId: "ag_a",
      now,
      ttlMs: 1,
    });
    const steal = tryAcquireIntegrationLock({
      roomId,
      heldBy: "ij_new",
      sourceAgentId: "ag_b",
      now: now + 50,
      holderStillRunning: true,
      ttlMs: 60_000,
    });
    expect(steal.ok).toBe(false);
    if (!steal.ok) {
      expect(steal.lock.held_by).toBe("ij_old");
      expect(steal.lock.expires_at).toBeGreaterThan(now);
    }
  });
});
