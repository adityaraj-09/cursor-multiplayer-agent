"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import BoomerangVideoBg from "./BoomerangVideoBg";

const CAPABILITIES = [
  {
    title: "Watch together",
    body: "Everyone in the room sees the same agent stream, the same tool calls, and the same diffs — live.",
  },
  {
    title: "Redirect freely",
    body: "Anyone can message the agent. Steering stays attributed, so the thread remains clear under pressure.",
  },
  {
    title: "Hand off control",
    body: "Request, grant, or release the driver seat without leaving the session or losing context.",
  },
  {
    title: "Pick up later",
    body: "Rooms and chat history persist. Resume Cursor sessions. Come back to the same work.",
  },
] as const;

const STEPS = [
  {
    n: "01",
    title: "Create a session",
    body: "Open a local or cloud Cursor agent room. Pair the CLI once if you want agents on your machine.",
  },
  {
    n: "02",
    title: "Invite the team",
    body: "Share an invite link. Teammates join signed-in, land in the room, and see the agent immediately.",
  },
  {
    n: "03",
    title: "Steer the work",
    body: "Watch the run, redirect mid-flight, abort if needed, and hand off control when someone else should lead.",
  },
] as const;

const AUDIENCES = [
  {
    title: "Engineering pairs",
    body: "Two people, one agent — review decisions as they happen instead of reconstructing them from a PR later.",
  },
  {
    title: "Leads & mentors",
    body: "Sit in on a session, steer when it matters, then release control without taking over the keyboard.",
  },
  {
    title: "Distributed teams",
    body: "Same room across time zones. Local CLI or cloud runtime — the collaboration model stays identical.",
  },
] as const;

