import Image from "next/image";
import Reveal from "../Reveal";

export default function RuntimesSection() {
  return (
    <section className="border-t border-[#191919]/08 bg-[#FAFAF8]">
      <div className="mx-auto max-w-6xl px-5 sm:px-8 py-20 sm:py-28">
        <div className="md:grid md:grid-cols-12 md:gap-16 items-center">
          <Reveal variant="left" className="md:col-span-5">
            <p className="text-[11px] sm:text-[12px] font-medium tracking-[0.16em] uppercase text-[#191919]/45">
              Runtimes
            </p>
            <h2 className="mt-3 landing-serif text-[32px] sm:text-[40px] leading-[1.12] tracking-tight">
              Local when you need the machine. Cloud when you need reach.
            </h2>
          </Reveal>
          <Reveal variant="right" delay={80} className="mt-10 md:mt-0 md:col-span-7">
            <div className="overflow-hidden rounded-[2rem] border border-[#191919]/10 bg-white p-4 sm:p-6 shadow-[0_20px_70px_rgba(25,25,25,0.06)]">
              <Image
                src="/images/runtime-illustration.webp"
                alt="Diagram of a local laptop and a cloud server both feeding into one shared Steer session"
                width={1400}
                height={933}
                className="w-full h-auto"
              />
            </div>
          </Reveal>
        </div>

        <div className="mt-12 grid gap-10 sm:grid-cols-2">
          <Reveal>
            <div className="h-full rounded-[1.5rem] border border-[#191919]/10 bg-white p-7 sm:p-8">
              <h3 className="landing-serif text-[22px] sm:text-[24px] tracking-tight">
                Local + CLI
              </h3>
              <p className="mt-3 text-[15px] leading-relaxed text-[#191919]/65 font-light">
                Pair once, keep{" "}
                <code className="landing-mono text-[13px] text-[#191919]">steer start</code>{" "}
                running, and relay prompts to Cursor or Claude Code on your laptop — against any
                folder you choose.
              </p>
            </div>
          </Reveal>
          <Reveal delay={80}>
            <div className="h-full rounded-[1.5rem] border border-[#191919]/10 bg-white p-7 sm:p-8">
              <h3 className="landing-serif text-[22px] sm:text-[24px] tracking-tight">
                Cloud agents
              </h3>
              <p className="mt-3 text-[15px] leading-relaxed text-[#191919]/65 font-light">
                Cursor Cloud or Claude Code in E2B — point agents at a GitHub repo, stream progress
                into the room, and keep collaborators in lockstep.
              </p>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
