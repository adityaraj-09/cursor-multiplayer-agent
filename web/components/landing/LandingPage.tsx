"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { useAuth } from "../AuthProvider";
import BoomerangVideoBg from "./BoomerangVideoBg";

const CAPABILITIES = [
  {
    title: "Watch together",
    body: "Everyone in the room sees the same agent stream, tool calls, and diffs — live.",
  },
  {
    title: "Redirect freely",
    body: "Anyone can message the agent. Steering stays attributed, so the room remains clear.",
  },
  {
    title: "Hand off control",
    body: "Request, grant, or release the driver seat without leaving the session or losing context.",
  },
  {
    title: "Pick up later",
    body: "Rooms and chat history persist. Resume Cursor sessions and return to the same work.",
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
  children: ReactNode;
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

function RoomDiagram() {
  return (
    <div className="relative overflow-hidden rounded-[2rem] border border-[#191919]/10 bg-white shadow-[0_30px_80px_rgba(25,25,25,0.08)]">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(25,25,25,0.08),transparent_28%),radial-gradient(circle_at_80%_10%,rgba(25,25,25,0.05),transparent_25%)]" />
      <svg viewBox="0 0 720 460" className="relative z-10 block w-full h-auto" role="img" aria-label="Shared Steer room diagram">
        <defs>
          <linearGradient id="roomPanel" x1="0" x2="1">
            <stop offset="0%" stopColor="#FFFFFF" />
            <stop offset="100%" stopColor="#F7F5F0" />
          </linearGradient>
          <filter id="softShadow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="20" stdDeviation="22" floodColor="#191919" floodOpacity="0.10" />
          </filter>
        </defs>
        <rect x="52" y="50" width="616" height="360" rx="34" fill="url(#roomPanel)" filter="url(#softShadow)" />
        <rect x="80" y="84" width="560" height="42" rx="21" fill="#191919" fillOpacity="0.06" />
        <circle cx="110" cy="105" r="6" fill="#191919" fillOpacity="0.35" />
        <circle cx="132" cy="105" r="6" fill="#191919" fillOpacity="0.22" />
        <circle cx="154" cy="105" r="6" fill="#191919" fillOpacity="0.16" />
        <text x="520" y="110" fill="#191919" fillOpacity="0.42" fontSize="13" fontFamily="Inter">live room</text>

        <rect x="90" y="154" width="270" height="210" rx="22" fill="#191919" fillOpacity="0.055" />
        <rect x="112" y="178" width="170" height="12" rx="6" fill="#191919" fillOpacity="0.22" />
        <rect x="112" y="208" width="208" height="10" rx="5" fill="#191919" fillOpacity="0.10" />
        <rect x="112" y="230" width="188" height="10" rx="5" fill="#191919" fillOpacity="0.10" />
        <rect x="112" y="252" width="224" height="10" rx="5" fill="#191919" fillOpacity="0.10" />
        <path className="landing-draw" d="M118 310 C158 285, 195 334, 236 302 S307 296, 328 272" fill="none" stroke="#191919" strokeOpacity="0.48" strokeWidth="3" strokeLinecap="round" />
        <circle className="landing-pulse" cx="328" cy="272" r="8" fill="#191919" fillOpacity="0.28" />

        <rect x="390" y="154" width="230" height="96" rx="22" fill="#191919" />
        <text x="414" y="188" fill="white" fontSize="15" fontFamily="Inter" fontWeight="500">Agent is editing</text>
        <rect x="414" y="208" width="144" height="8" rx="4" fill="white" fillOpacity="0.36" />
        <rect x="414" y="226" width="176" height="8" rx="4" fill="white" fillOpacity="0.18" />

        <rect x="390" y="274" width="230" height="90" rx="22" fill="#FFFFFF" stroke="#191919" strokeOpacity="0.12" />
        <text x="414" y="306" fill="#191919" fillOpacity="0.78" fontSize="14" fontFamily="Inter" fontWeight="500">Diff stream</text>
        <rect x="414" y="326" width="54" height="8" rx="4" fill="#3ECF8E" fillOpacity="0.55" />
        <rect x="478" y="326" width="74" height="8" rx="4" fill="#191919" fillOpacity="0.10" />
        <rect x="414" y="344" width="132" height="8" rx="4" fill="#F07070" fillOpacity="0.42" />

        <g className="landing-float-slow">
          <circle cx="156" cy="72" r="22" fill="#191919" />
          <text x="148" y="78" fill="white" fontSize="16" fontFamily="Inter" fontWeight="600">A</text>
        </g>
        <g className="landing-float">
          <circle cx="610" cy="118" r="22" fill="#FFFFFF" stroke="#191919" strokeOpacity="0.16" />
          <text x="602" y="124" fill="#191919" fontSize="16" fontFamily="Inter" fontWeight="600">J</text>
        </g>
        <g className="landing-float-delay">
          <circle cx="594" cy="386" r="22" fill="#191919" fillOpacity="0.08" />
          <text x="586" y="392" fill="#191919" fontSize="16" fontFamily="Inter" fontWeight="600">M</text>
        </g>
      </svg>
    </div>
  );
}

