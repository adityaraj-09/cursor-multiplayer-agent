import Reveal from "../Reveal";
import SwarmShowcase from "../mock/SwarmShowcase";

export default function SwarmSection() {
  return (
    <section id="swarm" className="border-t border-white/[0.06] bg-[#0f0f0f]">
      <div className="mx-auto max-w-6xl px-5 py-20 sm:px-8 sm:py-28">
        <Reveal>
          <div className="max-w-2xl">
            <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-[#6e6e6e]">
              Swarms
            </p>
            <h2 className="landing-serif mt-3 text-[32px] leading-[1.12] tracking-tight text-white sm:text-[40px]">
              A team of agents. One mission. A shared board.
            </h2>
            <p className="mt-4 max-w-xl text-[15px] font-light leading-relaxed text-[#a0a0a0]">
              Give an open-ended goal — beat vLLM on cost per token, survey a
              field, design a stack. An orchestrator plans the work. Researchers
              post findings. Critics push back. A ranker runs a tournament. You
              watch the board, steer when you want, and stop them at the budget.
            </p>
            <ul className="mt-6 space-y-2.5 text-[14px] leading-relaxed text-[#c4c4c4]">
              <li>#plan, #findings, and #decisions stay on one board — not eight chats</li>
              <li>Budget, deadline, and cycle cap. Not a blank check</li>
              <li>Approve before they write code. The report lands on the swarm</li>
            </ul>
          </div>
        </Reveal>
        <Reveal delay={80} className="mt-10">
          <SwarmShowcase />
        </Reveal>
      </div>
    </section>
  );
}
