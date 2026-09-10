"use client";

import { useState } from "react";
import { Brain, FileText, ImagePlus } from "lucide-react";
import { PromptInput } from "../../agents/prompt-input";
import DemoChatTimeline from "./DemoChatTimeline";
import type { DemoBoardTile } from "./demo-chat";

const ROOM: DemoBoardTile = {
  id: "rm_checkout",
  name: "Checkout polish",
  live: true,
  placeholder: "Steer Startup sync…",
  agents: [
    { id: "sync", label: "Startup sync", running: true, model: "Opus 4.6" },
    { id: "banner", label: "Stale banner", running: false, model: "Sonnet" },
  ],
  items: [
    {
      kind: "user",
      agentId: "sync",
      agentLabel: "Startup sync",
      name: "Jules",
      color: "#8ec5ff",
      time: "12:04",
      text: "Don’t wait for the full vehicle doc. Paint the map as soon as VIN and position are there.",
    },
    {
      kind: "assistant",
      agentId: "sync",
      agentLabel: "Startup sync",
      time: "12:05",
      text: "HomeScreen now paints on `partial`. Spinner stays only when there’s nothing cached. Passing `syncStatus` into Dashboard next.",
    },
    {
      kind: "tools",
      agentId: "sync",
      agentLabel: "Startup sync",
      tools: [
        {
          category: "search",
          title: "Grep isFullySynced",
          status: "done",
          detail: "4 hits in src/screens/Home and src/hooks",
        },
        {
          category: "read",
          title: "Read HomeScreen.tsx",
          status: "done",
          detail: "src/screens/Home/HomeScreen.tsx",
        },
        {
          category: "read",
          title: "Read useVehicleState.ts",
          status: "done",
          detail: "src/hooks/useVehicleState.ts",
        },
        {
          category: "edit",
          title: "Edit HomeScreen.tsx",
          status: "done",
          detail: "src/screens/Home/HomeScreen.tsx",
          diff: {
            del: "- if (!isFullySynced) return <Spinner />",
            add: "+ if (syncStatus === \"pending\" && !snapshot) return <Spinner />",
          },
        },
        {
          category: "edit",
          title: "Edit useVehicleState.ts",
          status: "done",
          detail: "src/hooks/useVehicleState.ts",
          diff: {
            del: "- return { isFullySynced: doc.complete }",
            add: "+ return { syncStatus: statusFrom(doc), snapshot }",
          },
        },
      ],
    },
    {
      kind: "user",
      agentId: "banner",
      agentLabel: "Stale banner",
      name: "Maya",
      color: "#3ecf8e",
      time: "12:06",
      text: "I’ll take the stale-data banner so Jules can stay on the hook. Copy should say times might be a minute behind.",
    },
    {
      kind: "todos",
      agentId: "banner",
      agentLabel: "Stale banner",
      items: [
        { text: "Add StaleSyncBanner", status: "completed" },
        { text: "Dismiss on live — no tap on cold start", status: "in_progress" },
        { text: "Disable lock toggles while stale", status: "pending" },
      ],
    },
    {
      kind: "user",
      agentId: "sync",
      agentLabel: "Startup sync",
      name: "Karri",
      color: "#e6c07b",
      time: "12:07",
      text: "Once the hook lands, run the unit tests before we touch Dashboard. I don’t want a silent miss.",
    },
    {
      kind: "approval",
      agentId: "sync",
      agentLabel: "Startup sync",
      command: "pnpm test src/hooks/useVehicleState.test.ts",
      status: "approved",
      approver: "Maya",
    },
    {
      kind: "user",
      agentId: "banner",
      agentLabel: "Stale banner",
      name: "Andreas",
      color: "#c4b5fd",
      time: "12:09",
      text: "Can the banner clear itself when sync is live? I don’t want a tap on cold start.",
    },
    {
      kind: "assistant",
      agentId: "banner",
      agentLabel: "Stale banner",
      time: "12:09",
      text: "Yes — it dismisses on `live`. Wiring that now so cold start never asks for a tap.",
    },
  ],
};

