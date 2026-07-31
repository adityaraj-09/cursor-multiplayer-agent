import Reveal from "../Reveal";
import { RoomDiagram } from "../diagrams";

export default function IdeaSection() {
  return (
    <section className="border-t border-[#191919]/08">
      <div className="mx-auto max-w-6xl px-5 sm:px-8 py-20 sm:py-28 grid md:grid-cols-12 gap-10 md:gap-14 items-center">
        <Reveal variant="left" className="md:col-span-5">
          <p className="text-[11px] sm:text-[12px] font-medium tracking-[0.16em] uppercase text-[#191919]/45">
            The idea
          </p>
          <p className="mt-4 landing-serif text-[28px] sm:text-[40px] md:text-[44px] leading-[1.2] tracking-tight text-[#191919]">
            Agent work is better when it isn&rsquo;t solitary.
          </p>
          <p className="mt-5 text-[15px] leading-relaxed text-[#191919]/65 font-light">
            Steer turns Cursor and Claude Code into a shared room — multiple agents, presence,
            attribution, diffs, and control in one place.
          </p>
        </Reveal>
        <Reveal variant="right" delay={80} className="md:col-span-7">
          <RoomDiagram />
        </Reveal>
      </div>
    </section>
  );
}
