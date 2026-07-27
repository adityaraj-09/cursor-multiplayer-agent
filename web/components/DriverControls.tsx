"use client";

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
          className="h-7 px-2 sm:px-2.5 rounded-md border border-[#2b2b2b] text-[11px] sm:text-[12px] text-[#a0a0a0] hover:text-[#e4e4e4] hover:border-[#3c3c3c] transition-colors"
        >
          Release
        </button>
      ) : (
        <button
          onClick={onRequestDrive}
          className="h-7 px-2 sm:px-2.5 rounded-md bg-[#252525] border border-[#2b2b2b] text-[11px] sm:text-[12px] text-[#e4e4e4] hover:border-[#3c3c3c] transition-colors"
        >
          <span className="sm:hidden">Drive</span>
          <span className="hidden sm:inline">Request control</span>
        </button>
      )}

      {pendingRequest && amDriver && (
        <div className="fixed left-3 right-3 sm:left-auto sm:right-5 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] sm:bottom-24 bg-[#1e1e1e] border border-[#3c3c3c] rounded-lg px-3.5 py-3 flex flex-wrap items-center gap-2 sm:gap-3 shadow-2xl z-50 animate-fade-up">
          <span className="text-[13px] text-[#e4e4e4] min-w-0 flex-1">
            <span className="font-medium">{pendingRequest}</span>
            <span className="text-[#a0a0a0]"> wants control</span>
          </span>
          <div className="flex items-center gap-2 ml-auto">
            <button
              onClick={onGrantDrive}
              className="h-8 sm:h-7 px-3 sm:px-2.5 rounded-md bg-[#e4e4e4] text-[#141414] text-[12px] font-medium hover:bg-white"
            >
              Grant
            </button>
            <button
              onClick={onDismissRequest}
              className="h-8 sm:h-7 px-3 sm:px-2.5 rounded-md text-[12px] text-[#6e6e6e] hover:text-[#e4e4e4]"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}
    </>
  );
}
