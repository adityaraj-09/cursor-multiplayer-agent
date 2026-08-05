"use client";

import type { ApprovalRequestInfo } from "../../shared/events";

interface ApprovalCardProps {
  request: ApprovalRequestInfo;
  /** False when the current user is the driver (cannot self-approve) or a viewer. */
  canDecide: boolean;
  deciding?: boolean;
  onDecide: (approved: boolean) => void;
}

export default function ApprovalCard({
  request,
  canDecide,
  deciding,
  onDecide,
}: ApprovalCardProps) {
  const pending = request.status === "pending";
  const title = pending
    ? "Approval required"
    : request.status === "approved"
      ? "Approved"
      : request.status === "denied"
        ? "Denied"
        : "Expired";

  return (
    <div className="rounded-xl border border-[#3a3420] bg-[#1c1a14] px-3.5 py-3 shadow-[0_10px_30px_rgba(0,0,0,0.25)]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-wide text-[#c9a227]">
            {title}
          </div>
          <div className="mt-1 text-[13px] text-[#e8e0c8] font-medium">
            Agent wants to run{" "}
            <span className="font-mono text-[#f0d878]">{request.toolName}</span>
          </div>
          {request.path && (
            <div className="mt-1 text-[11px] font-mono text-[#9a9170] truncate">
              {request.path}
            </div>
          )}
        </div>
        {pending && canDecide && (
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              disabled={deciding}
              onClick={() => onDecide(false)}
              className="h-8 px-3 rounded-md border border-[#4a3030] bg-[#2a1c1c] text-[12px] text-[#f0a0a0] hover:bg-[#3a2424] disabled:opacity-50"
            >
              Deny
            </button>
            <button
              type="button"
              disabled={deciding}
              onClick={() => onDecide(true)}
              className="h-8 px-3 rounded-md border border-[#2a4a35] bg-[#1c2a22] text-[12px] text-[#7ddea8] hover:bg-[#243830] disabled:opacity-50"
            >
              Approve
            </button>
          </div>
        )}
      </div>
      <pre className="mt-2.5 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-md bg-[#12110d] border border-[#2e2a1c] px-2.5 py-2 text-[11px] font-mono text-[#c8c0a0]">
        {request.detail || "(no detail)"}
      </pre>
      {!pending && request.decidedByName && (
        <p className="mt-2 text-[11px] text-[#8a8268]">
          {request.status} by {request.decidedByName}
        </p>
      )}
      {pending && !canDecide && (
        <p className="mt-2 text-[11px] text-[#8a8268]">
          Waiting for another editor (not the current driver) to approve or deny.
        </p>
      )}
    </div>
  );
}
