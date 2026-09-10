export type DemoToolCategory = "read" | "edit" | "terminal" | "search";

export type DemoChatItem =
  | {
      kind: "user";
      agentId: string;
      agentLabel: string;
      name: string;
      color: string;
      text: string;
      time: string;
    }
  | {
      kind: "assistant";
      agentId: string;
      agentLabel: string;
      text: string;
      time: string;
      streaming?: boolean;
    }
  | {
      kind: "tools";
      agentId: string;
      agentLabel: string;
      running?: boolean;
      open?: boolean;
      tools: Array<{
        category: DemoToolCategory;
        title: string;
        status: "done" | "streaming";
        detail?: string;
        diff?: { del: string; add: string };
      }>;
    }
  | {
      kind: "todos";
      agentId: string;
      agentLabel: string;
      items: Array<{
        text: string;
        status: "completed" | "in_progress" | "pending";
      }>;
    }
  | {
      kind: "approval";
      agentId: string;
      agentLabel: string;
      command: string;
      status?: "pending" | "approved";
      approver?: string;
    };

export type DemoBoardAgent = {
  id: string;
  label: string;
  running: boolean;
  model: string;
  backend?: "cursor" | "claude-code";
  integrator?: boolean;
};

export type DemoBoardTile = {
  id: string;
  name: string;
  live: boolean;
  agents: DemoBoardAgent[];
  items: DemoChatItem[];
  placeholder: string;
};

