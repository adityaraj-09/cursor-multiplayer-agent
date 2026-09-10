import type { IssuePriority, IssueStatus } from "../../../../shared/issues";
import type { IssueListItem } from "../../issues/IssuesGroupedList";

export type DemoView = "sessions" | "issues" | "board";

export type DemoIssue = IssueListItem & {
  repo: string;
  ref: string;
  pickup: string;
  prUrl?: string;
  description: string;
  writeup?: string;
  agent: string;
  events: Array<{ time: string; kind: string; message: string }>;
};

export const DEMO_ISSUES: DemoIssue[] = [
  {
    id: "iss_sync",
    identifier: "KIN-2498",
    title: "Replace isFullySynced with a sync status",
    repo: "kinetic/rider-ios",
    status: "in_review",
    priority: "high",
    ref: "main",
    pickup: "Pull request ready",
    prUrl: "https://github.com/kinetic/rider-ios/pull/54910",
    prLabel: "#54910",
    labels: ["iOS"],
    assignee: "Karri",
    date: "Oct 9",
    agent: "Cursor Cloud",
    description:
      "HomeScreen blocks the first paint on isFullySynced. Riders see a spinner even when enough vehicle state is already on disk.",
    writeup: `## What it was
HomeScreen returned a full-screen spinner until \`useVehicleState()\` reported \`isFullySynced\`. Cold start after a night in the garage looked like the car had disappeared.

## Cause
\`isFullySynced\` is true only after the entire \`vehicle_state\` document lands. Minimum fields (VIN, position, power) arrive 1–3s earlier, but the boolean stayed false. Two follow-on bugs: the dashboard never learned *why* it was waiting, and retries after a partial payload reset the flag.

## Fix
- Replaced the boolean with \`SyncStatus\` (\`pending | partial | live\`).
- Render \`Dashboard\` as soon as minimum state exists; pass \`syncStatus\` through so the banner can say “Updating vehicle…”.
- Kept the spinner only for \`pending\` with no cached snapshot.

## Files
- \`src/screens/Home/HomeScreen.tsx\`
- \`src/hooks/useVehicleState.ts\`

## Verify
Kill the app, disable radio for 2s, reopen. First frame should be the last-known map, not a spinner. Draft PR #54910.`,
    events: [
      { time: "18m ago", kind: "running", message: "Cursor Cloud picked up after the 10m delay" },
      { time: "4m ago", kind: "pr", message: "Opened draft PR #54910 · 2 files" },
      { time: "3m ago", kind: "writeup", message: "Saved cause / fix note on the issue — not in git" },
    ],
  },
  {
    id: "iss_banner",
    identifier: "KIN-2380",
    title: "Show a stale data banner while syncing",
    repo: "kinetic/rider-ios",
    status: "in_review",
    priority: "medium",
    ref: "main",
    pickup: "Pull request ready",
    prUrl: "https://github.com/kinetic/rider-ios/pull/55167",
    prLabel: "#55167",
    labels: ["Reliability"],
    assignee: "Jules",
    date: "Oct 9",
    agent: "Cursor Cloud",
    description:
      "When sync is partial, riders have no signal that ETA and lock state may be a minute old.",
    writeup: `## What it was
After the sync-status change, the home dashboard could render cached lock/ETA with no explanation. Support kept hearing “the car says unlocked but it isn’t.”

## Cause
\`Dashboard\` treated any non-pending snapshot as live. Partial payloads reuse the last \`doorLocks\` and \`etaSeconds\` without a generation id, so the UI had no way to mark them stale.

## Fix
- Added a slim banner when \`syncStatus === partial\`: “Updating vehicle — times may be a minute behind.”
- Banner dismisses itself once status flips to \`live\` or the user pulls to refresh.
- No new copy in the repo; this writeup stays on the issue.

## Files
- \`src/components/Dashboard.tsx\`
- \`src/components/StaleSyncBanner.tsx\`

## Verify
Force a partial payload in debug. Banner shows, then clears on the next full frame. PR #55167.`,
    events: [
      { time: "40m ago", kind: "running", message: "Cursor Cloud started from queued pickup" },
      { time: "12m ago", kind: "pr", message: "Opened PR #55167 · 2 files" },
      { time: "11m ago", kind: "writeup", message: "Wrote cause, fix, and verify steps" },
    ],
  },
  {
    id: "iss_dash",
    identifier: "KIN-2039",
    title: "Pass sync status to the dashboard",
    repo: "kinetic/rider-ios",
    status: "in_review",
    priority: "low",
    ref: "main",
    pickup: "Pull request ready",
    prUrl: "https://github.com/kinetic/rider-ios/pull/55209",
    prLabel: "#55209",
    labels: ["Bug", "Reliability"],
    assignee: "Maya",
    date: "Oct 8",
    agent: "Cursor Cloud",
    description:
      "Dashboard still typed vehicleState only. Child tiles cannot dim when sync is partial.",
    writeup: `## What it was
Tiles under Dashboard (lock, climate, ETA) still took a bare \`VehicleState\`. After HomeScreen started passing \`syncStatus\`, the prop stopped at the parent.

## Cause
\`DashboardProps\` was never updated. TypeScript didn’t fail because the extra prop was stripped at the JSX boundary in a wrapper that used \`...rest\` incorrectly.

## Fix
- Threaded \`syncStatus\` through \`Dashboard\` into LockTile and EtaTile.
- Tiles drop opacity to 70% and skip optimistic lock toggles while partial.

## Files
- \`src/components/Dashboard.tsx\`
- \`src/components/tiles/LockTile.tsx\`

## Verify
Partial sync: lock button disabled, ETA faded. Live sync: controls return. PR #55209.`,
    events: [
      { time: "yesterday", kind: "pr", message: "Opened PR #55209" },
      { time: "yesterday", kind: "writeup", message: "Documented the missing prop as the cause" },
    ],
  },
  {
    id: "iss_eta",
    identifier: "KIN-2076",
    title: "Reduce ETA jitter on poor networks",
    repo: "kinetic/rider-ios",
    status: "running",
    priority: "high",
    ref: "main",
    pickup: "Cursor Cloud · editing",
    prLabel: "#55423",
    labels: ["Performance", "Working…"],
    assignee: "Karri",
    date: "Oct 6",
    agent: "Cursor Cloud",
    description:
      "ETA jumps ±90s when GPS and vehicle_state arrive out of order on LTE.",
    events: [
      { time: "8m ago", kind: "queued", message: "Pickup delay elapsed" },
      { time: "just now", kind: "running", message: "Agent is smoothing ETA with a 4s window" },
    ],
  },
  {
    id: "iss_gps",
    identifier: "KIN-2108",
    title: "Handle GPS dropouts gracefully",
    repo: "kinetic/rider-ios",
    status: "running",
    priority: "medium",
    ref: "main",
    pickup: "Cursor Cloud · editing",
    prLabel: "#55409",
    labels: ["Maps", "Working…"],
    assignee: "Andreas",
    date: "Oct 2",
    agent: "Cursor Cloud",
    description:
      "Map recenters on 0,0 for a frame when the location stream stalls in tunnels.",
    events: [
      { time: "22m ago", kind: "running", message: "Holding last good coordinate for 8s" },
    ],
  },
  {
    id: "iss_tiles",
    identifier: "KIN-2143",
    title: "Optimize map tile loading on initial app open",
    repo: "kinetic/rider-ios",
    status: "running",
    priority: "medium",
    ref: "main",
    pickup: "Cursor Cloud · editing",
    labels: ["Maps"],
    assignee: "Lena",
    date: "Oct 7",
    agent: "Cursor Cloud",
    description:
      "First open after install downloads the full city tile set before the camera settles.",
    events: [
      { time: "5m ago", kind: "running", message: "Prefetching viewport tiles only" },
    ],
  },
  {
    id: "iss_dup",
    identifier: "KIN-2187",
    title: "Prevent duplicate ride requests on poor networks",
    repo: "kinetic/api",
    status: "running",
    priority: "high",
    ref: "main",
    pickup: "Cursor Cloud · editing",
    labels: ["Bug", "Working…"],
    assignee: "Didier",
    date: "Oct 5",
    agent: "Cursor Cloud",
    description:
      "Retrying createRide after a 408 opens a second trip for the same rider.",
    events: [
      { time: "14m ago", kind: "running", message: "Adding Idempotency-Key on createRide" },
    ],
  },
  {
    id: "iss_cli",
    identifier: "STE-1882",
    title: "Keep Integrate on the shared branch",
    repo: "steer/web",
    status: "queued",
    priority: "medium",
    ref: "steer/integration",
    pickup: "Picks up in 8 min",
    labels: ["API"],
    assignee: "Maya",
    date: "Oct 9",
    agent: "Cursor Cloud",
    description:
      "Integrator should merge into the integration branch and open one PR, not a Cursor sandbox branch.",
    events: [
      { time: "2m ago", kind: "created", message: "Maya filed the ticket" },
      { time: "2m ago", kind: "queued", message: "Auto-start · 10 min delay" },
    ],
  },
  {
    id: "iss_rerender",
    identifier: "KIN-2254",
    title: "Reduce unnecessary map re-rendering on home screen",
    repo: "kinetic/rider-ios",
    status: "queued",
    priority: "medium",
    ref: "main",
    pickup: "Picks up in 12 min",
    labels: ["Maps"],
    assignee: "Jules",
    date: "Oct 10",
    agent: "Cursor Cloud",
    description:
      "Home map remounts when any vehicle_state field changes, including climate.",
    events: [
      { time: "1m ago", kind: "queued", message: "Waiting for a concurrent slot" },
    ],
  },
  {
    id: "iss_ci",
    identifier: "KIN-2327",
    title: "Speed up CI pipelines for mobile builds",
    repo: "kinetic/rider-ios",
    status: "queued",
    priority: "low",
    ref: "main",
    pickup: "Picks up in 24 min",
    labels: ["Performance"],
    assignee: "Karri",
    date: "Oct 9",
    agent: "Cursor Cloud",
    description:
      "Simulator jobs reinstall CocoaPods on every push. Cache the derived data volume.",
    events: [
      { time: "6m ago", kind: "queued", message: "Queued behind two running Cloud agents" },
    ],
  },
  {
    id: "iss_flake",
    identifier: "KIN-2358",
    title: "Reduce flakiness in mobile UI tests",
    repo: "kinetic/rider-ios",
    status: "queued",
    priority: "medium",
    ref: "main",
    pickup: "Picks up in 31 min",
    labels: ["Reliability"],
    assignee: "Andreas",
    date: "Oct 4",
    agent: "Cursor Cloud",
    description:
      "HomeScreenTests tap the lock tile before the dashboard commit. Wait on syncStatus.",
    events: [
      { time: "20m ago", kind: "queued", message: "Auto-start after the default delay" },
    ],
  },
  {
    id: "iss_board",
    identifier: "STE-0852",
    title: "Present mode: fill the OS fullscreen surface",
    repo: "steer/web",
    status: "done",
    priority: "low",
    ref: "main",
    pickup: "Pull request merged",
    prUrl: "https://github.com/steer/web/pull/52",
    prLabel: "#52",
    assignee: "Jules",
    date: "Sep 28",
    agent: "Cursor Cloud",
    description: "Board and session pages should use :fullscreen without leftover chrome.",
    writeup: `## What it was
Present mode left the 14px header and a gap under the OS traffic lights.

## Cause
\`useFullscreen\` targeted the inner board grid, not \`.room-shell\`. The shell stayed in document flow.

## Fix
Fullscreen now binds to the room/board shell. Tiles keep live chat while presenting.

## Verify
Board → Fullscreen. Chrome gone, tiles still accept steer. Merged PR #52.`,
    events: [
      { time: "last week", kind: "pr", message: "PR #52 merged" },
      { time: "last week", kind: "done", message: "Marked done by Jules" },
    ],
  },
  {
    id: "iss_fail",
    identifier: "KIN-2200",
    title: "TypeError: Cannot read properties of undefined (contentData)",
    repo: "kinetic/api",
    status: "failed",
    priority: "urgent",
    ref: "main",
    pickup: "Sandbox timed out on GraphQL codegen",
    labels: ["Bug"],
    assignee: "Lena",
    date: "Oct 8",
    agent: "Cursor Cloud",
    description:
      "contentData is still referenced after the GraphQL field was removed. Codegen dies in CI.",
    writeup: `## What it was
\`ride.contentData\` was deleted from the schema. Three resolvers still destructure it.

## Cause
The schema PR merged without a follow-up on \`src/resolvers/ride.ts\`. The Cloud run hit codegen, then the 12-minute lease.

## Fix attempted
Agent started deleting the field reads but the sandbox timed out before tests.

## Next
Retry with \`pickupDelayMs: 0\`. First change: drop \`contentData\` from RidePayload and regenerate.`,
    events: [
      { time: "1h ago", kind: "running", message: "Cursor Cloud started" },
      { time: "48m ago", kind: "failed", message: "Sandbox timed out on GraphQL codegen" },
    ],
  },
];

