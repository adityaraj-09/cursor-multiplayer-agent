"use client";

import { Plus } from "lucide-react";
import { useState } from "react";
import Reveal from "../Reveal";

const FAQS = [
  {
    q: "Which agents can I run in a room?",
    a: "Cursor agents (Cursor Cloud, BYOK, or a server key) and Claude Code — either the local CLI or Claude Code cloud via E2B. You can mix both in the same room.",
  },
  {
    q: "Do I need to install anything?",
    a: "No install is required for cloud agents — create a room from the dashboard and go. If you want to drive Cursor or Claude Code on your own machine, install the `steer` CLI once and run `steer start` to keep a worker online.",
  },
  {
    q: "Can I use my own API keys?",
    a: "Yes. Steer supports BYOK for Cursor and Anthropic — keys are encrypted at rest and used only for your sessions, with an optional shared server key for teams that prefer that route.",
  },
  {
    q: "How do teammates join a session?",
    a: "Share a host-managed invite link with a max-use count and expiry. Teammates sign in and immediately see every agent's live chat, tool calls, and diffs.",
  },
  {
    q: "What happens to control if two people want to steer?",
    a: "Anyone can message any agent, and steering messages stay attributed to whoever sent them. The driver seat itself can be requested, granted, or released per agent, so only one person drives at a time.",
  },
  {
    q: "Is there a record of what happened in a room?",
    a: "Yes — chat history and diffs are durable per room (SQLite or Postgres), so anyone can join mid-session and see exactly how the work got there.",
  },
] as const;

export default function Faq() {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  return (
    <section className="border-t border-[#191919]/08 bg-white">
      <div className="mx-auto max-w-6xl px-5 sm:px-8 py-20 sm:py-28">
        <Reveal>
          <div className="max-w-lg">
            <p className="text-[11px] sm:text-[12px] font-medium tracking-[0.16em] uppercase text-[#191919]/45">
              Questions
            </p>
            <h2 className="mt-3 landing-serif text-[32px] sm:text-[40px] leading-[1.12] tracking-tight">
              Good to know before your first room
            </h2>
          </div>
        </Reveal>

        <div className="mt-12 sm:mt-14 divide-y divide-[#191919]/08 border-t border-b border-[#191919]/08">
          {FAQS.map((item, i) => {
            const isOpen = openIndex === i;
            return (
              <Reveal key={item.q} delay={Math.min(i, 4) * 40}>
                <div>
                  <button
                    type="button"
                    onClick={() => setOpenIndex(isOpen ? null : i)}
                    aria-expanded={isOpen}
                    className="flex w-full items-center justify-between gap-6 py-5 sm:py-6 text-left"
                  >
                    <span className="landing-serif text-[17px] sm:text-[19px] tracking-tight text-[#191919]">
                      {item.q}
                    </span>
                    <Plus
                      className={`landing-accordion-icon ${isOpen ? "is-open" : ""} h-5 w-5 shrink-0 text-[#191919]/50`}
                      strokeWidth={1.75}
                    />
                  </button>
                  <div className={`landing-accordion-panel ${isOpen ? "is-open" : ""}`}>
                    <div>
                      <p className="pb-5 sm:pb-6 max-w-2xl text-[14px] sm:text-[15px] leading-relaxed text-[#191919]/65 font-light">
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
