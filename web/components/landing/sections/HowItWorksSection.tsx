import Reveal from "../Reveal";

const STEPS = [
  {
    n: "01",
    title: "Create a session or an issue",
    body: "Open a live room for the team, or file a ticket the headless agent will pick up after the delay.",
  },
  {
    n: "02",
    title: "Invite, or walk away",
    body: "Share an invite for rooms. Issues never create a session — Cursor Cloud runs in the background.",
  },
  {
    n: "03",
    title: "Steer, review, ship",
    body: "Redirect mid-flight, approve tools, pin rooms to the board, or open the PR the agent already filed.",
  },
] as const;

export default function HowItWorksSection() {
  return (
    <section className="border-t border-white/[0.06] bg-[#0b0b0b]">
      <div className="mx-auto max-w-6xl px-5 py-20 sm:px-8 sm:py-28">
        <Reveal>
          <div className="max-w-lg">
            <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-[#6e6e6e] sm:text-[12px]">
              How it works
            </p>
            <h2 className="landing-serif mt-3 text-[32px] leading-[1.12] tracking-tight text-white sm:text-[40px]">
              From a ticket to a live room to a PR
            </h2>
            <p className="mt-4 text-[15px] font-light leading-relaxed text-[#a0a0a0]">
              Two paths, one product: watch the work happen, or let the agent
              pick it up while you&rsquo;re gone.
            </p>
          </div>
        </Reveal>
        <ol className="mt-14 grid gap-12 sm:mt-16 md:grid-cols-3">
          {STEPS.map((step, i) => (
            <Reveal key={step.n} as="li" delay={i * 90} className="min-w-0">
              <span className="text-[12px] font-medium tracking-[0.14em] text-[#6e6e6e]">
                {step.n}
              </span>
              <h3 className="landing-serif mt-4 text-[22px] tracking-tight text-white sm:text-[24px]">
                {step.title}
              </h3>
              <p className="mt-3 text-[14px] font-light leading-relaxed text-[#a0a0a0] sm:text-[15px]">
                {step.body}
              </p>
            </Reveal>
          ))}
        </ol>
      </div>
    </section>
  );
}
