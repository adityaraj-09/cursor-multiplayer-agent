import { Check, X } from "lucide-react";
import Reveal from "../Reveal";

const OLD_WAY = [
  "One person's screen, everyone else just watches",
  "Context scattered across Slack threads and screenshots",
  "One agent running at a time, on one machine",
  "No record of who asked the agent to do what",
];

const STEER_WAY = [
  "Every agent's stream lands in one shared room",
  "Chat, diffs, and control live on the same surface",
  "Cursor and Claude Code running in parallel, local or cloud",
  "Every prompt attributed to the person who sent it",
];

export default function ComparisonSection() {
  return (
    <section className="border-t border-[#191919]/08 bg-[#FAFAF8]">
      <div className="mx-auto max-w-6xl px-5 sm:px-8 py-20 sm:py-28">
        <Reveal>
          <div className="max-w-xl">
            <p className="text-[11px] sm:text-[12px] font-medium tracking-[0.16em] uppercase text-[#191919]/45">
              Why not just screen share
            </p>
            <h2 className="mt-3 landing-serif text-[32px] sm:text-[40px] leading-[1.12] tracking-tight">
              A room built for agents, not a call built for humans
            </h2>
          </div>
        </Reveal>

        <div className="mt-14 sm:mt-16 grid gap-5 md:grid-cols-2">
          <Reveal variant="left">
            <div className="h-full rounded-[1.5rem] border border-[#191919]/10 bg-white p-7 sm:p-9">
              <p className="text-[12px] font-medium tracking-[0.14em] uppercase text-[#191919]/40">
                Screen share &amp; Slack
              </p>
              <ul className="mt-6 space-y-4">
                {OLD_WAY.map((item) => (
                  <li key={item} className="flex items-start gap-3">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#191919]/06">
                      <X className="w-3 h-3 text-[#191919]/45" strokeWidth={2.5} />
                    </span>
                    <span className="text-[14px] sm:text-[15px] leading-relaxed text-[#191919]/60 font-light">
                      {item}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </Reveal>

          <Reveal variant="right" delay={90}>
            <div className="landing-card h-full rounded-[1.5rem] border border-[#191919]/10 bg-[#191919] p-7 sm:p-9 text-white">
              <p className="text-[12px] font-medium tracking-[0.14em] uppercase text-white/45">
                Steer
              </p>
              <ul className="mt-6 space-y-4">
                {STEER_WAY.map((item) => (
                  <li key={item} className="flex items-start gap-3">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/12">
                      <Check className="w-3 h-3 text-white" strokeWidth={2.5} />
                    </span>
                    <span className="text-[14px] sm:text-[15px] leading-relaxed text-white/75 font-light">
                      {item}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
