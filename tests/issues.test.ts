import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "crypto";
import {
  buildIssueFixPrompt,
  buildIssueWriteupPrompt,
  canCancelIssue,
  canQueueIssue,
  canRetryIssue,
  clampMaxConcurrent,
  clampPickupDelayMs,
  issueSettingsScopeKey,
  parseGithubHttpsRepo,
  sanitizeIssueWriteup,
  looksLikeIssueWriteup,
  buildFallbackIssueWriteup,
} from "../shared/issues.js";

describe("issue helpers", () => {
  it("clamps pickup delay and concurrency", () => {
    expect(clampPickupDelayMs(undefined)).toBe(10 * 60 * 1000);
    expect(clampPickupDelayMs(-5)).toBe(0);
    expect(clampPickupDelayMs(3 * 24 * 60 * 60 * 1000)).toBe(24 * 60 * 60 * 1000);
    expect(clampMaxConcurrent(0)).toBe(1);
    expect(clampMaxConcurrent(99)).toBe(8);
  });

  it("parses github repo URLs", () => {
    expect(parseGithubHttpsRepo("https://github.com/acme/widget.git")).toBe(
      "https://github.com/acme/widget",
    );
    expect(parseGithubHttpsRepo("https://gitlab.com/acme/widget")).toBeNull();
  });

  it("scopes settings to user or org", () => {
    expect(issueSettingsScopeKey({ userId: "u1" })).toBe("user:u1");
    expect(issueSettingsScopeKey({ userId: "u1", orgId: "personal" })).toBe(
      "user:u1",
    );
    expect(issueSettingsScopeKey({ userId: "u1", orgId: "org_1" })).toBe(
      "org:org_1",
    );
  });

  it("sanitizes writeup markdown only", () => {
    expect(sanitizeIssueWriteup("```markdown\n## Cause\nRace\n```")).toBe(
      "## Cause\nRace",
    );
    expect(sanitizeIssueWriteup("```md ## Cause\nRace```")).toBe(
      "## Cause\nRace",
    );
    expect(sanitizeIssueWriteup("plain")).toBe("plain");
    expect(looksLikeIssueWriteup("## Cause\nRace")).toBe(true);
    expect(looksLikeIssueWriteup("ok")).toBe(false);
    expect(buildFallbackIssueWriteup({ title: "Bug", prUrl: "https://x/p/1" })).toContain(
      "did not return a markdown writeup",
    );
  });

  it("builds unattended prompts that forbid repo writeups", () => {
    const fix = buildIssueFixPrompt({
      issueId: "iss_1",
      title: "Bug",
      description: "Broken",
      repoUrl: "https://github.com/acme/widget",
      startingRef: "main",
    });
    expect(fix).toContain("Do not create or edit markdown");
    expect(fix).toContain("Do not ask clarifying questions");
    const writeup = buildIssueWriteupPrompt({
      issueId: "iss_1",
      title: "Bug",
      prUrl: "https://github.com/acme/widget/pull/2",
    });
    expect(writeup).toContain("Markdown only");
    expect(writeup).toContain("Do not create or edit any files");
  });

  it("allows the expected status transitions", () => {
    expect(canQueueIssue("draft")).toBe(true);
    expect(canQueueIssue("running")).toBe(false);
    expect(canCancelIssue("queued")).toBe(true);
    expect(canCancelIssue("done")).toBe(false);
    expect(canRetryIssue("failed")).toBe(true);
    expect(canRetryIssue("queued")).toBe(false);
  });
});