function WorkflowDiagram() {
  const labels = ["Create", "Invite", "Steer"];
  return (
    <div className="relative rounded-[2rem] border border-[#191919]/10 bg-[#FAFAF8] p-6 sm:p-8 overflow-hidden">
      <div className="absolute -top-20 -right-20 w-64 h-64 rounded-full bg-[#191919]/[0.04]" />
      <svg viewBox="0 0 520 220" className="relative z-10 w-full h-auto" aria-hidden>
        <path className="landing-draw" d="M90 120 C170 40, 260 200, 350 120 S440 70, 460 120" fill="none" stroke="#191919" strokeOpacity="0.22" strokeWidth="2.5" strokeLinecap="round" />
        {labels.map((label, index) => {
          const x = 90 + index * 160;
          const y = index % 2 === 0 ? 120 : 84;
          return (
            <g key={label} className="landing-rise" style={{ animationDelay: `${index * 90}ms` }}>
              <circle cx={x} cy={y} r="38" fill={index === 2 ? "#191919" : "#FFFFFF"} stroke="#191919" strokeOpacity="0.14" />
              <text x={x} y={y + 5} textAnchor="middle" fill={index === 2 ? "#FFFFFF" : "#191919"} fontSize="13" fontFamily="Inter" fontWeight="500">{label}</text>
              <text x={x} y={y + 66} textAnchor="middle" fill="#191919" fillOpacity="0.40" fontSize="12" fontFamily="Inter">0{index + 1}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function RuntimeDiagram() {
  return (
    <div className="rounded-[2rem] border border-[#191919]/10 bg-white p-6 sm:p-8 shadow-[0_20px_70px_rgba(25,25,25,0.06)]">
      <svg viewBox="0 0 620 360" className="w-full h-auto" role="img" aria-label="Local and cloud runtime diagram">
        <defs>
          <marker id="runtimeArrow" markerWidth="10" markerHeight="10" refX="7" refY="3" orient="auto">
            <path d="M0,0 L0,6 L8,3 z" fill="#191919" fillOpacity="0.35" />
          </marker>
        </defs>
        <rect x="40" y="44" width="190" height="118" rx="26" fill="#FAFAF8" stroke="#191919" strokeOpacity="0.10" />
        <text x="70" y="88" fill="#191919" fontSize="18" fontFamily="Georgia">Local CLI</text>
        <text x="70" y="118" fill="#191919" fillOpacity="0.52" fontSize="13" fontFamily="Inter">Your machine</text>
        <rect x="70" y="132" width="96" height="8" rx="4" fill="#191919" fillOpacity="0.14" />

        <rect x="390" y="44" width="190" height="118" rx="26" fill="#FAFAF8" stroke="#191919" strokeOpacity="0.10" />
        <text x="420" y="88" fill="#191919" fontSize="18" fontFamily="Georgia">Cloud</text>
        <text x="420" y="118" fill="#191919" fillOpacity="0.52" fontSize="13" fontFamily="Inter">GitHub repo</text>
        <rect x="420" y="132" width="96" height="8" rx="4" fill="#191919" fillOpacity="0.14" />

        <rect x="205" y="220" width="210" height="96" rx="30" fill="#191919" />
        <text x="310" y="258" textAnchor="middle" fill="#FFFFFF" fontSize="20" fontFamily="Georgia">Steer room</text>
        <text x="310" y="286" textAnchor="middle" fill="#FFFFFF" fillOpacity="0.56" fontSize="13" fontFamily="Inter">one collaboration layer</text>

        <path className="landing-draw" d="M230 108 C282 120, 282 206, 260 220" fill="none" stroke="#191919" strokeOpacity="0.35" strokeWidth="2.5" markerEnd="url(#runtimeArrow)" />
        <path className="landing-draw" d="M390 108 C340 126, 344 206, 362 220" fill="none" stroke="#191919" strokeOpacity="0.35" strokeWidth="2.5" markerEnd="url(#runtimeArrow)" />
        <circle className="landing-pulse" cx="310" cy="220" r="8" fill="#191919" fillOpacity="0.25" />
      </svg>
    </div>
  );
}

export default function LandingPage() {
  const { user } = useAuth();
  const signedIn = Boolean(user);
  const primaryHref = signedIn ? "/dashboard" : "/login?redirect=/dashboard";
  const createHref = signedIn ? "/create" : "/login?redirect=/create";

  return (
    <div className="landing min-h-screen bg-white text-[#191919] antialiased">
      <header className="absolute top-0 inset-x-0 z-20">
        <div className="mx-auto max-w-6xl px-5 sm:px-8 h-16 sm:h-[4.5rem] flex items-center justify-between">
          <Link href="/" className="landing-serif text-[22px] sm:text-[24px] tracking-tight text-[#191919]">
            Steer
          </Link>
          <nav className="flex items-center gap-1 sm:gap-3">
            <Link href={signedIn ? "/dashboard" : "/login?redirect=/dashboard"} className="h-9 px-3 sm:px-3.5 rounded-full text-[13px] font-medium text-[#191919]/75 hover:text-[#191919] transition-colors">
              {signedIn ? "Dashboard" : "Sign in"}
            </Link>
            <Link href={createHref} className="group inline-flex h-9 items-center gap-1.5 rounded-full bg-[#191919] px-3.5 sm:px-4 text-[13px] font-medium text-white hover:bg-black transition-colors">
              {signedIn ? "New session" : "Get started"}
              <ArrowRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5" />
            </Link>
          </nav>
        </div>
      </header>

      <section className="relative h-[100dvh] min-h-[640px] max-h-[1100px] overflow-hidden">
        <BoomerangVideoBg />
        <div className="relative z-10 h-full mx-auto max-w-6xl px-5 sm:px-8 flex flex-col justify-end pb-14 sm:pb-20 pt-24">
          <div className="max-w-2xl landing-fade">
            <h1 className="landing-serif text-[48px] sm:text-[64px] md:text-[72px] leading-[0.98] tracking-tight text-[#191919]">Steer</h1>
            <p className="mt-4 sm:mt-5 text-[15px] sm:text-[17px] leading-relaxed text-[#191919]/70 max-w-lg font-light">
              Shared live Cursor agent sessions — so your team can watch, redirect, and hand off control like a document, not a screen share.
            </p>
            <div className="mt-8 sm:mt-10 flex flex-wrap items-center gap-3">
              <CtaLink href={createHref}>Start a session</CtaLink>
              <CtaLink href={primaryHref} variant="secondary">{signedIn ? "Open dashboard" : "Sign in"}</CtaLink>
            </div>
          </div>
        </div>
      </section>

      <section className="border-t border-[#191919]/08">
        <div className="mx-auto max-w-6xl px-5 sm:px-8 py-20 sm:py-28 grid md:grid-cols-12 gap-10 md:gap-14 items-center">
          <div className="md:col-span-5">
            <p className="text-[11px] sm:text-[12px] font-medium tracking-[0.16em] uppercase text-[#191919]/45">The idea</p>
            <p className="mt-4 landing-serif text-[28px] sm:text-[40px] md:text-[44px] leading-[1.2] tracking-tight text-[#191919]">Agent work is better when it isn’t solitary.</p>
            <p className="mt-5 text-[15px] leading-relaxed text-[#191919]/65 font-light">Steer turns a single Cursor run into a room your team can inhabit together — with presence, attribution, diffs, and control.</p>
          </div>
          <div className="md:col-span-7"><RoomDiagram /></div>
        </div>
      </section>

      <section className="border-t border-[#191919]/08 bg-[#FAFAF8]">
        <div className="mx-auto max-w-6xl px-5 sm:px-8 py-20 sm:py-28">
          <div className="max-w-xl">
            <p className="text-[11px] sm:text-[12px] font-medium tracking-[0.16em] uppercase text-[#191919]/45">Product</p>
            <h2 className="mt-3 landing-serif text-[32px] sm:text-[40px] leading-[1.12] tracking-tight">Everything the room needs. Nothing it doesn’t.</h2>
          </div>
          <div className="mt-14 sm:mt-16 grid gap-10 sm:grid-cols-2">
            {CAPABILITIES.map((item, i) => (
              <div key={item.title} className="min-w-0 landing-rise" style={{ animationDelay: `${i * 60}ms` }}>
                <p className="text-[12px] font-medium tracking-[0.14em] text-[#191919]/40">0{i + 1}</p>
                <h3 className="mt-3 landing-serif text-[22px] sm:text-[24px] tracking-tight">{item.title}</h3>
                <p className="mt-3 text-[14px] sm:text-[15px] leading-relaxed text-[#191919]/65 font-light max-w-md">{item.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-[#191919]/08">
        <div className="mx-auto max-w-6xl px-5 sm:px-8 py-20 sm:py-28">
          <div className="max-w-lg">
            <p className="text-[11px] sm:text-[12px] font-medium tracking-[0.16em] uppercase text-[#191919]/45">How it works</p>
            <h2 className="mt-3 landing-serif text-[32px] sm:text-[40px] leading-[1.12] tracking-tight">From solo agent to shared room</h2>
            <p className="mt-4 text-[15px] leading-relaxed text-[#191919]/65 font-light">One continuous surface. No meeting link. No “can you see my screen?”</p>
          </div>
          <ol className="mt-14 sm:mt-16 grid gap-12 md:grid-cols-3">
            {STEPS.map((step) => (
              <li key={step.n} className="min-w-0">
                <span className="text-[12px] font-medium tracking-[0.14em] text-[#191919]/40">{step.n}</span>
                <h3 className="mt-4 landing-serif text-[22px] sm:text-[24px] tracking-tight">{step.title}</h3>
                <p className="mt-3 text-[14px] sm:text-[15px] leading-relaxed text-[#191919]/65 font-light">{step.body}</p>
              </li>
            ))}
          </ol>
          <div className="mt-14"><WorkflowDiagram /></div>
        </div>
      </section>

      <section className="border-t border-[#191919]/08 bg-[#FAFAF8]">
        <div className="mx-auto max-w-6xl px-5 sm:px-8 py-20 sm:py-28">
          <div className="md:grid md:grid-cols-12 md:gap-16 items-start">
            <div className="md:col-span-5">
              <p className="text-[11px] sm:text-[12px] font-medium tracking-[0.16em] uppercase text-[#191919]/45">Runtimes</p>
              <h2 className="mt-3 landing-serif text-[32px] sm:text-[40px] leading-[1.12] tracking-tight">Local when you need the machine. Cloud when you need reach.</h2>
              <div className="mt-10 hidden md:block"><RuntimeDiagram /></div>
            </div>
            <div className="mt-12 md:mt-0 md:col-span-7 space-y-12">
              <div>
                <h3 className="landing-serif text-[22px] sm:text-[24px] tracking-tight">Local + CLI</h3>
                <p className="mt-3 text-[15px] leading-relaxed text-[#191919]/65 font-light max-w-md">Pair once, keep <code className="landing-mono text-[13px] text-[#191919]">steer start</code> running, and let the hosted app relay prompts to Cursor on your laptop — against any folder you choose.</p>
              </div>
              <div className="border-t border-[#191919]/10 pt-12">
                <h3 className="landing-serif text-[22px] sm:text-[24px] tracking-tight">Cloud agents</h3>
                <p className="mt-3 text-[15px] leading-relaxed text-[#191919]/65 font-light max-w-md">Point a remote agent at a GitHub repository, stream progress into the room, and keep collaborators in lockstep without VPN theater.</p>
              </div>
            </div>
          </div>
          <div className="mt-12 md:hidden"><RuntimeDiagram /></div>
        </div>
      </section>

      <section className="border-t border-[#191919]/08">
        <div className="mx-auto max-w-6xl px-5 sm:px-8 py-20 sm:py-28">
          <div className="max-w-xl">
            <p className="text-[11px] sm:text-[12px] font-medium tracking-[0.16em] uppercase text-[#191919]/45">Who it’s for</p>
            <h2 className="mt-3 landing-serif text-[32px] sm:text-[40px] leading-[1.12] tracking-tight">Built for people who ship together</h2>
          </div>
          <div className="mt-14 sm:mt-16 grid gap-10 md:grid-cols-3">
            {AUDIENCES.map((item) => (
              <div key={item.title} className="min-w-0">
                <h3 className="landing-serif text-[22px] sm:text-[24px] tracking-tight">{item.title}</h3>
                <p className="mt-3 text-[14px] sm:text-[15px] leading-relaxed text-[#191919]/65 font-light">{item.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-[#191919]/08 bg-[#191919] text-white">
        <div className="mx-auto max-w-6xl px-5 sm:px-8 py-20 sm:py-28">
          <div className="max-w-2xl">
            <h2 className="landing-serif text-[34px] sm:text-[48px] leading-[1.08] tracking-tight">Ready when the team is.</h2>
            <p className="mt-5 text-[15px] sm:text-[16px] leading-relaxed text-white/65 font-light max-w-lg">Create a room, invite a teammate, and start steering the same agent — live, attributed, and durable.</p>
            <div className="mt-9"><CtaLink href={createHref} variant="light">{signedIn ? "Create session" : "Get started"}</CtaLink></div>
          </div>
        </div>
      </section>

      <footer className="border-t border-[#191919]/08 bg-white">
        <div className="mx-auto max-w-6xl px-5 sm:px-8 py-8 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <span className="landing-serif text-[18px] text-[#191919]">Steer</span>
          <p className="text-[12px] text-[#191919]/45">Multiplayer Cursor agent sessions</p>
          <div className="flex items-center gap-4 text-[12px]">
            <Link href={signedIn ? "/dashboard" : "/login?redirect=/dashboard"} className="text-[#191919]/55 hover:text-[#191919] transition-colors">{signedIn ? "Dashboard" : "Sign in"}</Link>
            <Link href={createHref} className="text-[#191919]/55 hover:text-[#191919] transition-colors">Create session</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