export const DEMO_SESSIONS = [
  {
    id: "rm_ios",
    name: "iOS startup",
    runtime: "cloud" as const,
    auth: "Cursor Cloud",
    model: "Opus 4.6",
    target: "kinetic/rider-ios",
    status: "active" as const,
    agents: "Cursor · Claude Code",
    ago: "12m ago",
    people: 3,
  },
  {
    id: "rm_auth",
    name: "Auth rebuild",
    runtime: "cloud" as const,
    auth: "BYOK",
    model: "Sonnet",
    target: "acme/web",
    status: "active" as const,
    agents: "Cursor · Claude Code",
    ago: "28m ago",
    people: 2,
  },
  {
    id: "rm_eta",
    name: "ETA jitter",
    runtime: "cloud" as const,
    auth: "Cursor Cloud",
    model: "Opus 4.6",
    target: "kinetic/rider-ios",
    status: "active" as const,
    agents: "Cursor Cloud",
    ago: "41m ago",
    people: 2,
  },
  {
    id: "rm_integrate",
    name: "Integrator PR",
    runtime: "cloud" as const,
    auth: "Server key",
    model: "Composer",
    target: "steer/web",
    status: "active" as const,
    agents: "Integrator",
    ago: "1h ago",
    people: 1,
  },
  {
    id: "rm_review",
    name: "PR review",
    runtime: "cloud" as const,
    auth: "BYOK",
    model: "Sonnet",
    target: "kinetic/api",
    status: "idle" as const,
    agents: "Claude Code",
    ago: "2h ago",
    people: 1,
  },
  {
    id: "rm_local",
    name: "CLI pair · laptop",
    runtime: "local" as const,
    auth: "Local login",
    model: "Claude Code",
    target: "~/Projects/steer",
    status: "idle" as const,
    agents: "Claude Code local",
    ago: "3h ago",
    people: 1,
  },
];

