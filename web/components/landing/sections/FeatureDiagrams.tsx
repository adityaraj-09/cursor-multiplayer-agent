import type { ReactNode } from "react";

function Frame({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div
      className="relative mb-6 overflow-hidden rounded-xl border border-[#2b2b2b] bg-[#121212]"
      role="img"
      aria-label={label}
    >
      <div className="flex h-[148px] items-center justify-center p-3 sm:h-[160px]">
        {children}
      </div>
    </div>
  );
}

function Av({
  letter,
  color,
  className = "",
}: {
  letter: string;
  color: string;
  className?: string;
}) {
  return (
    <span
      className={`flex h-5 w-5 items-center justify-center rounded-full text-[9px] font-medium text-[#141414] ${className}`}
      style={{ backgroundColor: color }}
    >
      {letter}
    </span>
  );
}

export function AgentsDiagram() {
  return (
    <Frame label="Two agents side by side in one room">
      <div className="grid w-full grid-cols-2 gap-2">
        {[
          { name: "Startup sync", live: true, lines: [86, 64, 72] },
          { name: "Stale banner", live: false, lines: [70, 80, 52] },
        ].map((pane) => (
          <div
            key={pane.name}
            className="rounded-lg border border-[#2b2b2b] bg-[#171717] p-2"
          >
            <div className="mb-2 flex items-center gap-1.5">
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  pane.live ? "landing-pulse bg-[#3ecf8e]" : "bg-[#6e6e6e]"
                }`}
              />
              <span className="truncate text-[10px] text-[#e4e4e4]">{pane.name}</span>
            </div>
            {pane.lines.map((width) => (
              <div
                key={width}
                className="mb-1 h-1.5 rounded-full bg-[#2b2b2b]"
                style={{ width: `${width}%` }}
              />
            ))}
          </div>
        ))}
      </div>
    </Frame>
  );
}

export function WatchDiagram() {
  return (
    <Frame label="Four people watching the same live stream">
      <div className="w-full">
        <div className="mb-2 flex items-center justify-between">
          <div className="flex -space-x-1.5">
            <Av letter="J" color="#8ec5ff" className="landing-float-slow ring-2 ring-[#121212]" />
            <Av letter="M" color="#3ecf8e" className="landing-float ring-2 ring-[#121212]" />
            <Av letter="K" color="#e6c07b" className="landing-float-delay ring-2 ring-[#121212]" />
            <Av letter="A" color="#c4b5fd" className="ring-2 ring-[#121212]" />
          </div>
          <span className="text-[10px] text-[#6e6e6e]">4 watching</span>
        </div>
        <div className="space-y-1.5 rounded-lg border border-[#2b2b2b] bg-[#171717] p-2">
          <div className="ml-auto h-7 w-[72%] rounded-md bg-[#242424]" />
          <div className="flex h-6 items-center gap-2 rounded-md border border-[#2b2b2b] bg-[#181818] px-2">
            <span className="h-1.5 w-1.5 rounded-full bg-[#4d9fff]" />
            <span className="h-1 w-16 rounded-full bg-[#2b2b2b]" />
            <span className="ml-auto text-[9px] text-[#6e6e6e]">Tools</span>
          </div>
          <div className="h-6 w-[80%] rounded-md bg-[#191919]" />
        </div>
      </div>
    </Frame>
  );
}

export function RedirectDiagram() {
  return (
    <Frame label="Different people steering different agents">
      <div className="flex w-full flex-col gap-2">
        <div className="ml-auto max-w-[90%] rounded-xl rounded-br-md border border-[#343434] bg-[#242424] px-2.5 py-1.5">
          <p className="text-[9px] text-[#8ec5ff]">Jules → Startup sync</p>
          <p className="mt-0.5 text-[10px] leading-4 text-[#e4e4e4]">
            Paint the map on partial state.
          </p>
        </div>
        <div className="ml-auto max-w-[90%] rounded-xl rounded-br-md border border-[#343434] bg-[#242424] px-2.5 py-1.5">
          <p className="text-[9px] text-[#3ecf8e]">Maya → Stale banner</p>
          <p className="mt-0.5 text-[10px] leading-4 text-[#e4e4e4]">
            I’ll take the banner copy.
          </p>
        </div>
      </div>
    </Frame>
  );
}

export function HandoffDiagram() {
  return (
    <Frame label="Driver seat moving from Jules to Maya">
      <div className="flex w-full items-center justify-between gap-2">
        <div className="flex flex-1 flex-col items-center gap-1.5 rounded-lg border border-[#2b2b2b] bg-[#171717] py-3">
          <Av letter="J" color="#8ec5ff" />
          <span className="text-[10px] text-[#6e6e6e]">Jules</span>
          <span className="rounded-md bg-[#1f1f1f] px-1.5 py-0.5 text-[9px] text-[#6e6e6e] line-through">
            Driving
          </span>
        </div>
        <svg viewBox="0 0 48 12" className="h-3 w-10 shrink-0" aria-hidden>
          <path
            className="landing-draw"
            d="M2 6 H40"
            fill="none"
            stroke="#4d9fff"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
          <path d="M38 2 L46 6 L38 10 Z" fill="#4d9fff" />
        </svg>
        <div className="flex flex-1 flex-col items-center gap-1.5 rounded-lg border border-[#234337] bg-[#17251f] py-3">
          <Av letter="M" color="#3ecf8e" />
          <span className="text-[10px] text-[#e4e4e4]">Maya</span>
          <span className="rounded-md bg-[#141414]/40 px-1.5 py-0.5 text-[9px] text-[#3ecf8e]">
            Driving
          </span>
        </div>
      </div>
    </Frame>
  );
}

export function DiffDiagram() {
  return (
    <Frame label="Live file diff streaming into the room">
      <div className="w-full overflow-hidden rounded-lg border border-[#2b2b2b] bg-[#171717]">
        <div className="flex items-center justify-between border-b border-[#2b2b2b] px-2.5 py-1.5">
          <span className="font-mono text-[10px] text-[#a0a0a0]">HomeScreen.tsx</span>
          <span className="text-[9px] text-[#4d9fff]">+2 −1</span>
        </div>
        <div className="landing-mono text-[10px] leading-5">
          <div className="border-l-2 border-[#f07070] bg-[rgba(240,112,112,0.08)] px-2 text-[#f07070]">
            - if (!isFullySynced)
          </div>
          <div className="border-l-2 border-[#3ecf8e] bg-[rgba(62,207,142,0.08)] px-2 text-[#3ecf8e]">
            + if (syncStatus === &quot;partial&quot;)
          </div>
          <div className="border-l-2 border-[#3ecf8e] bg-[rgba(62,207,142,0.08)] px-2 text-[#3ecf8e]">
            + return &lt;Dashboard /&gt;
          </div>
        </div>
      </div>
    </Frame>
  );
}

export function HistoryDiagram() {
  const events = [
    { time: "12:04", text: "Jules steered Startup sync", color: "#8ec5ff" },
    { time: "12:05", text: "Edit landed in the room", color: "#4d9fff" },
    { time: "12:08", text: "Maya approved the shell", color: "#3ecf8e" },
    { time: "12:11", text: "Andreas joined — thread intact", color: "#c4b5fd" },
  ];
  return (
    <Frame label="Room history that stays after someone joins late">
      <ol className="w-full space-y-1.5">
        {events.map((event, index) => (
          <li key={event.time} className="flex items-center gap-2">
            <span
              className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                index === events.length - 1 ? "landing-pulse" : ""
              }`}
              style={{ backgroundColor: event.color }}
            />
            <span className="w-8 shrink-0 font-mono text-[9px] text-[#6e6e6e]">
              {event.time}
            </span>
            <span className="truncate text-[10px] text-[#c8c8c8]">{event.text}</span>
          </li>
        ))}
      </ol>
    </Frame>
  );
}
