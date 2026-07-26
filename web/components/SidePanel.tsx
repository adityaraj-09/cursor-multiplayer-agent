"use client";

import { useState } from "react";
import DiffViewer from "./DiffViewer";
import type { AppSocket } from "../lib/socket";
import type { SteerLogEntry } from "../../shared/events";

interface SidePanelProps {
  socket: AppSocket | null;
  lastDiff: string;
  steerLog: SteerLogEntry[];
}

export default function SidePanel({
  socket,
  lastDiff,
  steerLog,
}: SidePanelProps) {
  const [tab, setTab] = useState<"changes" | "commands">("changes");
  const fileCount = lastDiff
    ? (lastDiff.match(/^diff --git /gm) || []).length
    : 0;

  return (
    <div className="w-[38%] min-w-[320px] max-w-[540px] border-l border-[#2b2b2b] flex flex-col min-h-0 h-full overflow-hidden bg-[#141414]">
      <div className="flex items-center gap-1 px-2 h-9 border-b border-[#2b2b2b] bg-[#1a1a1a] shrink-0">
        <TabButton
          active={tab === "changes"}
          onClick={() => setTab("changes")}
          label="Changes"
          badge={fileCount > 0 ? String(fileCount) : undefined}
        />
        <TabButton
          active={tab === "commands"}
          onClick={() => setTab("commands")}
          label="Commands"
          badge={steerLog.length > 0 ? String(steerLog.length) : undefined}
        />
      </div>

      <div className="flex-1 min-h-0 overflow-hidden relative">
        {tab === "changes" ? (
          <DiffViewer socket={socket} initialPatch={lastDiff} hideHeader />
        ) : (
          <CommandsList entries={steerLog} />
        )}
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  label,
  badge,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  badge?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`h-7 px-2.5 rounded-md text-[12px] flex items-center gap-1.5 transition-colors ${
        active
          ? "bg-[#252525] text-[#e4e4e4]"
          : "text-[#6e6e6e] hover:text-[#a0a0a0]"
      }`}
    >
      {label}
      {badge && (
        <span
          className={`text-[10px] tabular-nums px-1 rounded ${
            active ? "bg-[#333] text-[#a0a0a0]" : "text-[#4a4a4a]"
          }`}
        >
          {badge}
        </span>
      )}
    </button>
  );
}

function CommandsList({ entries }: { entries: SteerLogEntry[] }) {
  if (entries.length === 0) {
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 px-6">
        <div className="text-[#6e6e6e] text-[13px]">No commands yet</div>
        <div className="text-[#4a4a4a] text-[12px] text-center">
          Messages sent from the steer box appear here
        </div>
      </div>
    );
  }

  return (
    <div className="absolute inset-0 overflow-y-auto overscroll-contain p-3 space-y-2">
      {[...entries].reverse().map((entry, i) => {
        const time = new Date(entry.ts).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        });
        return (
          <div
            key={`${entry.ts}-${i}`}
            className="rounded-md border border-[#2b2b2b] bg-[#1a1a1a] p-3"
          >
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-2">
                <span
                  className="w-2 h-2 rounded-full"
                  style={{ backgroundColor: entry.color }}
                />
                <span
                  className="text-[12px] font-medium"
                  style={{ color: entry.color }}
                >
                  {entry.sender}
                </span>
              </div>
              <span className="text-[10px] text-[#4a4a4a] font-mono">
                {time}
              </span>
            </div>
            <p className="text-[13px] text-[#e4e4e4] leading-relaxed whitespace-pre-wrap break-words">
              {entry.text}
            </p>
          </div>
        );
      })}
    </div>
  );
}
