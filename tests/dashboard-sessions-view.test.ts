import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import {
  readDashboardSessionsView,
  writeDashboardSessionsView,
} from "../web/lib/dashboardView";
import { roomInfoToRow } from "../web/components/SessionsGroupedList";
import type { RoomInfo } from "../shared/events";

function makeRoom(overrides: Partial<RoomInfo> = {}): RoomInfo {
  return {
    id: "room_1",
    name: "Ship auth",
    repoPath: "/Users/me/Projects/app",
    agentCommand: "cursor agent",
    participantCount: 2,
    status: "active",
    createdAt: Date.UTC(2026, 8, 11),
    runtime: "local",
    authMode: "cli",
    modelId: "composer-2.5",
    controlMode: "open",
    approvalMode: "off",
    myCanManage: true,
    ...overrides,
  };
}

describe("dashboard sessions view", () => {
  const store = new Map<string, string>();

  beforeEach(() => {
    store.clear();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => {
          store.set(key, value);
        },
        removeItem: (key: string) => {
          store.delete(key);
        },
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("defaults to list view", () => {
    expect(readDashboardSessionsView()).toBe("list");
  });

  it("persists grid preference", () => {
    writeDashboardSessionsView("grid");
    expect(readDashboardSessionsView()).toBe("grid");
  });
});

describe("roomInfoToRow", () => {
  it("maps active rooms to list rows", () => {
    const row = roomInfoToRow(makeRoom());
    expect(row.status).toBe("active");
    expect(row.href).toBe("/room/room_1");
    expect(row.runtimeLabel).toBe("Local");
    expect(row.authLabel).toBe("Local login");
    expect(row.target).toBe("~/Projects/app");
    expect(row.canArchive).toBe(true);
  });

  it("maps stopped cloud rooms", () => {
    const row = roomInfoToRow(
      makeRoom({
        status: "stopped",
        runtime: "cloud",
        repoUrl: "https://github.com/acme/widgets",
        authMode: "byok",
        myCanManage: false,
      }),
    );
    expect(row.status).toBe("stopped");
    expect(row.runtimeLabel).toBe("Cloud");
    expect(row.authLabel).toBe("BYOK");
    expect(row.target).toBe("acme/widgets");
    expect(row.canArchive).toBe(false);
  });
});
