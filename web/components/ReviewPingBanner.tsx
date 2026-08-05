"use client";

import type { PingInfo } from "../../shared/events";

function targetsLabel(ping: PingInfo): string {
  if (ping.targets === "everyone") return "everyone";
  return `${ping.targets.length} member${ping.targets.length === 1 ? "" : "s"}`;
}

export default function ReviewPingBanner({
  ping,
  myUserId,
  canDismiss,
  onAck,
  onDismiss,
}: {
  ping: PingInfo;
  myUserId?: string;
  canDismiss: boolean;
  onAck: () => void;
  onDismiss: () => void;
}) {
  const acked = Boolean(
    myUserId && ping.acks.some((a) => a.userId === myUserId),
  );
  const ackNames = ping.acks.map((a) => a.name).slice(0, 4);
  const extra = ping.acks.length - ackNames.length;

  return (
    <div className="rounded-xl border border-[#3a2a1c] bg-[#1a1410] px-3.5 py-3 shadow-[0_10px_30px_rgba(0,0,0,0.25)]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-wide text-[#e8a23a]">
            Review requested
          </div>
          <div className="mt-1 text-[13px] text-[#f0e0c8] font-medium">
            {ping.actorName} flagged this session
            <span className="text-[#9a8a70] font-normal">
              {" "}
              · {targetsLabel(ping)}
            </span>
          </div>
          {ping.note && (
            <p className="mt-1.5 text-[12px] text-[#c8b090] whitespace-pre-wrap break-words">
              {ping.note}
            </p>
          )}
          {ping.acks.length > 0 && (
            <p className="mt-1.5 text-[11px] text-[#8a7a60]">
              Acked by {ackNames.join(", ")}
              {extra > 0 ? ` +${extra}` : ""}
            </p>
          )}
        </div>
        <div className="flex shrink-0 gap-2">
          {!acked && (
            <button
              type="button"
              onClick={onAck}
              className="h-8 px-3 rounded-md border border-[#2a4a35] bg-[#1c2a22] text-[12px] text-[#7ddea8] hover:bg-[#243830]"
            >
              Acknowledge
            </button>
          )}
          {canDismiss && (
            <button
              type="button"
              onClick={onDismiss}
              className="h-8 px-3 rounded-md border border-[#3c3c3c] bg-[#1f1f1f] text-[12px] text-[#a0a0a0] hover:text-[#e4e4e4]"
            >
              Dismiss
            </button>
          )}
        </div>
      </div>
      {acked && (
        <p className="mt-2 text-[11px] text-[#8a7a60]">You acknowledged this.</p>
      )}
    </div>
  );
}
