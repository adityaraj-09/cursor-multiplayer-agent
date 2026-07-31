import Reveal from "../Reveal";
import { WorkflowDiagram } from "../diagrams";

const STEPS = [
  {
    n: "01",
    title: "Create a session",
    body: "Open a local or cloud room. Add Cursor agents, Claude Code agents, or both — pair the CLI once for machines at home.",
  },
  {
    n: "02",
    title: "Invite the team",
    body: "Share an invite link. Teammates join signed-in and see every agent's stream immediately.",
  },
  {
    n: "03",
    title: "Steer the work",
    body: "Switch agents, redirect mid-flight, abort a run, and hand off control when someone else should lead.",
  },
] as const;

export default function HowItWorksSection() {
  return (
    <section className="border-t border-[#191919]/08">
      <div className="mx-auto max-w-6xl px-5 sm:px-8 py-20 sm:py-28">
        <Reveal>
          <div className="max-w-lg">
            <p className="text-[11px] sm:text-[12px] font-medium tracking-[0.16em] uppercase text-[#191919]/45">
              How it works
            </p>
            <h2 className="mt-3 landing-serif text-[32px] sm:text-[40px] leading-[1.12] tracking-tight">
              From solo runs to a shared multi-agent room
            </h2>
            <p className="mt-4 text-[15px] leading-relaxed text-[#191919]/65 font-light">
              One continuous surface for every agent. No meeting link. No &ldquo;can you see my
              screen?&rdquo;
            </p>
          </div>
        </Reveal>
        <ol className="mt-14 sm:mt-16 grid gap-12 md:grid-cols-3">
          {STEPS.map((step, i) => (
            <Reveal key={step.n} as="li" delay={i * 90} className="min-w-0">
              <span className="text-[12px] font-medium tracking-[0.14em] text-[#191919]/40">
                {step.n}
              </span>
              <h3 className="mt-4 landing-serif text-[22px] sm:text-[24px] tracking-tight">
                {step.title}
              </h3>
              <p className="mt-3 text-[14px] sm:text-[15px] leading-relaxed text-[#191919]/65 font-light">
                {step.body}
              </p>
            </Reveal>
          ))}
        </ol>
        <Reveal delay={120} className="mt-14">
          <WorkflowDiagram />
        </Reveal>
      </div>
    </section>
  );
}
