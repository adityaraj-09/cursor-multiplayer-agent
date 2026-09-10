"use client";

import { useEffect, useRef } from "react";
import { X } from "lucide-react";

export default function CreateTeamCard({
  name,
  onNameChange,
  onCreate,
  onCancel,
  busy,
  error,
}: {
  name: string;
  onNameChange: (value: string) => void;
  onCreate: () => void;
  onCancel?: () => void;
  busy?: boolean;
  error?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!onCancel) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center px-3 pt-[8vh] sm:pt-[12vh]">
      <button
        type="button"
        className="absolute inset-0 bg-black/65"
        aria-label="Close create team"
        onClick={onCancel}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-team-title"
        className="relative w-full max-w-[480px] rounded-xl border border-[#2b2b2b] bg-[#1c1c1c] shadow-[0_24px_80px_rgba(0,0,0,0.55)]"
      >
        <div className="flex items-center justify-between gap-3 px-4 pt-3.5 pb-2">
          <div>
            <h2
              id="create-team-title"
              className="text-[15px] font-medium text-[#e4e4e4]"
            >
              Create a team workspace
            </h2>
            <p className="text-[12px] text-[#6e6e6e] mt-1">
              Each team can connect its own GitHub account and shared API keys.
            </p>
          </div>
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[#6e6e6e] hover:text-[#e4e4e4]"
              aria-label="Close"
            >
              <X className="h-4 w-4" strokeWidth={1.75} />
            </button>
          )}
        </div>

        <div className="px-4 pb-4 pt-2">
          <input
            ref={inputRef}
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            placeholder="Acme Engineering"
            className="w-full h-10 px-3 rounded-md bg-[#252525] border border-[#2b2b2b] text-[13px] text-[#e4e4e4] outline-none focus:border-[#4d9fff]"
            onKeyDown={(e) => {
              if (e.key === "Enter") onCreate();
            }}
          />
          {error && (
            <p className="text-[12px] text-[#f07070] mt-2">{error}</p>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-[#2b2b2b] px-4 py-3">
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="h-8 px-3 rounded-md text-[12px] text-[#a0a0a0] hover:text-[#e4e4e4]"
            >
              Cancel
            </button>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={onCreate}
            className="h-8 px-3 rounded-md bg-[#e4e4e4] text-[#141414] text-[12px] font-medium hover:bg-white disabled:opacity-50"
          >
            {busy ? "Creating…" : "Create team"}
          </button>
        </div>
      </div>
    </div>
  );
}
