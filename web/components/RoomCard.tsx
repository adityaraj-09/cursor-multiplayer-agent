"use client";

import Link from "next/link";
import type { RoomInfo } from "../../shared/events";

interface RoomCardProps {
  room: RoomInfo;
}

export default function RoomCard({ room }: RoomCardProps) {
  const isActive = room.status === "active";
  const timeAgo = getTimeAgo(room.createdAt);
  const shortPath = room.repoPath.replace(/^.*\/Projects\//, "~/Projects/");

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

      <p className="text-[12px] text-[#6e6e6e] font-mono truncate mb-3">
        {shortPath}
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

function getTimeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
