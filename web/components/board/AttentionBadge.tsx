"use client";

import type { RoomAttention } from "../../../shared/roomAttention";

const TONE: Record<RoomAttention["kind"], string> = {
  approval: "border-[#c9a227] bg-[#2a2414] text-[#e8c86a]",
  ping: "border-[#c47a2a] bg-[#2a1c10] text-[#f0b060]",
  error: "border-[#5a3a3a] bg-[#2a1818] text-[#f07070]",
  drive: "border-[#8a6a2a] bg-[#241e10] text-[#e8a23a]",
  running: "border-[#2a4a35] bg-[#1c2a22] text-[#7ddea8]",
  unread: "border-[#26405d] bg-[#17202a] text-[#8ec5ff]",
};

export default function AttentionBadge({
  attention,
  compact,
}: {
  attention: RoomAttention | null;
  compact?: boolean;
}) {
  if (!attention) return null;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-1.5 h-5 text-[10px] font-medium shrink-0 ${TONE[attention.kind]}`}
    >
      {attention.kind === "running" && (
        <span className="h-1.5 w-1.5 rounded-full bg-[#3ecf8e] animate-pulse" />
      )}
      {compact ? attention.count || "" : attention.label}
      {!compact && attention.count ? ` ${attention.count}` : ""}
    </span>
  );
}
