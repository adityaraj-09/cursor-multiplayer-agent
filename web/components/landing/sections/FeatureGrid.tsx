import Reveal from "../Reveal";
import {
  AgentsDiagram,
  DiffDiagram,
  HandoffDiagram,
  HistoryDiagram,
  RedirectDiagram,
  WatchDiagram,
} from "./FeatureDiagrams";

const FEATURES = [
  {
    title: "Many agents, one room",
    body: "Each workstream keeps its own model and chat. They still sit in the same session.",
    Diagram: AgentsDiagram,
  },
  {
    title: "Watch together",
    body: "Four people see the same tools, diffs, and replies — not a share of one laptop.",
    Diagram: WatchDiagram,
  },
  {
    title: "Redirect freely",
    body: "Anyone can message any agent. The name stays on the steer, so the room stays clear.",
    Diagram: RedirectDiagram,
  },
  {
    title: "Hand off control",
    body: "Pass the driver seat without leaving. Context stays. The next person just drives.",
    Diagram: HandoffDiagram,
  },
  {
    title: "Live diff stream",
    body: "File changes land in the room as they happen — red and green, while people watch.",
    Diagram: DiffDiagram,
  },
  {
    title: "Durable history",
    body: "Join mid-session and the thread is already the brief: who asked, what changed, who approved.",
    Diagram: HistoryDiagram,
  },
];

export default function FeatureGrid() {
  return (
    <section id="product" className="border-t border-white/[0.06] bg-[#0f0f0f]">
      <div className="mx-auto max-w-6xl px-5 py-20 sm:px-8 sm:py-28">
        <Reveal>
          <div className="max-w-xl">
            <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-[#6e6e6e] sm:text-[12px]">
              Rooms
            </p>
            <h2 className="landing-serif mt-3 text-[32px] leading-[1.12] tracking-tight text-white sm:text-[40px]">
              Everything the room needs. Nothing it doesn&rsquo;t.
            </h2>
            <p className="mt-4 max-w-md text-[15px] font-light leading-relaxed text-[#a0a0a0]">
              Research, plan, write, execute — one shared surface instead of four
              disconnected tabs.
            </p>
          </div>
        </Reveal>

        <div className="mt-14 grid gap-4 sm:mt-16 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(({ title, body, Diagram }, i) => (
            <Reveal key={title} delay={(i % 3) * 70}>
              <div className="landing-card h-full min-w-0 rounded-2xl border border-white/[0.06] bg-[#161616] p-4 sm:p-5">
                <Diagram />
                <h3 className="landing-serif text-[20px] tracking-tight text-white sm:text-[21px]">
                  {title}
                </h3>
                <p className="mt-2 text-[13px] font-light leading-relaxed text-[#a0a0a0] sm:text-[14px]">
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
