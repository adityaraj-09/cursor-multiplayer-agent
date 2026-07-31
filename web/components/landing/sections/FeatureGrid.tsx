import {
  Bot,
  GitCompare,
  History,
  MessagesSquare,
  ShieldCheck,
  Users,
  type LucideIcon,
} from "lucide-react";
import Image from "next/image";
import Reveal from "../Reveal";

const FEATURES: { icon: LucideIcon; title: string; body: string }[] = [
  {
    icon: Bot,
    title: "Many agents, one room",
    body: "Run Cursor and Claude Code side by side — each with its own model, scope, and stream in the same session.",
  },
  {
    icon: Users,
    title: "Watch together",
    body: "Everyone sees live tool calls, diffs, and chat across every agent — not a screen share of one laptop.",
  },
  {
    icon: MessagesSquare,
    title: "Redirect freely",
    body: "Anyone can message any agent. Steering stays attributed, so the room remains clear about who asked for what.",
  },
  {
    icon: ShieldCheck,
    title: "Hand off control",
    body: "Request, grant, or release the driver seat per agent without leaving the session or losing context.",
  },
  {
    icon: GitCompare,
    title: "Live diff stream",
    body: "File changes land in the room as they happen — sandbox git diffs for cloud Claude, watched diffs for local rooms.",
  },
  {
    icon: History,
    title: "Durable history",
    body: "Chat, decisions, and diffs persist per room, so anyone can join mid-session and see exactly how it got there.",
  },
];

export default function FeatureGrid() {
  return (
    <section className="border-t border-[#191919]/08 bg-[#FAFAF8]">
      <div className="mx-auto max-w-6xl px-5 sm:px-8 py-20 sm:py-28">
        <div className="grid gap-10 md:grid-cols-12 md:gap-14 items-center">
          <Reveal variant="left" className="md:col-span-5">
            <p className="text-[11px] sm:text-[12px] font-medium tracking-[0.16em] uppercase text-[#191919]/45">
              Product
            </p>
            <h2 className="mt-3 landing-serif text-[32px] sm:text-[40px] leading-[1.12] tracking-tight">
              Everything the room needs. Nothing it doesn&rsquo;t.
            </h2>
            <p className="mt-4 text-[15px] leading-relaxed text-[#191919]/65 font-light max-w-md">
              Every role an agent can play — researching, planning, writing, executing — shares one
              room instead of four disconnected tabs.
            </p>
          </Reveal>
          <Reveal variant="right" delay={80} className="md:col-span-7">
            <div className="overflow-hidden rounded-[2rem] border border-[#191919]/10 bg-white shadow-[0_30px_80px_rgba(25,25,25,0.08)]">
              <Image
                src="/images/agents-illustration.webp"
                alt="Illustration of several AI agents — researcher, planner, data analyst, executor — collaborating around a shared board"
                width={1400}
                height={933}
                className="w-full h-auto"
                priority={false}
              />
            </div>
          </Reveal>
        </div>

        <div className="mt-14 sm:mt-16 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(({ icon: Icon, title, body }, i) => (
            <Reveal key={title} delay={(i % 3) * 70}>
              <div className="landing-card group h-full min-w-0 rounded-[1.5rem] border border-[#191919]/10 bg-white p-7 sm:p-8">
                <div className="landing-card-icon inline-flex h-11 w-11 items-center justify-center rounded-full bg-[#191919] text-white">
                  <Icon className="w-5 h-5" strokeWidth={1.75} />
                </div>
                <h3 className="mt-6 landing-serif text-[21px] sm:text-[22px] tracking-tight">
                  {title}
                </h3>
                <p className="mt-3 text-[14px] sm:text-[15px] leading-relaxed text-[#191919]/65 font-light">
                  {body}
                </p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
