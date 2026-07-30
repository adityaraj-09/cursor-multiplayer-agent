"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import BoomerangVideoBg from "./BoomerangVideoBg";

const STEPS = [
  {
    n: "01",
    title: "Open a session",
    body: "Start a local or cloud Cursor agent room in seconds. Pair your CLI once and keep working from your machine.",
  },
  {
    n: "02",
    title: "Invite the room",
    body: "Share a link. Teammates watch the agent live, read the diff stream, and stay aligned without screen-share chaos.",
  },
  {
    n: "03",
    title: "Steer together",
    body: "Anyone can redirect the agent. Hand off control when you need a tighter grip — then keep moving.",
  },
] as const;

const PILLARS = [
  {
    title: "Live presence",
    body: "See who is in the room. Follow the agent’s steps and file changes as they happen.",
  },
  {
    title: "Attributed steering",
    body: "Messages stay credited to people. Context doesn’t get lost when the conversation moves fast.",
  },
  {
    title: "Durable sessions",
    body: "Rooms and history persist. Resume Cursor chats. Leave, return, pick up where the work paused.",
  },
] as const;

export default function LandingPage() {
  return (
    <div className="landing min-h-screen bg-white text-[#191919] antialiased">
      <header className="absolute top-0 inset-x-0 z-20">
        <div className="mx-auto max-w-6xl px-5 sm:px-8 h-16 flex items-center justify-between">
          <Link
            href="/"
            className="landing-serif text-[22px] tracking-tight text-[#191919]"
          >
            Steer
          </Link>
          <div className="flex items-center gap-2 sm:gap-3">
            <Link
              href="/login"
              className="h-9 px-3.5 rounded-full text-[13px] font-medium text-[#191919]/80 hover:text-[#191919] transition-colors"
            >
              Sign in
            </Link>
            <Link
              href="/login?redirect=/create"
              className="group inline-flex h-9 items-center gap-1.5 rounded-full bg-[#191919] px-4 text-[13px] font-medium text-white hover:bg-black transition-colors"
            >
              Get started
              <ArrowRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5" />
            </Link>
          </div>
        </div>
      </header>

      {/* Hero — one composition: brand, headline, sentence, CTA, video plane */}
      <section className="relative h-[100dvh] min-h-[640px] overflow-hidden">
        <BoomerangVideoBg />

        <div className="relative z-10 h-full mx-auto max-w-6xl px-5 sm:px-8 flex flex-col justify-end pb-16 sm:pb-20 pt-24">
          <div className="max-w-xl landing-fade">
            <p className="landing-serif text-[42px] sm:text-[56px] leading-[1.05] tracking-tight text-[#191919]">
              Steer
            </p>
            <h1 className="mt-3 sm:mt-4 landing-serif text-[28px] sm:text-[36px] leading-[1.15] tracking-tight text-[#191919]/90">
              Shared live agent sessions
            </h1>
            <p className="mt-4 sm:mt-5 text-[15px] sm:text-[16px] leading-relaxed text-[#191919]/70 max-w-md font-light">
              Multiplayer Cursor rooms where your team can watch, redirect, and
              hand off control — like a document, for agent work.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link
                href="/login?redirect=/create"
                className="group inline-flex h-11 items-center gap-2 rounded-full bg-[#191919] px-5 text-[14px] font-medium text-white hover:bg-black transition-colors"
              >
                Start a session
                <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
              </Link>
              <Link
                href="/login"
                className="inline-flex h-11 items-center rounded-full border border-[#191919]/15 bg-white/60 backdrop-blur-sm px-5 text-[14px] font-medium text-[#191919] hover:border-[#191919]/30 transition-colors"
              >
                Sign in
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="border-t border-[#191919]/08">
        <div className="mx-auto max-w-6xl px-5 sm:px-8 py-20 sm:py-28">
          <div className="max-w-lg">
            <p className="text-[12px] font-medium tracking-[0.14em] uppercase text-[#191919]/45">
              How it works
            </p>
            <h2 className="mt-3 landing-serif text-[32px] sm:text-[40px] leading-[1.15] tracking-tight">
              From solo agent to shared room
            </h2>
            <p className="mt-4 text-[15px] leading-relaxed text-[#191919]/65 font-light">
              One flow. No screen shares. Everyone sees the same agent, the same
              diffs, the same moment.
            </p>
          </div>

          <ol className="mt-14 sm:mt-16 grid gap-10 sm:gap-12 md:grid-cols-3">
            {STEPS.map((step) => (
              <li key={step.n} className="min-w-0">
                <span className="text-[12px] font-medium tracking-[0.12em] text-[#191919]/40">
                  {step.n}
                </span>
                <h3 className="mt-3 landing-serif text-[22px] sm:text-[24px] tracking-tight">
                  {step.title}
                </h3>
                <p className="mt-3 text-[14px] leading-relaxed text-[#191919]/65 font-light">
                  {step.body}
                </p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Product pillars */}
      <section className="border-t border-[#191919]/08 bg-[#FAFAF8]">
        <div className="mx-auto max-w-6xl px-5 sm:px-8 py-20 sm:py-28">
          <div className="md:grid md:grid-cols-12 md:gap-12 items-start">
            <div className="md:col-span-5">
              <p className="text-[12px] font-medium tracking-[0.14em] uppercase text-[#191919]/45">
                Built for teams
              </p>
              <h2 className="mt-3 landing-serif text-[32px] sm:text-[40px] leading-[1.15] tracking-tight">
                Collaboration without the ceremony
              </h2>
            </div>
            <div className="mt-10 md:mt-0 md:col-span-7 space-y-10">
              {PILLARS.map((pillar) => (
                <div
                  key={pillar.title}
                  className="border-t border-[#191919]/10 pt-8 first:border-t-0 first:pt-0"
                >
                  <h3 className="landing-serif text-[22px] tracking-tight">
                    {pillar.title}
                  </h3>
                  <p className="mt-2.5 text-[15px] leading-relaxed text-[#191919]/65 font-light max-w-md">
                    {pillar.body}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Local + Cloud */}
      <section className="border-t border-[#191919]/08">
        <div className="mx-auto max-w-6xl px-5 sm:px-8 py-20 sm:py-28">
          <div className="max-w-2xl">
            <p className="text-[12px] font-medium tracking-[0.14em] uppercase text-[#191919]/45">
              Runtimes
            </p>
            <h2 className="mt-3 landing-serif text-[32px] sm:text-[40px] leading-[1.15] tracking-tight">
              Local when you need the machine.
              <br className="hidden sm:block" />
              Cloud when you need reach.
            </h2>
            <p className="mt-5 text-[15px] leading-relaxed text-[#191919]/65 font-light">
              Run against a folder on your laptop with the Steer CLI, or point a
              cloud agent at a GitHub repo. Same room model either way — invite,
              watch, steer.
            </p>
          </div>

          <div className="mt-14 grid gap-8 sm:grid-cols-2">
            <div className="min-w-0">
              <h3 className="landing-serif text-[22px] tracking-tight">
                Local + CLI
              </h3>
              <p className="mt-3 text-[14px] leading-relaxed text-[#191919]/65 font-light">
                Pair once, keep{" "}
                <code className="text-[13px] landing-mono text-[#191919]">
                  steer start
                </code>{" "}
                running, and let the hosted app relay prompts to Cursor on your
                machine.
              </p>
            </div>
            <div className="min-w-0">
              <h3 className="landing-serif text-[22px] tracking-tight">
                Cloud agents
              </h3>
              <p className="mt-3 text-[14px] leading-relaxed text-[#191919]/65 font-light">
                Spin up a remote agent on a repository, stream progress into the
                room, and keep the team in the loop without VPN theater.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Closing CTA */}
      <section className="border-t border-[#191919]/08 bg-[#191919] text-white">
        <div className="mx-auto max-w-6xl px-5 sm:px-8 py-20 sm:py-24">
          <div className="max-w-xl">
            <h2 className="landing-serif text-[34px] sm:text-[44px] leading-[1.1] tracking-tight">
              Ready when the team is.
            </h2>
            <p className="mt-4 text-[15px] leading-relaxed text-white/65 font-light">
              Create a room, invite a teammate, and start steering the same
              agent together.
            </p>
            <Link
              href="/login?redirect=/create"
              className="group mt-8 inline-flex h-11 items-center gap-2 rounded-full bg-white px-5 text-[14px] font-medium text-[#191919] hover:bg-[#f2f2f2] transition-colors"
            >
              Get started
              <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
          </div>
        </div>
      </section>

      <footer className="border-t border-[#191919]/08 bg-white">
        <div className="mx-auto max-w-6xl px-5 sm:px-8 h-16 flex items-center justify-between gap-4">
          <span className="landing-serif text-[16px] text-[#191919]">
            Steer
          </span>
          <p className="text-[12px] text-[#191919]/45">
            Multiplayer Cursor agent sessions
          </p>
        </div>
      </footer>
    </div>
  );
}
