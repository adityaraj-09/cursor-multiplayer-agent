"use client";

import { Plus } from "lucide-react";
import { useState } from "react";
import Reveal from "../Reveal";

const FAQS = [
  {
    q: "What is the Issues panel?",
    a: "Tickets for a headless Cursor Cloud agent. After the pickup delay (default 10 minutes), the agent runs against the repo, opens a PR, and stores a markdown writeup on the issue — not in git, and not as a Sessions room.",
  },
  {
    q: "Which agents can I run in a room?",
    a: "Cursor agents (Cursor Cloud, BYOK, or a server key) and Claude Code — either the local CLI or Claude Code cloud via E2B. You can mix both in the same room.",
  },
  {
    q: "Do I need to install anything?",
    a: "No install is required for cloud agents or issues. If you want to drive Cursor or Claude Code on your own machine, install the `steer` CLI and run `steer start` after pairing.",
  },
  {
    q: "Can I use my own API keys?",
    a: "Yes. Steer supports BYOK for Cursor and Anthropic — keys are encrypted at rest and used only for your sessions, with an optional shared server key for teams.",
  },
  {
    q: "How do teammates join a session?",
    a: "Share a host-managed invite link with a max-use count and expiry. Teammates sign in and immediately see every agent's live chat, tool calls, and diffs.",
  },
  {
    q: "What happens if two people want to steer?",
    a: "Anyone can message any agent, and steering stays attributed. The driver seat can be requested, granted, or released per agent. Drivers cannot self-approve dangerous tool calls.",
  },
  {
    q: "Is there a record of what happened?",
    a: "Yes — chat, diffs, and issue activity persist (SQLite or Postgres). Anyone can join mid-session. Issue writeups stay on the ticket after the PR.",
  },
] as const;

export default function Faq() {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  return (
    <section className="border-t border-white/[0.06] bg-[#0b0b0b]">
      <div className="mx-auto max-w-6xl px-5 py-20 sm:px-8 sm:py-28">
        <Reveal>
          <div className="max-w-lg">
            <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-[#6e6e6e] sm:text-[12px]">
              Questions
            </p>
            <h2 className="landing-serif mt-3 text-[32px] leading-[1.12] tracking-tight text-white sm:text-[40px]">
              Good to know before your first room
            </h2>
          </div>
        </Reveal>

        <div className="mt-12 divide-y divide-white/[0.06] border-b border-t border-white/[0.06] sm:mt-14">
          {FAQS.map((item, i) => {
            const isOpen = openIndex === i;
            return (
              <Reveal key={item.q} delay={Math.min(i, 4) * 40}>
                <div>
                  <button
                    type="button"
                    onClick={() => setOpenIndex(isOpen ? null : i)}
                    aria-expanded={isOpen}
                    className="flex w-full items-center justify-between gap-6 py-5 text-left sm:py-6"
                  >
                    <span className="landing-serif text-[17px] tracking-tight text-white sm:text-[19px]">
                      {item.q}
                    </span>
                    <Plus
                      className={`landing-accordion-icon ${isOpen ? "is-open" : ""} h-5 w-5 shrink-0 text-[#6e6e6e]`}
                      strokeWidth={1.75}
                    />
                  </button>
                  <div className={`landing-accordion-panel ${isOpen ? "is-open" : ""}`}>
                    <div>
                      <p className="max-w-2xl pb-5 text-[14px] font-light leading-relaxed text-[#a0a0a0] sm:pb-6 sm:text-[15px]">
                        {item.a}
                      </p>
                    </div>
                  </div>
                </div>
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}
