"use client";

import type { ReactNode } from "react";
import {
  CircleDot,
  LayoutGrid,
  Layers3,
  Plus,
  Terminal,
  UserRound,
} from "lucide-react";
import type { DemoView } from "./demo-data";

const NAV: Array<{
  id: DemoView | "cli" | "profile";
  label: string;
  icon: typeof Layers3;
}> = [
  { id: "sessions", label: "Sessions", icon: Layers3 },
  { id: "issues", label: "Issues", icon: CircleDot },
  { id: "board", label: "Board", icon: LayoutGrid },
  { id: "cli", label: "Pair CLI", icon: Terminal },
  { id: "profile", label: "Profile", icon: UserRound },
];

export default function ProductChrome({
  view,
  onView,
  children,
  compact,
}: {
  view: DemoView;
  onView?: (view: DemoView) => void;
  children: ReactNode;
  compact?: boolean;
}) {
  return (
    <div
      className={`flex min-h-0 overflow-hidden rounded-[18px] border border-[#2b2b2b] bg-[#141414] text-[#e4e4e4] shadow-[0_40px_120px_rgba(0,0,0,0.55)] ${
        compact ? "h-[420px]" : "h-[min(720px,80vh)]"
      }`}
    >
      <aside className="hidden w-[196px] shrink-0 flex-col border-r border-[#2b2b2b] bg-[#171717] sm:flex">
        <div className="flex h-12 items-center gap-2.5 px-3.5">
          <div className="flex h-6 w-6 items-center justify-center rounded-[5px] bg-[#e4e4e4]">
            <span className="text-[11px] font-semibold text-[#141414]">S</span>
          </div>
          <span className="text-[13px] font-medium">Steer</span>
        </div>
        <nav className="space-y-0.5 px-2.5">
          {NAV.map(({ id, label, icon: Icon }) => {
            const clickable = id === "sessions" || id === "issues" || id === "board";
            const active = view === id;
            return (
              <button
                key={id}
                type="button"
                disabled={!clickable || !onView}
                onClick={() => {
                  if (clickable) onView?.(id);
                }}
                className={`flex h-8 w-full items-center gap-2.5 rounded-md px-2 text-left text-[13px] transition-colors ${
                  active
                    ? "bg-[#252525] text-[#e4e4e4]"
                    : "text-[#a0a0a0] hover:bg-[#1e1e1e] hover:text-[#e4e4e4] disabled:hover:bg-transparent"
                }`}
              >
                <Icon className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
                {label}
              </button>
            );
          })}
        </nav>
        <div className="mt-5 px-3">
          <p className="mb-1.5 px-1 text-[10px] font-medium uppercase tracking-wide text-[#6e6e6e]">
            Workspace
          </p>
          <div className="flex h-8 items-center rounded-md bg-[#17202a] px-2 text-[12px] text-[#8ec5ff]">
            Kinetic
          </div>
          <div className="mt-0.5 flex h-8 items-center rounded-md px-2 text-[12px] text-[#a0a0a0]">
            Personal
          </div>
          <div className="mt-1 flex h-8 items-center gap-2 px-2 text-[12px] text-[#6e6e6e]">
            <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
            New team
          </div>
        </div>
        <div className="mt-auto border-t border-[#2b2b2b] p-2.5">
          <div className="mb-2 flex h-8 items-center justify-center rounded-md bg-[#e4e4e4] text-[12px] font-medium text-[#141414]">
            New session
          </div>
          <div className="flex items-center gap-2 px-0.5">
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-[#252525] text-[10px] text-[#e4e4e4]">
              J
            </div>
            <div>
              <p className="text-[11px] text-[#e4e4e4]">Jules Karri</p>
              <p className="text-[10px] text-[#6e6e6e]">Signed in</p>
            </div>
          </div>
        </div>
      </aside>
      <div className="relative flex min-w-0 flex-1 flex-col bg-[#141414]">{children}</div>
    </div>
  );
}

export function MockPageHeader({
  kicker,
  title,
  meta,
  action,
}: {
  kicker: string;
  title: string;
  meta: string;
  action: string;
}) {
  return (
    <div className="flex items-end justify-between gap-3 px-4 pt-5 pb-4 sm:px-5">
      <div>
        <p className="mb-1 text-[10px] uppercase tracking-wide text-[#6e6e6e]">
          {kicker}
        </p>
        <h3 className="text-[18px] font-medium tracking-tight text-[#e4e4e4]">
          {title}
        </h3>
        <p className="mt-1 text-[12px] text-[#6e6e6e]">{meta}</p>
      </div>
      <span className="hidden h-8 shrink-0 items-center rounded-md bg-[#e4e4e4] px-3 text-[12px] font-medium text-[#141414] sm:inline-flex">
        {action}
      </span>
    </div>
  );
}
