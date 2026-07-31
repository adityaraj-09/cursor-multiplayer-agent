import { Compass, Globe2, Users2, type LucideIcon } from "lucide-react";
import Reveal from "../Reveal";

const AUDIENCES: { icon: LucideIcon; title: string; body: string }[] = [
  {
    icon: Users2,
    title: "Engineering pairs",
    body: "Two people, several agents — review decisions as they happen instead of reconstructing them from a PR later.",
  },
  {
    icon: Compass,
    title: "Leads & mentors",
    body: "Sit in on a session, steer the right agent when it matters, then release control without taking over the keyboard.",
  },
  {
    icon: Globe2,
    title: "Distributed teams",
    body: "Same room across time zones. Local CLI or cloud — Cursor, Claude Code, or both in one collaboration layer.",
  },
];

export default function AudienceSection() {
  return (
    <section className="border-t border-[#191919]/08">
      <div className="mx-auto max-w-6xl px-5 sm:px-8 py-20 sm:py-28">
        <Reveal>
          <div className="max-w-xl">
            <p className="text-[11px] sm:text-[12px] font-medium tracking-[0.16em] uppercase text-[#191919]/45">
              Who it&rsquo;s for
            </p>
            <h2 className="mt-3 landing-serif text-[32px] sm:text-[40px] leading-[1.12] tracking-tight">
              Built for people who ship together
            </h2>
          </div>
        </Reveal>
        <div className="mt-14 sm:mt-16 grid gap-5 md:grid-cols-3">
          {AUDIENCES.map(({ icon: Icon, title, body }, i) => (
            <Reveal key={title} delay={i * 80}>
              <div className="landing-card h-full min-w-0 rounded-[1.5rem] border border-[#191919]/10 bg-white p-7 sm:p-8">
                <div className="landing-card-icon inline-flex h-11 w-11 items-center justify-center rounded-full border border-[#191919]/12 text-[#191919]">
                  <Icon className="w-5 h-5" strokeWidth={1.75} />
                </div>
                <h3 className="mt-6 landing-serif text-[22px] sm:text-[24px] tracking-tight">
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