function CtaLink({
  href,
  children,
  variant = "primary",
}: {
  href: string;
  children: React.ReactNode;
  variant?: "primary" | "secondary" | "light";
}) {
  const base =
    "group inline-flex h-11 items-center gap-2 rounded-full px-5 text-[14px] font-medium transition-colors";
  const styles =
    variant === "primary"
      ? "bg-[#191919] text-white hover:bg-black"
      : variant === "light"
        ? "bg-white text-[#191919] hover:bg-[#f2f2f2]"
        : "border border-[#191919]/15 bg-white/60 backdrop-blur-sm text-[#191919] hover:border-[#191919]/30";

  return (
    <Link href={href} className={`${base} ${styles}`}>
      {children}
      <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
}

export default function LandingPage() {
  return (
    <div className="landing min-h-screen bg-white text-[#191919] antialiased">
      {/* Nav */}
      <header className="absolute top-0 inset-x-0 z-20">
        <div className="mx-auto max-w-6xl px-5 sm:px-8 h-16 sm:h-[4.5rem] flex items-center justify-between">
          <Link
            href="/"
            className="landing-serif text-[22px] sm:text-[24px] tracking-tight text-[#191919]"
          >
            Steer
          </Link>
          <nav className="flex items-center gap-1 sm:gap-3">
            <Link
              href="/login"
              className="h-9 px-3 sm:px-3.5 rounded-full text-[13px] font-medium text-[#191919]/75 hover:text-[#191919] transition-colors"
            >
              Sign in
            </Link>
            <Link
              href="/login?redirect=/create"
              className="group inline-flex h-9 items-center gap-1.5 rounded-full bg-[#191919] px-3.5 sm:px-4 text-[13px] font-medium text-white hover:bg-black transition-colors"
            >
              Get started
              <ArrowRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5" />
            </Link>
          </nav>
        </div>
      </header>

      {/* ── Hero ── full viewport, brand-first, video plane */}
      <section className="relative h-[100dvh] min-h-[640px] max-h-[1100px] overflow-hidden">
        <BoomerangVideoBg />

        <div className="relative z-10 h-full mx-auto max-w-6xl px-5 sm:px-8 flex flex-col justify-end pb-14 sm:pb-20 pt-24">
          <div className="max-w-2xl landing-fade">
            <p className="landing-serif text-[48px] sm:text-[64px] md:text-[72px] leading-[0.98] tracking-tight text-[#191919]">
              Steer
            </p>
            <h1 className="mt-4 sm:mt-5 landing-serif text-[28px] sm:text-[40px] md:text-[44px] leading-[1.12] tracking-tight text-[#191919]">
              Build lasting relationships
            </h1>
            <p className="mt-4 sm:mt-5 text-[15px] sm:text-[17px] leading-relaxed text-[#191919]/70 max-w-lg font-light">
              Shared live Cursor agent sessions — so your team can watch,
              redirect, and hand off control like a document, not a screen share.
            </p>
            <div className="mt-8 sm:mt-10 flex flex-wrap items-center gap-3">
              <CtaLink href="/login?redirect=/create">Start a session</CtaLink>
              <CtaLink href="/login" variant="secondary">
                Sign in
              </CtaLink>
            </div>
          </div>
        </div>
      </section>

      {/* ── Statement ── */}
      <section className="border-t border-[#191919]/08">
        <div className="mx-auto max-w-6xl px-5 sm:px-8 py-20 sm:py-28">
          <p className="landing-serif text-[28px] sm:text-[40px] md:text-[44px] leading-[1.2] tracking-tight max-w-4xl text-[#191919]">
            Agent work is better when it isn’t solitary. Steer turns a single
            Cursor run into a room your team can inhabit together.
          </p>
        </div>
      </section>

      {/* ── Capabilities ── */}
      <section className="border-t border-[#191919]/08 bg-[#FAFAF8]">
        <div className="mx-auto max-w-6xl px-5 sm:px-8 py-20 sm:py-28">
          <div className="max-w-xl">
            <p className="text-[11px] sm:text-[12px] font-medium tracking-[0.16em] uppercase text-[#191919]/45">
              Product
            </p>
            <h2 className="mt-3 landing-serif text-[32px] sm:text-[40px] leading-[1.12] tracking-tight">
              Everything the room needs. Nothing it doesn’t.
            </h2>
          </div>

          <div className="mt-14 sm:mt-16 grid gap-x-10 gap-y-12 sm:grid-cols-2">
            {CAPABILITIES.map((item, i) => (
              <div
                key={item.title}
                className="min-w-0 border-t border-[#191919]/10 pt-7 landing-rise"
                style={{ animationDelay: `${i * 60}ms` }}
              >
                <h3 className="landing-serif text-[22px] sm:text-[24px] tracking-tight">
                  {item.title}
                </h3>
                <p className="mt-3 text-[14px] sm:text-[15px] leading-relaxed text-[#191919]/65 font-light max-w-md">
                  {item.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── How it works ── */}
      <section className="border-t border-[#191919]/08">
        <div className="mx-auto max-w-6xl px-5 sm:px-8 py-20 sm:py-28">
          <div className="max-w-lg">
            <p className="text-[11px] sm:text-[12px] font-medium tracking-[0.16em] uppercase text-[#191919]/45">
              How it works
            </p>
            <h2 className="mt-3 landing-serif text-[32px] sm:text-[40px] leading-[1.12] tracking-tight">
              From solo agent to shared room
            </h2>
            <p className="mt-4 text-[15px] leading-relaxed text-[#191919]/65 font-light">
              One continuous surface. No meeting link. No “can you see my
              screen?”
            </p>
          </div>

          <ol className="mt-14 sm:mt-16 grid gap-12 md:grid-cols-3">
            {STEPS.map((step) => (
              <li key={step.n} className="min-w-0">
                <span className="text-[12px] font-medium tracking-[0.14em] text-[#191919]/40">
                  {step.n}
                </span>
                <h3 className="mt-4 landing-serif text-[22px] sm:text-[24px] tracking-tight">
                  {step.title}
                </h3>
                <p className="mt-3 text-[14px] sm:text-[15px] leading-relaxed text-[#191919]/65 font-light">
                  {step.body}
                </p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ── Runtimes ── */}
      <section className="border-t border-[#191919]/08 bg-[#FAFAF8]">
        <div className="mx-auto max-w-6xl px-5 sm:px-8 py-20 sm:py-28">
          <div className="md:grid md:grid-cols-12 md:gap-16 items-start">
            <div className="md:col-span-5">
              <p className="text-[11px] sm:text-[12px] font-medium tracking-[0.16em] uppercase text-[#191919]/45">
                Runtimes
              </p>
              <h2 className="mt-3 landing-serif text-[32px] sm:text-[40px] leading-[1.12] tracking-tight">
                Local when you need the machine. Cloud when you need reach.
              </h2>
            </div>
            <div className="mt-12 md:mt-0 md:col-span-7 space-y-12">
              <div>
                <h3 className="landing-serif text-[22px] sm:text-[24px] tracking-tight">
                  Local + CLI
                </h3>
                <p className="mt-3 text-[15px] leading-relaxed text-[#191919]/65 font-light max-w-md">
                  Pair once, keep{" "}
                  <code className="landing-mono text-[13px] text-[#191919]">
                    steer start
                  </code>{" "}
                  running, and let the hosted app relay prompts to Cursor on your
                  laptop — against any folder you choose.
                </p>
              </div>
              <div className="border-t border-[#191919]/10 pt-12">
                <h3 className="landing-serif text-[22px] sm:text-[24px] tracking-tight">
                  Cloud agents
                </h3>
                <p className="mt-3 text-[15px] leading-relaxed text-[#191919]/65 font-light max-w-md">
                  Point a remote agent at a GitHub repository, stream progress
                  into the room, and keep collaborators in lockstep without VPN
                  theater.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Who it’s for ── */}
      <section className="border-t border-[#191919]/08">
        <div className="mx-auto max-w-6xl px-5 sm:px-8 py-20 sm:py-28">
          <div className="max-w-xl">
            <p className="text-[11px] sm:text-[12px] font-medium tracking-[0.16em] uppercase text-[#191919]/45">
              Who it’s for
            </p>
            <h2 className="mt-3 landing-serif text-[32px] sm:text-[40px] leading-[1.12] tracking-tight">
              Built for people who ship together
            </h2>
          </div>

          <div className="mt-14 sm:mt-16 grid gap-12 md:grid-cols-3">
            {AUDIENCES.map((item) => (
              <div key={item.title} className="min-w-0">
                <h3 className="landing-serif text-[22px] sm:text-[24px] tracking-tight">
                  {item.title}
                </h3>
                <p className="mt-3 text-[14px] sm:text-[15px] leading-relaxed text-[#191919]/65 font-light">
                  {item.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Closing CTA ── */}
      <section className="border-t border-[#191919]/08 bg-[#191919] text-white">
        <div className="mx-auto max-w-6xl px-5 sm:px-8 py-20 sm:py-28">
          <div className="max-w-2xl">
            <h2 className="landing-serif text-[34px] sm:text-[48px] leading-[1.08] tracking-tight">
              Ready when the team is.
            </h2>
            <p className="mt-5 text-[15px] sm:text-[16px] leading-relaxed text-white/65 font-light max-w-lg">
              Create a room, invite a teammate, and start steering the same agent
              — live, attributed, and durable.
            </p>
            <div className="mt-9">
              <CtaLink href="/login?redirect=/create" variant="light">
                Get started
              </CtaLink>
            </div>
          </div>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="border-t border-[#191919]/08 bg-white">
        <div className="mx-auto max-w-6xl px-5 sm:px-8 py-8 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <span className="landing-serif text-[18px] text-[#191919]">Steer</span>
          <p className="text-[12px] text-[#191919]/45">
            Multiplayer Cursor agent sessions
          </p>
          <div className="flex items-center gap-4 text-[12px]">
            <Link
              href="/login"
              className="text-[#191919]/55 hover:text-[#191919] transition-colors"
            >
              Sign in
            </Link>
            <Link
              href="/login?redirect=/create"
              className="text-[#191919]/55 hover:text-[#191919] transition-colors"
            >
              Create session
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
