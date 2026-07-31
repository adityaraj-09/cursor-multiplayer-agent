"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, ChevronDown } from "lucide-react";
import { useAuth } from "../AuthProvider";
import BoomerangVideoBg from "./BoomerangVideoBg";
import Reveal from "./Reveal";
import LogoStrip from "./sections/LogoStrip";
import IdeaSection from "./sections/IdeaSection";
import FeatureGrid from "./sections/FeatureGrid";
import ProductMockup from "./sections/ProductMockup";
import HowItWorksSection from "./sections/HowItWorksSection";
import ComparisonSection from "./sections/ComparisonSection";
import RuntimesSection from "./sections/RuntimesSection";
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
              Multiplayer rooms for Cursor and Claude Code — run several agents together while your team watches, redirects, and hands off control.
            </p>
            <div className="mt-8 sm:mt-10 flex flex-wrap items-center gap-3">
              <CtaLink href={createHref}>Start a session</CtaLink>
              <CtaLink href={primaryHref} variant="secondary">{signedIn ? "Open dashboard" : "Sign in"}</CtaLink>
            </div>
          </div>
        </div>
        <div className="landing-float pointer-events-none absolute bottom-6 left-1/2 z-10 -translate-x-1/2 sm:bottom-8">
          <ChevronDown className="h-5 w-5 text-[#191919]/35" strokeWidth={1.5} />
        </div>
      </section>

      <LogoStrip />
      <IdeaSection />
      <FeatureGrid />
      <ProductMockup />
      <HowItWorksSection />
      <ComparisonSection />
      <RuntimesSection />
      <AudienceSection />
      <Faq />

      <section className="border-t border-[#191919]/08 bg-[#191919] text-white">
        <div className="mx-auto max-w-6xl px-5 sm:px-8 py-20 sm:py-28">
          <Reveal>
            <div className="max-w-2xl">
              <h2 className="landing-serif text-[34px] sm:text-[48px] leading-[1.08] tracking-tight">Ready when the team is.</h2>
              <p className="mt-5 text-[15px] sm:text-[16px] leading-relaxed text-white/65 font-light max-w-lg">Create a room, add Cursor and Claude Code agents, invite a teammate, and steer together — live, attributed, and durable.</p>
              <div className="mt-9"><CtaLink href={createHref} variant="light">{signedIn ? "Create session" : "Get started"}</CtaLink></div>
            </div>
          </Reveal>
        </div>
      </section>

      <footer className="border-t border-[#191919]/08 bg-white">
        <div className="mx-auto max-w-6xl px-5 sm:px-8 py-8 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <span className="landing-serif text-[18px] text-[#191919]">Steer</span>
          <p className="text-[12px] text-[#191919]/45">Multiplayer Cursor &amp; Claude Code sessions</p>
          <div className="flex items-center gap-4 text-[12px]">
            <Link href={signedIn ? "/dashboard" : "/login?redirect=/dashboard"} className="text-[#191919]/55 hover:text-[#191919] transition-colors">{signedIn ? "Dashboard" : "Sign in"}</Link>
            <Link href={createHref} className="text-[#191919]/55 hover:text-[#191919] transition-colors">Create session</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