describe("issue persistence", () => {
  let db: typeof import("../server/db.js");
  const userId = `user_issue_${randomUUID()}`;

  beforeAll(async () => {
    db = await import("../server/db.js");
    db.createUser(userId, `${userId}@example.com`, "Issue Owner", "x");
  });

  afterAll(() => {
    // leave rows; test db is temp
  });

  it("creates, claims, and stores a markdown writeup without a room", () => {
    const roomsBefore = db.listRooms().length;
    const issue = db.createIssue({
      id: `iss_${randomUUID().slice(0, 8)}`,
      creatorId: userId,
      title: "Broken button",
      description: "Click does nothing",
      repoUrl: "https://github.com/acme/widget",
      status: "queued",
      pickupDelayMs: 0,
      runAfter: Date.now() - 1000,
    });
    expect(issue.status).toBe("queued");
    expect(db.listRooms().length).toBe(roomsBefore);

    const due = db.listDueIssueCandidates(Date.now());
    expect(due.some((row) => row.id === issue.id)).toBe(true);

    const claimed = db.claimIssue(issue.id, Date.now(), Date.now() + 60_000);
    expect(claimed?.status).toBe("running");
    expect(claimed?.attempt).toBe(1);

    const claimedAgain = db.claimIssue(issue.id, Date.now(), Date.now() + 60_000);
    expect(claimedAgain).toBeUndefined();

    db.updateIssue(issue.id, {
      status: "in_review",
      prUrl: "https://github.com/acme/widget/pull/9",
      writeupMd: "## Cause\nNull check\n\n## Solution\nGuard the click",
      finishedAt: Date.now(),
    });
    const done = db.getIssue(issue.id);
    expect(done?.pr_url).toContain("/pull/9");
    expect(done?.writeup_md).toContain("## Cause");
    expect(db.listRooms().length).toBe(roomsBefore);
  });

  it("keeps personal and org lists separate and stores settings", () => {
    const ownerId = `user_issue_org_${randomUUID()}`;
    db.createUser(ownerId, `${ownerId}@acme.com`, "Org Owner", "x");
    const org = db.createOrganization({
      id: `org_${randomUUID().slice(0, 8)}`,
      name: "Acme",
      slug: `acme-${Date.now()}`,
      createdBy: ownerId,
    });
    db.addOrganizationMember(org.id, ownerId, "owner");

    db.createIssue({
      id: `iss_${randomUUID().slice(0, 8)}`,
      creatorId: ownerId,
      title: "Personal only",
      repoUrl: "https://github.com/acme/widget",
      status: "queued",
      pickupDelayMs: 1000,
      runAfter: Date.now() + 10_000,
    });
    db.createIssue({
      id: `iss_${randomUUID().slice(0, 8)}`,
      orgId: org.id,
      creatorId: ownerId,
      title: "Team issue",
      repoUrl: "https://github.com/acme/widget",
      status: "queued",
      pickupDelayMs: 1000,
      runAfter: Date.now() + 10_000,
    });

    expect(
      db.listPersonalIssuesByUser(ownerId).every((row) => !row.org_id),
    ).toBe(true);
    expect(db.listIssuesByOrg(org.id).map((row) => row.title)).toContain(
      "Team issue",
    );

    const settings = db.upsertIssueSettings({
      scopeKey: `org:${org.id}`,
      defaultPickupDelayMs: 120000,
      autoStart: false,
      modelId: "composer-2.5",
      maxConcurrent: 3,
    });
    expect(settings.auto_start).toBe(0);
    expect(settings.max_concurrent).toBe(3);
    expect(db.getIssueSettings(`org:${org.id}`)?.default_pickup_delay_ms).toBe(
      120000,
    );
  });

  it("recovers a stale running lease", () => {
    const issue = db.createIssue({
      id: `iss_${randomUUID().slice(0, 8)}`,
      creatorId: userId,
      title: "Stale",
      repoUrl: "https://github.com/acme/widget",
      status: "queued",
      pickupDelayMs: 0,
      runAfter: Date.now() - 10,
    });
    const claimed = db.claimIssue(issue.id, Date.now(), Date.now() - 5);
    expect(claimed?.status).toBe("running");
    db.recoverStaleIssueLeases(Date.now(), 3);
    expect(db.getIssue(issue.id)?.status).toBe("queued");
  });
});
