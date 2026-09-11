"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { useAuth } from "../AuthProvider";
import Reveal from "./Reveal";
import HeroDashboard, { IssuesShowcase } from "./mock/HeroDashboard";
import RoomsSection from "./sections/RoomsSection";
import { CliShowcase, PickupSettingsMock, PrShowcase } from "./mock/ShipShowcase";
import LogoStrip from "./sections/LogoStrip";
import FeatureGrid from "./sections/FeatureGrid";
import HowItWorksSection from "./sections/HowItWorksSection";
import ComparisonSection from "./sections/ComparisonSection";
import AudienceSection from "./sections/AudienceSection";
import Faq from "./sections/Faq";

function CtaLink({
  href,
  children,
  variant = "primary",
}: {
  href: string;
  children: ReactNode;
  variant?: "primary" | "secondary" | "light";
}) {
  const base =
    "group inline-flex h-11 items-center gap-2 rounded-full px-5 text-[14px] font-medium transition-colors";
  const styles =
    variant === "primary"
      ? "bg-[#e4e4e4] text-[#111] hover:bg-white"
      : variant === "light"
        ? "bg-[#e4e4e4] text-[#111] hover:bg-white"
        : "border border-white/12 bg-white/[0.04] text-[#e4e4e4] hover:border-white/22";

  return (
    <Link href={href} className={`${base} ${styles}`}>
      {children}
      <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
}

export default function LandingPage() {
  const { user } = useAuth();
  const signedIn = Boolean(user);
  const primaryHref = signedIn ? "/dashboard" : "/login?redirect=/dashboard";
  const createHref = signedIn
    ? "/dashboard?compose=1"
    : `/login?redirect=${encodeURIComponent("/dashboard?compose=1")}`;
  const issuesHref = signedIn ? "/issues" : "/login?redirect=/issues";

  return (
    <div className="landing min-h-screen bg-[#0b0b0b] text-[#e8e8e8] antialiased">
      <header className="sticky top-0 z-30 border-b border-white/[0.06] bg-[#0b0b0b]/80 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-5 sm:px-8">
          <Link href="/" className="landing-serif text-[21px] tracking-tight text-white">
            Steer
          </Link>
          <nav className="hidden items-center gap-6 text-[13px] text-[#a0a0a0] md:flex">
            <a href="#product" className="hover:text-white">
              Product
            </a>
            <a href="#issues" className="hover:text-white">
              Issues
            </a>
            <a href="#rooms" className="hover:text-white">
              Rooms
            </a>
            <a href="#ship" className="hover:text-white">
              Ship
            </a>
          </nav>
          <div className="flex items-center gap-2 sm:gap-3">
            <Link
              href={signedIn ? "/dashboard" : "/login?redirect=/dashboard"}
              className="h-9 rounded-full px-3 text-[13px] font-medium leading-9 text-[#a0a0a0] hover:text-white"
            >
              {signedIn ? "Dashboard" : "Sign in"}
            </Link>
            <Link
              href={createHref}
              className="group inline-flex h-9 items-center gap-1.5 rounded-full bg-[#e4e4e4] px-3.5 text-[13px] font-medium text-[#111] hover:bg-white"
            >
              {signedIn ? "New session" : "Sign up"}
              <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
            </Link>
          </div>
        </div>
      </header>

      <section className="bg-[#0b0b0b]">
        <div className="mx-auto max-w-6xl px-5 pb-16 pt-24 sm:px-8 sm:pb-24 sm:pt-32">
          <div className="landing-fade max-w-3xl">
            <h1 className="landing-hero-title text-[44px] leading-[1.02] text-white sm:text-[64px] md:text-[80px]">
              The control room for teams and agents
            </h1>
            <p className="mt-6 max-w-xl text-[15px] font-light leading-relaxed text-[#8a8a8a] sm:text-[16px]">
              Purpose-built for Cursor and Claude Code. Debug a crash or work a
              feature with your team on the board. Or create an issue and let an
              agent pick it up.
            </p>
          </div>
          <div className="landing-rise mt-16 sm:mt-20" style={{ animationDelay: "0.12s" }}>
            <HeroDashboard />
          </div>
        </div>
      </section>

      <LogoStrip />

      <section id="issues" className="border-t border-white/[0.06]">
        <div className="mx-auto max-w-6xl px-5 py-20 sm:px-8 sm:py-28">
          <div className="grid items-start gap-12 md:grid-cols-12 md:gap-14">
            <Reveal variant="left" className="md:col-span-5">
              <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-[#6e6e6e]">
                Issues
              </p>
              <h2 className="landing-serif mt-3 text-[32px] leading-[1.12] tracking-tight text-white sm:text-[40px]">
                File it. Walk away. Come back to a PR.
              </h2>
              <p className="mt-4 max-w-md text-[15px] font-light leading-relaxed text-[#a0a0a0]">
                Issues never appear in Sessions. After the pickup delay, a headless
                Cursor Cloud agent runs, opens a pull request, and writes markdown
                on the ticket. Queue, run now, retry, or cancel from the same
                panel you already use.
              </p>
              <ul className="mt-6 space-y-2 text-[14px] text-[#c4c4c4]">
                <li>Delayed pickup — default 10 minutes, configurable</li>
                <li>Max concurrent runs per workspace</li>
                <li>Activity, writeup, and PR link stay on the issue</li>
              </ul>
              <div className="mt-8">
                <PickupSettingsMock />
              </div>
            </Reveal>
            <Reveal variant="right" delay={80} className="md:col-span-7">
              <IssuesShowcase />
            </Reveal>
          </div>
        </div>
      </section>

      <RoomsSection />

      <FeatureGrid />

      <section id="board" className="border-t border-white/[0.06]">
        <div className="mx-auto max-w-6xl px-5 py-20 sm:px-8 sm:py-28">
          <Reveal>
            <div className="max-w-xl">
              <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-[#6e6e6e]">
                Board
              </p>
              <h2 className="landing-serif mt-3 text-[32px] leading-[1.12] tracking-tight text-white sm:text-[40px]">
                Pin rooms to a theater wall. Go fullscreen.
              </h2>
              <p className="mt-4 text-[15px] font-light leading-relaxed text-[#a0a0a0]">
                Select sessions on the dashboard, open the board, and present.
                Tiles stay live — chat still works on unfocused rooms. This is
                the war-room view issue trackers never grew.
              </p>
            </div>
          </Reveal>
          <Reveal delay={80} className="mt-10">
            <HeroDashboard initialView="board" />
          </Reveal>
        </div>
      </section>

      <section id="ship" className="border-t border-white/[0.06] bg-[#101010]">
        <div className="mx-auto max-w-6xl px-5 py-20 sm:px-8 sm:py-28">
          <div className="grid items-start gap-12 md:grid-cols-12">
            <Reveal variant="left" className="md:col-span-5">
              <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-[#6e6e6e]">
                Build and ship
              </p>
              <h2 className="landing-serif mt-3 text-[32px] leading-[1.12] tracking-tight text-white sm:text-[40px]">
                Integrate on the shared branch. One PR.
              </h2>
              <p className="mt-4 text-[15px] font-light leading-relaxed text-[#a0a0a0]">
                The Integrator merges agent work onto the integration branch and
                opens the pull request — not a Cursor sandbox fork. Cloud or
                local CLI, the PR is the handoff.
              </p>
            </Reveal>
            <Reveal variant="right" delay={80} className="md:col-span-7">
              <PrShowcase />
            </Reveal>
          </div>
        </div>
      </section>

      <section id="cli" className="border-t border-white/[0.06]">
        <div className="mx-auto max-w-6xl px-5 py-20 sm:px-8 sm:py-28">
          <div className="grid items-center gap-12 md:grid-cols-12">
            <Reveal variant="left" className="md:col-span-6">
              <CliShowcase />
            </Reveal>
            <Reveal variant="right" delay={80} className="md:col-span-6">
              <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-[#6e6e6e]">
                Local runtime
              </p>
              <h2 className="landing-serif mt-3 text-[32px] leading-[1.12] tracking-tight text-white sm:text-[40px]">
                Pair the CLI. Keep the laptop in the room.
              </h2>
              <p className="mt-4 text-[15px] font-light leading-relaxed text-[#a0a0a0]">
                Cloud agents when you need reach. <code className="landing-mono text-[#e4e4e4]">steer start</code> when
                the work has to hit a folder on someone&apos;s machine. Same
                dashboard, same steer input.
              </p>
            </Reveal>
          </div>
        </div>
      </section>

      <HowItWorksSection />
      <ComparisonSection />
      <AudienceSection />
      <Faq />

      <section className="border-t border-white/[0.06] bg-[#141414]">
        <div className="mx-auto max-w-6xl px-5 py-20 sm:px-8 sm:py-28">
          <Reveal>
            <div className="max-w-2xl">
              <h2 className="landing-serif text-[34px] leading-[1.08] tracking-tight text-white sm:text-[48px]">
                Ready when the team is.
              </h2>
              <p className="mt-5 max-w-lg text-[15px] font-light leading-relaxed text-[#a0a0a0] sm:text-[16px]">
                Create a room, queue an issue, invite a teammate, and steer —
                live, attributed, and durable.
              </p>
              <div className="mt-9 flex flex-wrap gap-3">
                <CtaLink href={createHref} variant="light">
                  {signedIn ? "Create session" : "Get started"}
                </CtaLink>
                <CtaLink href={primaryHref} variant="secondary">
                  {signedIn ? "Open dashboard" : "Sign in"}
                </CtaLink>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      <footer className="border-t border-white/[0.06] bg-[#0b0b0b]">
        <div className="mx-auto flex max-w-6xl flex-col justify-between gap-4 px-5 py-8 sm:flex-row sm:items-center sm:px-8">
          <span className="landing-serif text-[18px] text-white">Steer</span>
          <p className="text-[12px] text-[#6e6e6e]">
            Multiplayer Cursor &amp; Claude Code · headless issues
          </p>
          <div className="flex items-center gap-4 text-[12px]">
            <Link
              href={signedIn ? "/dashboard" : "/login?redirect=/dashboard"}
              className="text-[#6e6e6e] hover:text-white"
            >
              {signedIn ? "Dashboard" : "Sign in"}
            </Link>
            <Link href={issuesHref} className="text-[#6e6e6e] hover:text-white">
              Issues
            </Link>
            <Link href={createHref} className="text-[#6e6e6e] hover:text-white">
              Create session
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
