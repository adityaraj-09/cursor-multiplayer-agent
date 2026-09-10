"use client";

import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../lib/utils";

export default function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-xl border border-dashed border-[#2b2b2b] bg-[#171717] px-6 py-16 sm:py-20 text-center animate-fade-up",
        className,
      )}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_50%_28%,rgba(228,228,228,0.06),transparent_55%)]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#3c3c3c] to-transparent"
      />

      <div className="relative mx-auto flex max-w-md flex-col items-center">
        <div className="relative mb-6 flex h-16 w-16 items-center justify-center">
          <span
            aria-hidden
            className="absolute inset-0 rounded-2xl border border-[#2b2b2b] bg-[#1a1a1a]"
          />
          <span
            aria-hidden
            className="absolute -inset-3 rounded-[1.35rem] border border-[#242424]"
          />
          <span
            aria-hidden
            className="absolute -inset-6 rounded-[1.75rem] border border-[#1f1f1f]"
          />
          <Icon
            className="relative h-7 w-7 text-[#e4e4e4]"
            strokeWidth={1.5}
          />
        </div>

        <h2 className="text-[16px] font-medium tracking-tight text-[#e4e4e4]">
          {title}
        </h2>
        <p className="mt-2 text-[13px] leading-relaxed text-[#6e6e6e]">
          {description}
        </p>

        {action ? <div className="mt-6 flex items-center justify-center gap-2">{action}</div> : null}
      </div>
    </div>
  );
}
