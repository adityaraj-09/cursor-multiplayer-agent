"use client";

import { Check, Crown, Loader2, MousePointer2, X } from "lucide-react";

interface DriverControlsProps {
  amDriver: boolean;
  /** Host (or current driver) may approve a pending request. */
  canGrant?: boolean;
  pendingRequest: string | null;
  /** Local user is waiting for approval. */
  pendingOutgoing?: boolean;
  onRequestDrive: () => void;
  onReleaseDrive: () => void;
  onGrantDrive: () => void;
  onDismissRequest: () => void;
}

export default function DriverControls({
  amDriver,
  canGrant = false,
  pendingRequest,
  pendingOutgoing = false,
  onRequestDrive,
  onReleaseDrive,
  onGrantDrive,
  onDismissRequest,
}: DriverControlsProps) {
  return (
    <>
      {amDriver ? (
        <button
          onClick={onReleaseDrive}
          className="inline-flex h-9 sm:h-8 items-center gap-1.5 px-3 sm:px-2.5 rounded-lg border border-[#2b2b2b] bg-[#1f1f1f] text-[12px] text-[#a0a0a0] hover:text-[#e4e4e4] hover:border-[#3c3c3c] transition-colors"
        >
          <Crown className="h-3.5 w-3.5 text-[#e8a23a]" strokeWidth={1.75} />
          <span className="hidden sm:inline">Release</span>
          <span className="sm:hidden">Release</span>
        </button>
      ) : (
        <button
          onClick={onRequestDrive}
          disabled={pendingOutgoing}
          className="inline-flex h-9 sm:h-8 items-center gap-1.5 px-3 sm:px-2.5 rounded-lg bg-[#e4e4e4] border border-[#e4e4e4] text-[12px] font-medium text-[#141414] hover:bg-white transition-colors disabled:opacity-60"
        >
          {pendingOutgoing ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.75} />
          ) : (
            <MousePointer2 className="h-3.5 w-3.5" strokeWidth={1.75} />
          )}
          <span className="sm:hidden">
            {pendingOutgoing ? "Waiting…" : "Drive"}
          </span>
          <span className="hidden sm:inline">
            {pendingOutgoing ? "Waiting for approval…" : "Request control"}
          </span>
        </button>
      )}

      {pendingOutgoing && !amDriver && !pendingRequest && (
        <div className="fixed left-3 right-3 sm:left-auto sm:right-5 bottom-[calc(7rem+env(safe-area-inset-bottom))] sm:bottom-28 bg-[#1e1e1e] border border-[#3c3c3c] rounded-2xl px-3.5 py-3 flex items-center gap-3 shadow-2xl z-50 animate-fade-up">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#252525] text-[#e8a23a]">
            <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} />
          </span>
          <span className="text-[13px] text-[#e4e4e4] min-w-0 flex-1">
            Waiting for the host or current driver to grant control…
          </span>
        </div>
      )}

      {pendingRequest && (amDriver || canGrant) && (
        <div className="fixed left-3 right-3 sm:left-auto sm:right-5 bottom-[calc(7rem+env(safe-area-inset-bottom))] sm:bottom-28 bg-[#1e1e1e] border border-[#3c3c3c] rounded-2xl px-3.5 py-3.5 flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center gap-3 shadow-2xl z-50 animate-fade-up">
          <div className="flex items-center gap-3 min-w-0">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#252525] text-[#e8a23a] shrink-0">
              <Crown className="h-4 w-4" strokeWidth={1.75} />
            </span>
            <span className="text-[13px] text-[#e4e4e4] min-w-0 flex-1">
              <span className="font-medium">{pendingRequest}</span>
              <span className="text-[#a0a0a0]"> wants control</span>
            </span>
          </div>
          <div className="flex items-center gap-2 sm:ml-auto">
            <button
              onClick={onGrantDrive}
              className="inline-flex h-10 sm:h-8 flex-1 sm:flex-none items-center justify-center gap-1.5 px-4 sm:px-2.5 rounded-lg bg-[#e4e4e4] text-[#141414] text-[13px] sm:text-[12px] font-medium hover:bg-white"
            >
              <Check className="h-4 w-4 sm:h-3.5 sm:w-3.5" strokeWidth={2} />
              Grant
            </button>
            <button
              onClick={onDismissRequest}
              className="inline-flex h-10 sm:h-8 flex-1 sm:flex-none items-center justify-center gap-1.5 px-4 sm:px-2.5 rounded-lg text-[13px] sm:text-[12px] text-[#6e6e6e] hover:text-[#e4e4e4] border border-[#2b2b2b] sm:border-0"
            >
              <X className="h-4 w-4 sm:h-3.5 sm:w-3.5" strokeWidth={1.75} />
              Dismiss
            </button>
          </div>
        </div>
      )}
    </>
  );
}
