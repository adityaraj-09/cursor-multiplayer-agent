import { Bot, Cloud, GitFork, Sparkles, TerminalSquare, Zap } from "lucide-react";

const ITEMS = [
  { label: "Cursor", icon: Sparkles },
  { label: "Claude Code", icon: Bot },
  { label: "GitHub", icon: GitFork },
  { label: "Cursor Cloud", icon: Cloud },
  { label: "E2B sandboxes", icon: Zap },
  { label: "Local CLI", icon: TerminalSquare },
] as const;

function LogoRow({ ariaHidden = false }: { ariaHidden?: boolean }) {
  return (
    <div className="flex shrink-0 items-center" aria-hidden={ariaHidden}>
      {ITEMS.map(({ label, icon: Icon }) => (
        <div
          key={label}
          className="flex items-center gap-2.5 pr-14 text-[#191919]/45"
        >
          <Icon className="w-[18px] h-[18px]" strokeWidth={1.75} />
          <span className="landing-serif text-[17px] sm:text-[19px] tracking-tight whitespace-nowrap">
            {label}
          </span>
        </div>
      ))}
    </div>
  );
}

export default function LogoStrip() {
  return (
    <section className="border-t border-[#191919]/08 bg-white">
      <div className="mx-auto max-w-6xl px-5 sm:px-8 py-8 sm:py-10">
        <p className="text-center text-[11px] font-medium tracking-[0.16em] uppercase text-[#191919]/35 mb-6">
          Built around the tools you already run
        </p>
      </div>
      <div className="relative overflow-hidden pb-8 sm:pb-10">
        <div className="pointer-events-none absolute inset-y-0 left-0 w-16 sm:w-28 bg-gradient-to-r from-white to-transparent z-10" />
        <div className="pointer-events-none absolute inset-y-0 right-0 w-16 sm:w-28 bg-gradient-to-l from-white to-transparent z-10" />
        <div className="landing-marquee">
          <LogoRow />
          <LogoRow ariaHidden />
        </div>
      </div>
    </section>
  );
}
