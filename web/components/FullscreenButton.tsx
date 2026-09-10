"use client";

import { Maximize2, Minimize2 } from "lucide-react";

export default function FullscreenButton({
  active,
  onToggle,
  className = "",
}: {
  active: boolean;
  onToggle: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onToggle()}
      className={`inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[#2b2b2b] bg-[#1f1f1f] text-[#a0a0a0] transition-colors hover:border-[#3c3c3c] hover:text-[#e4e4e4] ${className}`}
      title={active ? "Exit fullscreen (Esc)" : "Enter fullscreen"}
      aria-label={active ? "Exit fullscreen" : "Enter fullscreen"}
      aria-pressed={active}
    >
      {active ? (
        <Minimize2 className="h-3.5 w-3.5" strokeWidth={1.75} />
      ) : (
        <Maximize2 className="h-3.5 w-3.5" strokeWidth={1.75} />
      )}
    </button>
  );
}
