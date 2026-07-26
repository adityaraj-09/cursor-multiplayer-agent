"use client";

import { useRef, useEffect } from "react";
import type { SteerLogEntry } from "../../shared/events";

interface SteerLogProps {
  entries: SteerLogEntry[];
}

export default function SteerLog({ entries }: SteerLogProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [entries]);

  return (
    <div className="border-t border-[#2b2b2b]">
      <div className="px-3 h-8 flex items-center justify-between">
        <span className="text-[11px] text-[#6e6e6e] uppercase tracking-wide">
          Commands
        </span>
        <span className="text-[11px] text-[#4a4a4a] tabular-nums">
          {entries.length}
        </span>
      </div>
      <div
        ref={scrollRef}
        className="max-h-28 overflow-y-auto px-3 pb-2 space-y-1.5"
      >
        {entries.length === 0 ? (
          <p className="text-[12px] text-[#4a4a4a] py-1">
            Steered prompts will show up here
          </p>
        ) : (
          entries.map((entry, i) => {
            const time = new Date(entry.ts).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            });
            return (
              <div
                key={`${entry.ts}-${i}`}
                className="flex gap-2.5 items-start rounded-md bg-[#1e1e1e] border border-[#2b2b2b] px-2.5 py-1.5"
              >
                <span
                  className="mt-1 w-1.5 h-1.5 rounded-full shrink-0"
                  style={{ backgroundColor: entry.color }}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span
                      className="text-[11px] font-medium"
                      style={{ color: entry.color }}
                    >
                      {entry.sender}
                    </span>
                    <span className="text-[10px] text-[#4a4a4a] font-mono">
                      {time}
                    </span>
                  </div>
                  <p className="text-[12px] text-[#cccccc] leading-snug break-words">
                    {entry.text}
                  </p>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
