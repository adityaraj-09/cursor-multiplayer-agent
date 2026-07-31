import { describe, expect, it, beforeAll, afterAll } from "vitest";
import {
  canManageOrg,
  formatAllowedDomains,
  normalizeEmailDomain,
  parseAllowedDomains,
  slugifyOrgName,
} from "../shared/orgs.js";

describe("org helpers", () => {
  it("parses and formats allowed domains", () => {
    expect(parseAllowedDomains("Acme.com, @acme.io  foo.org")).toEqual([
      "acme.com",
      "acme.io",
      "foo.org",
    ]);
    expect(formatAllowedDomains(["@Acme.com", "acme.io"])).toBe(
      "acme.com,acme.io",
    );
    expect(normalizeEmailDomain("Dev@Acme.COM")).toBe("acme.com");
  });

  it("slugifies org names", () => {
    expect(slugifyOrgName("Acme Engineering!")).toBe("acme-engineering");
    expect(slugifyOrgName("   ")).toBe("team");
  });

  it("recognizes admin roles", () => {
    expect(canManageOrg("owner")).toBe(true);
    expect(canManageOrg("admin")).toBe(true);
    expect(canManageOrg("member")).toBe(false);
  });
});

describe("organization persistence", () => {
  const prevSecret = process.env.KEY_ENCRYPTION_SECRET;
  let db: typeof import("../server/db.js");
  let orgKeys: typeof import("../server/orgKeys.js");

  beforeAll(async () => {
    process.env.KEY_ENCRYPTION_SECRET =
      "test-secret-for-org-keys-32-bytes!!!!";
    db = await import("../server/db.js");
    orgKeys = await import("../server/orgKeys.js");
  });

  afterAll(() => {
    if (prevSecret === undefined) delete process.env.KEY_ENCRYPTION_SECRET;
    else process.env.KEY_ENCRYPTION_SECRET = prevSecret;
  });

  it("creates an org, members, invites, and shared cursor key", () => {
    const ownerId = `user_org_owner_${Date.now()}`;
    const memberId = `user_org_member_${Date.now()}`;
    db.createUser(ownerId, `${ownerId}@acme.com`, "Owner", "x");
    db.createUser(memberId, `${memberId}@acme.com`, "Member", "x");

    const org = db.createOrganization({
      id: `org_${Date.now()}`,
      name: "Acme Eng",
      slug: `acme-eng-${Date.now()}`,
      allowedDomains: "acme.com",
      createdBy: ownerId,
    });
    db.addOrganizationMember(org.id, ownerId, "owner");
    db.addOrganizationMember(org.id, memberId, "member");

    expect(db.isOrganizationMember(org.id, memberId)).toBe(true);
    expect(db.countOrganizationMembers(org.id)).toBe(2);
    expect(db.listOrganizationsForUser(memberId).map((o) => o.id)).toContain(
      org.id,
    );

    const invite = db.createOrganizationInvite({
      code: `invite_${Date.now()}`,
      orgId: org.id,
      createdBy: ownerId,
      role: "member",
      maxUses: 3,
      expiresAt: Date.now() + 60_000,
    });
    expect(db.useOrganizationInvite(invite.code)).toBe(true);

    const { hint } = orgKeys.setOrgCursorKey(org.id, "cursor_org_shared_key");
    expect(hint.length).toBeGreaterThan(0);
    expect(orgKeys.orgCursorKeyConfigured(org.id)).toBe(true);
    expect(orgKeys.getOrgCursorKey(org.id)).toBe("cursor_org_shared_key");

    orgKeys.clearOrgCursorKey(org.id);
    expect(orgKeys.orgCursorKeyConfigured(org.id)).toBe(false);
  });
});
