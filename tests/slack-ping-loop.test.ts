import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  notificationsConfigured,
  notifyReviewFlag,
} from "../server/notify.js";

describe("review ping notify", () => {
  const originalSlack = process.env.SLACK_WEBHOOK_URL;
  const originalGeneric = process.env.NOTIFY_WEBHOOK_URL;

  beforeEach(() => {
    delete process.env.SLACK_WEBHOOK_URL;
    delete process.env.NOTIFY_WEBHOOK_URL;
    vi.restoreAllMocks();
  });

  afterEach(() => {
    if (originalSlack === undefined) delete process.env.SLACK_WEBHOOK_URL;
    else process.env.SLACK_WEBHOOK_URL = originalSlack;
    if (originalGeneric === undefined) delete process.env.NOTIFY_WEBHOOK_URL;
    else process.env.NOTIFY_WEBHOOK_URL = originalGeneric;
  });

  it("reports notificationsConfigured from env", () => {
    expect(notificationsConfigured()).toBe(false);
    process.env.SLACK_WEBHOOK_URL = "https://hooks.slack.com/services/T/B/x";
    expect(notificationsConfigured()).toBe(true);
  });

  it("posts Block Kit payload to room webhook", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => "",
    });
    vi.stubGlobal("fetch", fetchMock);

    notifyReviewFlag({
      webhookUrl: "https://hooks.slack.com/services/T/B/room",
      roomId: "room_1",
      roomName: "Demo",
      actorName: "Ada",
      note: "Please check the diff",
      pingId: "ping_abc",
      joinUrl: "http://localhost:3001/room/room_1?ping=ping_abc",
      targetSummary: "everyone",
    });

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://hooks.slack.com/services/T/B/room");
    const body = JSON.parse(String(init.body));
    expect(body.blocks?.[0]?.text?.text).toContain("Ada");
    expect(body.blocks?.[0]?.text?.text).toContain("Demo");
    expect(body.blocks?.[0]?.text?.text).toContain("Please check the diff");
    expect(body.blocks?.[1]?.elements?.[0]?.url).toContain("ping=ping_abc");
  });

  it("falls back to env Slack webhook when room webhook omitted", async () => {
    process.env.SLACK_WEBHOOK_URL = "https://hooks.slack.com/services/T/B/env";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => "",
    });
    vi.stubGlobal("fetch", fetchMock);

    notifyReviewFlag({
      roomId: "room_1",
      roomName: "Demo",
      actorName: "Ada",
      pingId: "ping_abc",
      joinUrl: "http://localhost:3001/room/room_1?ping=ping_abc",
    });

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://hooks.slack.com/services/T/B/env",
    );
  });
});

describe("ping target parsing helpers", () => {
  it("treats empty targets as everyone for join URLs", () => {
    const joinUrl = (roomId: string, pingId: string) =>
      `http://localhost:3001/room/${roomId}?ping=${pingId}`;
    expect(joinUrl("r1", "p1")).toBe(
      "http://localhost:3001/room/r1?ping=p1",
    );
  });
});

describe("room_pings sqlite helpers", () => {
  it("creates, acks, and dismisses a review ping", async () => {
    const db = await import("../server/db/sqlite.js");
    const room = db.createRoom({
      id: `room_ping_${Date.now()}`,
      name: "Ping room",
      repoPath: "/tmp/repo",
      agentCommand: "cursor",
      runtime: "local",
      authMode: "cli",
      modelId: "auto",
      ownerId: "user_host",
    });

    db.setRoomSlackWebhook(room.id, "cipher:tag:data", "http…hook");
    const reloaded = db.getRoom(room.id)!;
    expect(reloaded.slack_webhook_ciphertext).toBe("cipher:tag:data");
    expect(reloaded.slack_webhook_hint).toBe("http…hook");

    const ping = db.createRoomPing({
      roomId: room.id,
      actorUserId: "user_host",
      actorName: "Host",
      note: "Need a look",
      targets: ["user_a", "user_b"],
    });
    expect(ping.status).toBe("open");
    expect(ping.targets).toContain("user_a");

    expect(db.ackRoomPing(ping.id, "user_a", "Ada")).toBe(true);
    expect(db.ackRoomPing(ping.id, "user_a", "Ada")).toBe(false);
    const acks = db.listRoomPingAcks(ping.id);
    expect(acks).toHaveLength(1);
    expect(acks[0].user_name).toBe("Ada");

    const dismissed = db.dismissRoomPing(ping.id);
    expect(dismissed?.status).toBe("dismissed");
    expect(db.listOpenRoomPings(room.id)).toHaveLength(0);

    db.clearRoomSlackWebhook(room.id);
    expect(db.getRoom(room.id)?.slack_webhook_ciphertext).toBeNull();
  });
});
