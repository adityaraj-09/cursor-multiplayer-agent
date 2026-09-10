import { Check, X } from "lucide-react";
import Reveal from "../Reveal";

const OLD_WAY = [
  "One person's screen, everyone else just watches",
  "Tickets that wait for a human to start coding",
  "Context scattered across Slack threads and screenshots",
  "No record of who asked the agent to do what",
];

const STEER_WAY = [
  "Every agent's stream lands in one shared room",
  "Issues pick themselves up, open a PR, and write the note",
  "Chat, diffs, approvals, and control on the same surface",
  "Every prompt attributed to the person who sent it",
];

export default function ComparisonSection() {
  return (
    <section className="border-t border-white/[0.06] bg-[#101010]">
      <div className="mx-auto max-w-6xl px-5 py-20 sm:px-8 sm:py-28">
        <Reveal>
          <div className="max-w-xl">
            <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-[#6e6e6e] sm:text-[12px]">
              Why not just screen share
            </p>
            <h2 className="landing-serif mt-3 text-[32px] leading-[1.12] tracking-tight text-white sm:text-[40px]">
              A room built for agents, not a call built for humans
            </h2>
          </div>
        </Reveal>

        <div className="mt-14 grid gap-4 sm:mt-16 md:grid-cols-2">
          <Reveal variant="left">
            <div className="h-full rounded-2xl border border-white/[0.06] bg-[#161616] p-7 sm:p-9">
              <p className="text-[12px] font-medium uppercase tracking-[0.14em] text-[#6e6e6e]">
                Screen share &amp; a backlog
              </p>
              <ul className="mt-6 space-y-4">
                {OLD_WAY.map((item) => (
                  <li key={item} className="flex items-start gap-3">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/[0.04]">
                      <X className="h-3 w-3 text-[#6e6e6e]" strokeWidth={2.5} />
                    </span>
                    <span className="text-[14px] font-light leading-relaxed text-[#a0a0a0] sm:text-[15px]">
                      {item}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </Reveal>

          <Reveal variant="right" delay={90}>
            <div className="landing-card h-full rounded-2xl border border-white/10 bg-[#e4e4e4] p-7 text-[#111] sm:p-9">
              <p className="text-[12px] font-medium uppercase tracking-[0.14em] text-[#111]/45">
                Steer
              </p>
              <ul className="mt-6 space-y-4">
                {STEER_WAY.map((item) => (
                  <li key={item} className="flex items-start gap-3">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#111]/10">
                      <Check className="h-3 w-3 text-[#111]" strokeWidth={2.5} />
                    </span>
                    <span className="text-[14px] font-light leading-relaxed text-[#111]/75 sm:text-[15px]">
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