export const DEMO_BOARD: DemoBoardTile[] = [
  {
    id: "rm_ios",
    name: "iOS startup",
    live: true,
    agents: [
      { id: "cursor", label: "Cursor", running: true, model: "Opus 4.6", backend: "cursor" },
      { id: "claude", label: "Claude Code", running: false, model: "Sonnet", backend: "claude-code" },
    ],
    placeholder: "Steer Cursor…",
    items: [
      {
        kind: "user",
        agentId: "cursor",
        agentLabel: "Cursor",
        name: "Maya",
        color: "#8ec5ff",
        time: "12:04",
        text: "Stop blocking HomeScreen on full vehicle_state. Render once minimum state is present.",
      },
      {
        kind: "tools",
        agentId: "cursor",
        agentLabel: "Cursor",
        tools: [
          {
            category: "read",
            title: "Read HomeScreen.tsx",
            status: "done",
            detail: "src/screens/Home/HomeScreen.tsx",
          },
          {
            category: "edit",
            title: "Edit HomeScreen.tsx",
            status: "done",
            diff: {
              del: "- if (!isFullySynced) return <Spinner />",
              add: "+ if (syncStatus === PENDING) return <Spinner />",
            },
          },
        ],
      },
      {
        kind: "assistant",
        agentId: "cursor",
        agentLabel: "Cursor",
        time: "12:05",
        text: "HomeScreen now paints on `partial`. Passing `syncStatus` into Dashboard so the banner can explain the wait.",
      },
      {
        kind: "user",
        agentId: "claude",
        agentLabel: "Claude Code",
        name: "Jules",
        color: "#3ecf8e",
        time: "12:06",
        text: "Claude — write the stale-data banner while Cursor finishes the hook.",
      },
      {
        kind: "todos",
        agentId: "claude",
        agentLabel: "Claude Code",
        items: [
          { text: "Add StaleSyncBanner", status: "completed" },
          { text: "Wire Dashboard opacity for partial", status: "in_progress" },
          { text: "Disable lock toggles while stale", status: "pending" },
        ],
      },
      {
        kind: "assistant",
        agentId: "claude",
        agentLabel: "Claude Code",
        time: "12:07",
        text: "Banner copy: “Updating vehicle — times may be a minute behind.” Dismisses on `live`.",
      },
    ],
  },
  {
    id: "rm_auth",
    name: "Auth rebuild",
    live: true,
    agents: [
      { id: "cursor", label: "Cursor", running: false, model: "Opus 4.6", backend: "cursor" },
      { id: "claude", label: "Claude Code", running: true, model: "Sonnet", backend: "claude-code" },
    ],
    placeholder: "Steer Claude Code…",
    items: [
      {
        kind: "user",
        agentId: "cursor",
        agentLabel: "Cursor",
        name: "Jules",
        color: "#8ec5ff",
        time: "11:41",
        text: "Move Clerk appearance to the shared dark chrome. Don’t fork SignIn.",
      },
      {
        kind: "tools",
        agentId: "cursor",
        agentLabel: "Cursor",
        tools: [
          {
            category: "search",
            title: "Grep steerClerkAppearance",
            status: "done",
            detail: "web/lib/clerkAppearance.ts",
          },
          {
            category: "edit",
            title: "Edit clerkAppearance.ts",
            status: "done",
            diff: {
              del: "- colorScheme: \"light\"",
              add: "+ colorScheme: \"dark\"",
            },
          },
        ],
      },
      {
        kind: "assistant",
        agentId: "cursor",
        agentLabel: "Cursor",
        time: "11:42",
        text: "Tokens are #141414 / #e4e4e4. Login and UserProfile now share `steerClerkAppearance`.",
      },
      {
        kind: "user",
        agentId: "claude",
        agentLabel: "Claude Code",
        name: "Maya",
        color: "#e6c07b",
        time: "11:43",
        text: "Claude — check the SignIn modal contrast on the landing overlay.",
      },
      {
        kind: "tools",
        agentId: "claude",
        agentLabel: "Claude Code",
        running: true,
        tools: [
          {
            category: "read",
            title: "Read layout.tsx",
            status: "done",
            detail: "web/app/layout.tsx",
          },
          {
            category: "terminal",
            title: "pnpm --filter web lint",
            status: "streaming",
            detail: "Checking Clerk class overrides…",
          },
        ],
      },
    ],
  },
  {
    id: "rm_eta",
    name: "ETA jitter",
    live: true,
    agents: [
      { id: "cursor", label: "Cursor Cloud", running: true, model: "Opus 4.6", backend: "cursor" },
      { id: "claude", label: "Claude Code", running: false, model: "Sonnet", backend: "claude-code" },
    ],
    placeholder: "Steer Cursor Cloud…",
    items: [
      {
        kind: "user",
        agentId: "cursor",
        agentLabel: "Cursor Cloud",
        name: "Karri",
        color: "#8ec5ff",
        time: "10:18",
        text: "Smooth ETA when GPS and vehicle_state arrive out of order. 4s window is fine.",
      },
      {
        kind: "tools",
        agentId: "cursor",
        agentLabel: "Cursor Cloud",
        running: true,
        tools: [
          {
            category: "read",
            title: "Read EtaTile.tsx",
            status: "done",
            detail: "src/components/tiles/EtaTile.tsx",
          },
          {
            category: "edit",
            title: "Edit EtaTile.tsx",
            status: "streaming",
            diff: {
              del: "- setEta(nextSeconds)",
              add: "+ setEta(medianWindow(nextSeconds, 4_000))",
            },
          },
        ],
      },
      {
        kind: "user",
        agentId: "claude",
        agentLabel: "Claude Code",
        name: "Lena",
        color: "#3ecf8e",
        time: "10:19",
        text: "Claude — add a test that GPS-then-state and state-then-GPS produce the same ETA.",
      },
      {
        kind: "assistant",
        agentId: "claude",
        agentLabel: "Claude Code",
        time: "10:20",
        text: "Writing EtaTile.test.ts with both arrival orders. Cursor can keep the window; I’ll assert ±2s.",
      },
    ],
  },
  {
    id: "rm_integrate",
    name: "Integrator PR",
    live: true,
    agents: [
      { id: "cursor", label: "Cursor", running: false, model: "Opus 4.6", backend: "cursor" },
      { id: "claude", label: "Claude Code", running: false, model: "Sonnet", backend: "claude-code" },
      { id: "int", label: "Integrator", running: false, model: "Composer", integrator: true, backend: "cursor" },
    ],
    placeholder: "Message Integrator…",
    items: [
      {
        kind: "user",
        agentId: "cursor",
        agentLabel: "Cursor",
        name: "Jules",
        color: "#8ec5ff",
        time: "09:48",
        text: "Cursor work is on cursor/startup-sync. Don’t open a sandbox PR.",
      },
      {
        kind: "assistant",
        agentId: "cursor",
        agentLabel: "Cursor",
        time: "09:49",
        text: "Branch is pushed. Handing off to Integrator.",
      },
      {
        kind: "user",
        agentId: "claude",
        agentLabel: "Claude Code",
        name: "Maya",
        color: "#3ecf8e",
        time: "09:50",
        text: "Claude’s pickup-delay branch is ready to land on the same integration ref.",
      },
      {
        kind: "assistant",
        agentId: "claude",
        agentLabel: "Claude Code",
        time: "09:51",
        text: "Two files on claude/pickup-delay. Integrator can squash.",
      },
      {
        kind: "user",
        agentId: "int",
        agentLabel: "Integrator",
        name: "Maya",
        color: "#a3e635",
        time: "09:52",
        text: "Merge Cursor + Claude onto steer/integration and open one PR. Not a sandbox branch.",
      },
      {
        kind: "assistant",
        agentId: "int",
        agentLabel: "Integrator",
        time: "09:53",
        text: "Both feature branches fast-forward onto `steer/integration`. Opening the PR next — needs a shell approve.",
      },
      {
        kind: "approval",
        agentId: "int",
        agentLabel: "Integrator",
        command: "gh pr create --base main --head steer/integration",
      },
    ],
  },
];

