import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { formatTypingIndicatorAll } from "../shared/typing.js";
import { userCanManageRoom } from "../server/roomAccess.js";

describe("formatTypingIndicatorAll", () => {
  it("aggregates typists across agents", () => {
    expect(
      formatTypingIndicatorAll(
        {
          a1: [{ name: "Ada" }],
          a2: [{ name: "Ada" }, { name: "Bob" }],
        },
        [
          { id: "a1", label: "Agent A" },
          { id: "a2", label: "Agent B" },
        ],
      ),
    ).toBe("Ada and Bob are typing…");

    expect(
      formatTypingIndicatorAll(
        { a1: [{ name: "Ada" }] },
        [{ id: "a1", label: "Agent A" }],
      ),
    ).toBe("Ada is typing to Agent A…");
  });
});

describe("room manage access + org lifecycle", () => {
  const prevSecret = process.env.KEY_ENCRYPTION_SECRET;
  let db: typeof import("../server/db.js");

  beforeAll(async () => {
    process.env.KEY_ENCRYPTION_SECRET =
      "test-secret-for-collab-admin-32-bytes!!!";
    db = await import("../server/db.js");
  });

  afterAll(() => {
    if (prevSecret === undefined) delete process.env.KEY_ENCRYPTION_SECRET;
    else process.env.KEY_ENCRYPTION_SECRET = prevSecret;
  });

  it("lets org admins manage org rooms but not personal rooms", () => {
    const stamp = Date.now();
    const ownerId = `user_ca_owner_${stamp}`;
    const adminId = `user_ca_admin_${stamp}`;
    const memberId = `user_ca_member_${stamp}`;
    db.createUser(ownerId, `${ownerId}@acme.com`, "Owner", "x");
    db.createUser(adminId, `${adminId}@acme.com`, "Admin", "x");
    db.createUser(memberId, `${memberId}@acme.com`, "Member", "x");

    const org = db.createOrganization({
      id: `org_ca_${stamp}`,
      name: "Collab Admin",
      slug: `collab-admin-${stamp}`,
      createdBy: ownerId,
    });
    db.addOrganizationMember(org.id, ownerId, "owner");
    db.addOrganizationMember(org.id, adminId, "admin");
    db.addOrganizationMember(org.id, memberId, "member");

    const orgRoom = db.createRoom({
      id: `room_org_${stamp}`,
      name: "Org room",
      repoPath: "/tmp/demo",
      agentCommand: "agent",
      runtime: "cloud",
      authMode: "server",
      modelId: "auto",
      ownerId,
      orgId: org.id,
    });
    const personal = db.createRoom({
      id: `room_personal_${stamp}`,
      name: "Personal",
      repoPath: "/tmp/demo",
      agentCommand: "agent",
      runtime: "cloud",
      authMode: "server",
      modelId: "auto",
      ownerId,
    });

    expect(userCanManageRoom(orgRoom.id, ownerId)).toBe(true);
    expect(userCanManageRoom(orgRoom.id, adminId)).toBe(true);
    expect(userCanManageRoom(orgRoom.id, memberId)).toBe(false);
    expect(userCanManageRoom(personal.id, adminId)).toBe(false);
    expect(userCanManageRoom(personal.id, ownerId)).toBe(true);
  });

  it("defaults shared-link memberships via addRoomMember role upsert", () => {
    const stamp = Date.now() + 1;
    const hostId = `user_join_host_${stamp}`;
    const guestId = `user_join_guest_${stamp}`;
    db.createUser(hostId, `${hostId}@ex.com`, "Host", "x");
    db.createUser(guestId, `${guestId}@ex.com`, "Guest", "x");
    const room = db.createRoom({
      id: `room_join_${stamp}`,
      name: "Join",
      repoPath: "/tmp/demo",
      agentCommand: "agent",
      runtime: "cloud",
      authMode: "server",
      modelId: "auto",
      ownerId: hostId,
    });
    db.addRoomMember(room.id, guestId, "viewer");
    expect(db.getRoomMemberRole(room.id, guestId)).toBe("viewer");
    db.addRoomMember(room.id, guestId, "editor");
    expect(db.getRoomMemberRole(room.id, guestId)).toBe("editor");
  });

  it("transfers ownership and deletes a team after detaching rooms", () => {
    const stamp = Date.now() + 2;
    const ownerId = `user_xfer_owner_${stamp}`;
    const nextOwnerId = `user_xfer_next_${stamp}`;
    db.createUser(ownerId, `${ownerId}@acme.com`, "Owner", "x");
    db.createUser(nextOwnerId, `${nextOwnerId}@acme.com`, "Next", "x");

    const org = db.createOrganization({
      id: `org_xfer_${stamp}`,
      name: "Transfer Me",
      slug: `transfer-me-${stamp}`,
      createdBy: ownerId,
    });
    db.addOrganizationMember(org.id, ownerId, "owner");
    db.addOrganizationMember(org.id, nextOwnerId, "member");

    const room = db.createRoom({
      id: `room_xfer_${stamp}`,
      name: "Team room",
      repoPath: "/tmp/demo",
      agentCommand: "agent",
      runtime: "cloud",
      authMode: "server",
      modelId: "auto",
      ownerId,
      orgId: org.id,
    });
    expect(db.getRoom(room.id)?.org_id).toBe(org.id);

    db.updateOrganizationMemberRole(org.id, nextOwnerId, "owner");
    db.updateOrganizationMemberRole(org.id, ownerId, "admin");
    expect(db.getOrganizationMember(org.id, nextOwnerId)?.role).toBe("owner");
    expect(db.getOrganizationMember(org.id, ownerId)?.role).toBe("admin");

    const detached = db.detachOrganizationRooms(org.id);
    expect(detached).toBeGreaterThanOrEqual(1);
    expect(db.getRoom(room.id)?.org_id).toBeNull();
    expect(db.getRoom(room.id)?.status).toBe("stopped");

    db.deleteOrganization(org.id);
    expect(db.getOrganization(org.id)).toBeUndefined();
    expect(db.getOrganizationMember(org.id, nextOwnerId)).toBeUndefined();
  });
});
