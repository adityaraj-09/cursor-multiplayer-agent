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
    body: "Same room across time zones. File issues overnight and find PRs waiting — or pair the CLI on a laptop at home.",
  },
];

export default function AudienceSection() {
  return (
    <section className="border-t border-white/[0.06] bg-[#0b0b0b]">
      <div className="mx-auto max-w-6xl px-5 py-20 sm:px-8 sm:py-28">
        <Reveal>
          <div className="max-w-xl">
            <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-[#6e6e6e] sm:text-[12px]">
              Who it&rsquo;s for
            </p>
            <h2 className="landing-serif mt-3 text-[32px] leading-[1.12] tracking-tight text-white sm:text-[40px]">
              Built for people who ship together
            </h2>
          </div>
        </Reveal>
        <div className="mt-14 grid gap-4 sm:mt-16 md:grid-cols-3">
          {AUDIENCES.map(({ icon: Icon, title, body }, i) => (
            <Reveal key={title} delay={i * 80}>
              <div className="landing-card h-full min-w-0 rounded-2xl border border-white/[0.06] bg-[#161616] p-7 sm:p-8">
                <div className="landing-card-icon inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/10 text-white">
                  <Icon className="h-5 w-5" strokeWidth={1.75} />
                </div>
                <h3 className="landing-serif mt-6 text-[22px] tracking-tight text-white sm:text-[24px]">
                  {title}
                </h3>
                <p className="mt-3 text-[14px] font-light leading-relaxed text-[#a0a0a0] sm:text-[15px]">
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