export default function MultiplayerRoomView() {
  const [agentId, setAgentId] = useState<string>("sync");
  const selected =
    ROOM.agents.find((agent) => agent.id === agentId) ?? ROOM.agents[0];

  return (
    <div className="flex min-h-[560px] flex-col overflow-hidden rounded-[18px] border border-[#2b2b2b] bg-[#141414] shadow-[0_30px_80px_rgba(0,0,0,0.45)]">
      <header className="flex items-center justify-between gap-3 border-b border-[#2b2b2b] bg-[#171717] px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full bg-[#3ecf8e]" />
          <span className="truncate text-[13px] font-medium text-[#e4e4e4]">
            {ROOM.name}
          </span>
          <span className="hidden truncate text-[11px] text-[#6e6e6e] sm:inline">
            kinetic/rider-ios
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          {["J", "M", "K", "A"].map((initial) => (
            <span
              key={initial}
              className="flex h-5 w-5 items-center justify-center rounded-full bg-[#252525] text-[9px] text-[#e4e4e4]"
            >
              {initial}
            </span>
          ))}
          <span className="hidden h-7 items-center rounded-md border border-[#2b2b2b] bg-[#1f1f1f] px-2 text-[11px] text-[#3ecf8e] sm:inline-flex">
            Driving
          </span>
        </div>
      </header>

      <div className="flex items-center gap-1 border-b border-[#2b2b2b] bg-[#171717] px-2 py-1.5">
        {ROOM.agents.map((agent) => (
          <button
            key={agent.id}
            type="button"
            onClick={() => setAgentId(agent.id)}
            className={`inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[12px] ${
              agentId === agent.id
                ? "bg-[#252525] text-[#e4e4e4]"
                : "text-[#6e6e6e] hover:text-[#e4e4e4]"
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                agent.running ? "animate-pulse bg-[#3ecf8e]" : "bg-[#6e6e6e]"
              }`}
            />
            {agent.label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setAgentId("all")}
          className={`h-7 rounded-md px-2.5 text-[12px] ${
            agentId === "all"
              ? "bg-[#252525] text-[#e4e4e4]"
              : "text-[#6e6e6e] hover:text-[#e4e4e4]"
          }`}
        >
          All
        </button>
        <span className="ml-auto hidden text-[11px] leading-7 text-[#6e6e6e] sm:inline">
          Driver Jules · {selected.model}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-3">
        <DemoChatTimeline
          items={ROOM.items}
          agents={ROOM.agents}
          filterAgentId={agentId === "all" ? null : agentId}
        />
      </div>

      <footer className="shrink-0 border-t border-[#2b2b2b]/90 bg-[#171717]/95 px-3 pb-3 pt-3">
        <PromptInput
          placeholder={
            selected.running
              ? "Draft a follow-up…"
              : `Message ${selected.label}…`
          }
          aria-label="Message the agent"
          minRows={2}
          maxRows={6}
          loading={selected.running}
          models={[
            {
              value: "opus",
              label: "Opus 4.6",
              icon: <Brain className="size-3.5" strokeWidth={1.75} />,
            },
            {
              value: "sonnet",
              label: "Sonnet",
              icon: <Brain className="size-3.5" strokeWidth={1.75} />,
            },
          ]}
          model={selected.model.includes("Opus") ? "opus" : "sonnet"}
          leadingAction={
            <span className="inline-flex min-w-0 items-center gap-1.5 px-1.5 text-[11px] text-[#6e6e6e]">
              <span className="max-w-[7rem] truncate">{selected.label}</span>
            </span>
          }
          actions={[
            {
              value: "image",
              label: "Attach image",
              description: "Screenshots and visual references.",
              icon: <ImagePlus className="size-4" strokeWidth={1.75} />,
            },
            {
              value: "file",
              label: "Add context",
              description: "PDF, markdown, or other documents.",
              icon: <FileText className="size-4" strokeWidth={1.75} />,
            },
          ]}
        />
        <p className="mt-2 px-1 text-[11px] text-[#6e6e6e]">
          {selected.running
            ? "Agent is working — stop or draft a follow-up"
            : "Enter to send · Shift+Enter for newline"}
        </p>
      </footer>
    </div>
  );
}
