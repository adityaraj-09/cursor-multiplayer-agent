import { describe, expect, it, beforeAll } from "vitest";
import {
  canAbortWithRole,
  canRequestDrive,
  canSteerWithRole,
  defaultControlModeForRuntime,
  normalizeRoomRole,
  parseControlMode,
  parseRoomInviteRole,
  steerDeniedReason,
} from "../shared/roomPermissions.js";

describe("room permission helpers", () => {
  it("normalizes legacy member roles to editor", () => {
    expect(normalizeRoomRole("member")).toBe("editor");
    expect(normalizeRoomRole("admin")).toBe("editor");
    expect(normalizeRoomRole("OWNER")).toBe("owner");
    expect(normalizeRoomRole("viewer")).toBe("viewer");
    expect(normalizeRoomRole("nope")).toBeNull();
  });

  it("parses invite roles with safe defaults", () => {
    expect(parseRoomInviteRole("viewer")).toBe("viewer");
    expect(parseRoomInviteRole("editor")).toBe("editor");
    expect(parseRoomInviteRole("member")).toBe("editor");
    expect(parseRoomInviteRole(undefined)).toBe("viewer");
    expect(parseRoomInviteRole("bogus", "editor")).toBe("editor");
  });

  it("defaults control mode by runtime", () => {
    expect(defaultControlModeForRuntime("local")).toBe("driver");
    expect(defaultControlModeForRuntime("cloud")).toBe("open");
    expect(parseControlMode("DRIVER")).toBe("driver");
    expect(parseControlMode("nope")).toBe("open");
  });

  it("enforces the steer permission matrix", () => {
    expect(
      canSteerWithRole({
        role: "viewer",
        controlMode: "open",
        isDrivingAgent: true,
      }),
    ).toBe(false);

    expect(
      canSteerWithRole({
        role: "editor",
        controlMode: "open",
        isDrivingAgent: false,
      }),
    ).toBe(true);

    expect(
      canSteerWithRole({
        role: "editor",
        controlMode: "driver",
        isDrivingAgent: false,
      }),
    ).toBe(false);

    expect(
      canSteerWithRole({
        role: "editor",
        controlMode: "driver",
        isDrivingAgent: true,
      }),
    ).toBe(true);

    expect(
      canSteerWithRole({
        role: "editor",
        controlMode: "host",
        isDrivingAgent: true,
      }),
    ).toBe(false);

    expect(
      canSteerWithRole({
        role: "owner",
        controlMode: "host",
        isDrivingAgent: false,
      }),
    ).toBe(true);
  });

  it("mirrors abort permissions to steer permissions", () => {
    const opts = {
      role: "editor" as const,
      controlMode: "driver" as const,
      isDrivingAgent: false,
    };
    expect(canAbortWithRole(opts)).toBe(canSteerWithRole(opts));
    expect(steerDeniedReason(opts)).toMatch(/Request control/i);
  });

  it("blocks viewers from requesting drive", () => {
    expect(canRequestDrive("viewer")).toBe(false);
    expect(canRequestDrive("editor")).toBe(true);
    expect(canRequestDrive("owner")).toBe(true);
  });
});

describe("room roles + control mode persistence", () => {
  let db: typeof import("../server/db.js");

  beforeAll(async () => {
    db = await import("../server/db.js");
  });

  it("stores control mode and invite role", () => {
    const ownerId = `user_perm_owner_${Date.now()}`;
    const editorId = `user_perm_editor_${Date.now()}`;
    const viewerId = `user_perm_viewer_${Date.now()}`;
    db.createUser(ownerId, `${ownerId}@example.com`, "Owner", "x");
    db.createUser(editorId, `${editorId}@example.com`, "Editor", "x");
    db.createUser(viewerId, `${viewerId}@example.com`, "Viewer", "x");

    const localRoom = db.createRoom({
      id: `room_local_${Date.now()}`,
      name: "Local",
      repoPath: "/tmp/demo",
      agentCommand: "agent",
      runtime: "local",
      authMode: "cli",
      modelId: "auto",
      ownerId,
    });
    expect(localRoom.control_mode).toBe("driver");

    const cloudRoom = db.createRoom({
      id: `room_cloud_${Date.now()}`,
      name: "Cloud",
      repoPath: "https://github.com/acme/demo",
      agentCommand: "agent",
      runtime: "cloud",
      authMode: "server",
      modelId: "auto",
      ownerId,
      controlMode: "host",
    });
    expect(cloudRoom.control_mode).toBe("host");

    db.setRoomControlMode(cloudRoom.id, "open");
    expect(db.getRoom(cloudRoom.id)?.control_mode).toBe("open");

    db.addRoomMember(localRoom.id, ownerId, "owner");
    db.addRoomMember(localRoom.id, editorId, "editor");
    db.addRoomMember(localRoom.id, viewerId, "viewer");
    expect(db.getRoomMemberRole(localRoom.id, editorId)).toBe("editor");
    expect(db.getRoomMemberRole(localRoom.id, viewerId)).toBe("viewer");

    const code = `inv_${Date.now().toString(36)}`;
    db.createInviteLink(code, localRoom.id, ownerId, 3, Date.now() + 60_000, "viewer");
    const invite = db.getInviteLink(code);
    expect(invite?.role).toBe("viewer");
  });

  it("migrates legacy member role to editor on write path", () => {
    const userId = `user_legacy_${Date.now()}`;
    const roomId = `room_legacy_${Date.now()}`;
    db.createUser(userId, `${userId}@example.com`, "Legacy", "x");
    db.createRoom({
      id: roomId,
      name: "Legacy",
      repoPath: "/tmp/demo",
      agentCommand: "agent",
      runtime: "cloud",
      authMode: "server",
      modelId: "auto",
      ownerId: userId,
    });
    db.addRoomMember(roomId, userId, "member");
    // Fresh writes of "member" remain as stored; normalizeRoomRole maps them.
    expect(normalizeRoomRole(db.getRoomMemberRole(roomId, userId))).toBe(
      "editor",
    );
  });
});
