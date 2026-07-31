"use client";

import { Check, Crown, MousePointer2, X } from "lucide-react";

interface DriverControlsProps {
  amDriver: boolean;
  pendingRequest: string | null;
  onRequestDrive: () => void;
  onReleaseDrive: () => void;
  onGrantDrive: () => void;
  onDismissRequest: () => void;
}

export default function DriverControls({
  amDriver,
  pendingRequest,
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
          className="inline-flex h-8 items-center gap-1.5 px-2.5 sm:px-3 rounded-lg border border-[#2b2b2b] bg-[#1f1f1f] text-[11px] sm:text-[12px] text-[#a0a0a0] hover:text-[#e4e4e4] hover:border-[#3c3c3c] transition-colors"
        >
          <Crown className="h-3.5 w-3.5 text-[#e8a23a]" strokeWidth={1.75} />
          <span className="hidden sm:inline">Release</span>
        </button>
      ) : (
        <button
          onClick={onRequestDrive}
          className="inline-flex h-8 items-center gap-1.5 px-2.5 sm:px-3 rounded-lg bg-[#e4e4e4] border border-[#e4e4e4] text-[11px] sm:text-[12px] font-medium text-[#141414] hover:bg-white transition-colors"
        >
          <MousePointer2 className="h-3.5 w-3.5" strokeWidth={1.75} />
          <span className="sm:hidden">Drive</span>
          <span className="hidden sm:inline">Request control</span>
        </button>
      )}

      {pendingRequest && amDriver && (
        <div className="fixed left-3 right-3 sm:left-auto sm:right-5 bottom-[calc(7rem+env(safe-area-inset-bottom))] sm:bottom-28 bg-[#1e1e1e] border border-[#3c3c3c] rounded-2xl px-3.5 py-3 flex flex-wrap items-center gap-2 sm:gap-3 shadow-2xl z-50 animate-fade-up">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#252525] text-[#e8a23a]">
            <Crown className="h-4 w-4" strokeWidth={1.75} />
          </span>
          <span className="text-[13px] text-[#e4e4e4] min-w-0 flex-1">
            <span className="font-medium">{pendingRequest}</span>
            <span className="text-[#a0a0a0]"> wants control</span>
          </span>
          <div className="flex items-center gap-2 ml-auto">
            <button
              onClick={onGrantDrive}
              className="inline-flex h-8 sm:h-7 items-center gap-1.5 px-3 sm:px-2.5 rounded-lg bg-[#e4e4e4] text-[#141414] text-[12px] font-medium hover:bg-white"
            >
              <Check className="h-3.5 w-3.5" strokeWidth={2} />
              Grant
            </button>
            <button
              onClick={onDismissRequest}
              className="inline-flex h-8 sm:h-7 items-center gap-1.5 px-3 sm:px-2.5 rounded-lg text-[12px] text-[#6e6e6e] hover:text-[#e4e4e4]"
            >
              <X className="h-3.5 w-3.5" strokeWidth={1.75} />
              Dismiss
            </button>
          </div>
        </div>
      )}
    </>
  );
}