export const DEMO_ROOMS: DemoBoardTile[] = [
  ...DEMO_BOARD,
  {
    id: "rm_review",
    name: "PR review",
    live: false,
    agents: [
      { id: "cursor", label: "Cursor", running: false, model: "Opus 4.6", backend: "cursor" },
      { id: "claude", label: "Claude Code", running: true, model: "Sonnet", backend: "claude-code" },
    ],
    placeholder: "Steer Claude Code…",
    items: [
      {
        kind: "user",
        agentId: "cursor",
        agentLabel: "Cursor",
        name: "Didier",
        color: "#8ec5ff",
        time: "08:11",
        text: "Review #55209. Flag anything that still treats sync as a boolean.",
      },
      {
        kind: "tools",
        agentId: "cursor",
        agentLabel: "Cursor",
        tools: [
          {
            category: "search",
            title: "Grep isFullySynced",
            status: "done",
            detail: "3 hits in tiles/",
          },
        ],
      },
      {
        kind: "assistant",
        agentId: "cursor",
        agentLabel: "Cursor",
        time: "08:12",
        text: "LockTile still reads `isFullySynced`. Left comments on the PR.",
      },
      {
        kind: "user",
        agentId: "claude",
        agentLabel: "Claude Code",
        name: "Andreas",
        color: "#e6c07b",
        time: "08:13",
        text: "Claude — draft the review reply and a follow-up issue.",
      },
      {
        kind: "tools",
        agentId: "claude",
        agentLabel: "Claude Code",
        running: true,
        tools: [
          {
            category: "read",
            title: "Read LockTile.tsx",
            status: "streaming",
            detail: "src/components/tiles/LockTile.tsx",
          },
        ],
      },
    ],
  },
  {
    id: "rm_local",
    name: "CLI pair · laptop",
    live: false,
    agents: [
      { id: "cursor", label: "Cursor", running: true, model: "Opus 4.6", backend: "cursor" },
      { id: "claude", label: "Claude Code", running: false, model: "Sonnet", backend: "claude-code" },
    ],
    placeholder: "Steer Cursor…",
    items: [
      {
        kind: "user",
        agentId: "cursor",
        agentLabel: "Cursor",
        name: "Jules",
        color: "#8ec5ff",
        time: "07:40",
        text: "This folder is the live checkout. Pair CLI is online — edit server/room/steer.ts.",
      },
      {
        kind: "tools",
        agentId: "cursor",
        agentLabel: "Cursor",
        running: true,
        tools: [
          {
            category: "read",
            title: "Read steer.ts",
            status: "done",
            detail: "~/Projects/steer/server/room/steer.ts",
          },
          {
            category: "edit",
            title: "Edit steer.ts",
            status: "streaming",
            diff: {
              del: "- if (!driverId) return",
              add: "+ if (!driverId) return rejectSteer(socket)",
            },
          },
        ],
      },
      {
        kind: "user",
        agentId: "claude",
        agentLabel: "Claude Code",
        name: "Maya",
        color: "#3ecf8e",
        time: "07:41",
        text: "Claude — watch the same file and write the attribution test.",
      },
      {
        kind: "assistant",
        agentId: "claude",
        agentLabel: "Claude Code",
        time: "07:41",
        text: "Waiting on Cursor’s edit, then I’ll add steer.test.ts for the reject path.",
      },
    ],
  },
];

export function getDemoRoom(id: string): DemoBoardTile | undefined {
  return DEMO_ROOMS.find((room) => room.id === id);
}
