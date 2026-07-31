"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import type { RoomInfo } from "../../shared/events";

interface RoomCardProps {
  room: RoomInfo;
}

export default function RoomCard({ room }: RoomCardProps) {
  const isActive = room.status === "active";
  const timeAgo = getTimeAgo(room.createdAt);
  const target =
    room.runtime === "cloud"
      ? (room.repoUrl || "").replace("https://github.com/", "")
      : room.repoPath.replace(/^.*\/Projects\//, "~/Projects/");

  return (
    <Link
      href={`/room/${room.id}`}
      className="block p-4 bg-[#1a1a1a] border border-[#2b2b2b] rounded-lg hover:border-[#3c3c3c] hover:bg-[#1e1e1e] transition-colors group"
    >
      <div className="flex items-start justify-between gap-3 mb-2">
        <h3 className="text-[14px] font-medium text-[#e4e4e4] group-hover:text-white truncate">
          {room.name}
        </h3>
        <span
          className={`shrink-0 mt-0.5 flex items-center gap-1.5 text-[11px] ${
            isActive ? "text-[#3ecf8e]" : "text-[#6e6e6e]"
          }`}
        >
          <span
            className={`w-1.5 h-1.5 rounded-full ${
              isActive ? "bg-[#3ecf8e]" : "bg-[#6e6e6e]"
            }`}
          />
          {isActive ? "Live" : "Stopped"}
        </span>
      </div>

      <div className="flex flex-wrap gap-1.5 mb-2">
        <Badge>{room.runtime === "cloud" ? "Cloud" : "Local"}</Badge>
        <Badge>
          {room.authMode === "cli"
            ? "Local login"
            : room.authMode === "byok"
              ? "BYOK"
              : "Server key"}
        </Badge>
        {room.orgName && <Badge>{room.orgName}</Badge>}
        <Badge>{room.modelId}</Badge>
      </div>

      <p className="text-[12px] text-[#6e6e6e] font-mono truncate mb-3">
        {target || "—"}
      </p>

      <div className="flex items-center justify-between text-[11px] text-[#6e6e6e]">
        <span>
          {room.participantCount > 0
            ? `${room.participantCount} online`
            : "Empty"}
        </span>
        <span>{timeAgo}</span>
      </div>
    </Link>
  );
}

function Badge({ children }: { children: ReactNode }) {
  return (
    <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#252525] text-[#a0a0a0] border border-[#2b2b2b]">
      {children}
    </span>
  );
}

function getTimeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
