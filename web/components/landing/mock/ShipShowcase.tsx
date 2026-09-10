"use client";

import { useState } from "react";

export function PrShowcase() {
  return (
    <div className="overflow-hidden rounded-[18px] border border-[#2b2b2b] bg-[#141414] shadow-[0_30px_80px_rgba(0,0,0,0.45)]">
      <div className="flex items-center justify-between border-b border-[#2b2b2b] px-3 py-2">
        <div>
          <p className="text-[13px] text-[#e4e4e4]">Integrator · Open PR</p>
          <p className="text-[11px] text-[#6e6e6e]">steer/integration → main</p>
        </div>
        <span className="h-7 rounded-md border border-[#26405d] bg-[#17202a] px-2 text-[11px] leading-7 text-[#8ec5ff]">
          Open pull request
        </span>
      </div>
      <div className="grid gap-0 md:grid-cols-2">
        <div className="border-b border-[#2b2b2b] p-3 md:border-b-0 md:border-r">
          <p className="mb-2 text-[11px] text-[#6e6e6e]">Agents on this branch</p>
          {[
            { name: "Cursor · Auth rebuild", files: "4 files" },
            { name: "Claude · Pickup delay", files: "2 files" },
            { name: "Integrator", files: "opens the PR" },
          ].map((row) => (
            <div
              key={row.name}
              className="flex items-center justify-between border-b border-[#2b2b2b] py-2 last:border-0"
            >
              <span className="text-[12px] text-[#e4e4e4]">{row.name}</span>
              <span className="text-[11px] text-[#6e6e6e]">{row.files}</span>
            </div>
          ))}
        </div>
        <div className="landing-mono p-3 text-[11px] leading-5">
          <p className="mb-2 font-sans text-[11px] text-[#6e6e6e]">
            web/app/issues/page.tsx
          </p>
          <div className="landing-diff-line bg-[rgba(240,112,112,0.08)] px-2 text-[#f07070]">
            - Tickets the agent picks up…
          </div>
          <div
            className="landing-diff-line bg-[rgba(62,207,142,0.08)] px-2 text-[#3ecf8e]"
            style={{ animationDelay: "0.1s" }}
          >
            + Headless Cursor Cloud · delayed pickup
          </div>
          <div
            className="landing-diff-line bg-[rgba(62,207,142,0.08)] px-2 text-[#3ecf8e]"
            style={{ animationDelay: "0.2s" }}
          >
            + Writeup stored on the issue, not in git
          </div>
        </div>
      </div>
    </div>
  );
}

export function PickupSettingsMock() {
  const [autoStart, setAutoStart] = useState(true);
  return (
    <div className="rounded-[18px] border border-[#2b2b2b] bg-[#1a1a1a] p-4">
      <p className="text-[13px] text-[#e4e4e4]">Agent pickup</p>
      <p className="mt-1 text-[11px] text-[#6e6e6e]">
        Default delay is 10 minutes. Issue runs use Cursor Cloud and never create
        a session room.
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <label className="text-[12px] text-[#a0a0a0]">
          Delay (minutes)
          <span className="mt-1 flex h-9 items-center rounded-md border border-[#2b2b2b] bg-[#252525] px-2.5 text-[13px] text-[#e4e4e4]">
            10
          </span>
        </label>
        <label className="text-[12px] text-[#a0a0a0]">
          Max concurrent
          <span className="mt-1 flex h-9 items-center rounded-md border border-[#2b2b2b] bg-[#252525] px-2.5 text-[13px] text-[#e4e4e4]">
            2
          </span>
        </label>
        <label className="mt-6 flex items-center gap-2 text-[12px] text-[#a0a0a0]">
          <input
            type="checkbox"
            checked={autoStart}
            onChange={(e) => setAutoStart(e.target.checked)}
          />
          Queue on create
        </label>
      </div>
    </div>
  );
}

export function CliShowcase() {
  return (
    <div className="overflow-hidden rounded-[18px] border border-[#2b2b2b] bg-[#1a1a1a] p-5 shadow-[0_30px_80px_rgba(0,0,0,0.35)]">
      <div className="mb-3 flex items-center gap-2.5">
        <div className="flex h-6 w-6 items-center justify-center rounded-[5px] bg-[#e4e4e4]">
          <span className="text-[11px] font-semibold text-[#141414]">S</span>
        </div>
        <span className="text-[13px] font-medium text-[#e4e4e4]">Steer</span>
      </div>
      <p className="text-[16px] font-medium text-[#e4e4e4]">Pair CLI</p>
      <p className="mt-1 text-[12px] text-[#6e6e6e]">
        Generate a one-time code, then run{" "}
        <code className="text-[#a0a0a0]">steer login</code> on your machine.
      </p>
      <p className="mt-4 text-[11px] uppercase tracking-wide text-[#6e6e6e]">
        Pairing code
      </p>
      <div className="mt-2 rounded-md border border-[#2b2b2b] bg-[#252525] py-3 text-center font-mono text-[26px] tracking-[0.2em] text-[#e4e4e4]">
        7K2M-Q9XP
      </div>
      <p className="mt-2 text-center text-[11px] text-[#6e6e6e]">
        Expires in ~10 minutes
      </p>
      <p className="mt-4 rounded-md bg-[#141414] px-3 py-2 landing-mono text-[11px] text-[#a0a0a0]">
        $ steer start
      </p>
    </div>
  );
}