export type { DemoBoardTile, DemoChatItem } from "./demo-chat";
export { DEMO_BOARD } from "./demo-chat";

export function issueStatusLabel(status: IssueStatus): string {
  switch (status) {
    case "in_review":
      return "In review";
    case "queued":
      return "Queued";
    case "running":
      return "Running";
    case "done":
      return "Done";
    case "failed":
      return "Failed";
    case "draft":
      return "Draft";
    case "needs_input":
      return "Needs input";
    case "cancelled":
      return "Cancelled";
  }
}

export function issueStatusTone(status: IssueStatus): string {
  switch (status) {
    case "running":
      return "border-[#26405d] bg-[#17202a] text-[#8ec5ff]";
    case "queued":
    case "draft":
    case "needs_input":
      return "border-[#3c3420] bg-[#1f1b12] text-[#e6c07b]";
    case "in_review":
      return "border-[#1f3d2e] bg-[#142019] text-[#3ecf8e]";
    case "done":
      return "border-[#2b2b2b] bg-[#1a1a1a] text-[#a0a0a0]";
    case "failed":
    case "cancelled":
      return "border-[#3c2b2b] bg-[#1a1414] text-[#f07070]";
  }
}

export type DemoIssueStatus = IssueStatus;
export type { IssuePriority };
