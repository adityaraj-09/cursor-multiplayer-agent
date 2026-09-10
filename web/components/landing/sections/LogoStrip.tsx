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
          className="flex items-center gap-2.5 pr-14 text-white/35"
        >
          <Icon className="h-[18px] w-[18px]" strokeWidth={1.75} />
          <span className="landing-serif whitespace-nowrap text-[17px] tracking-tight sm:text-[19px]">
            {label}
          </span>
        </div>
      ))}
    </div>
  );
}

export default function LogoStrip() {
  return (
    <section className="border-t border-white/[0.06] bg-[#0b0b0b]">
      <div className="mx-auto max-w-6xl px-5 py-8 sm:px-8 sm:py-10">
        <p className="mb-6 text-center text-[11px] font-medium uppercase tracking-[0.16em] text-[#6e6e6e]">
          Built around the tools you already run
        </p>
      </div>
      <div className="relative overflow-hidden pb-8 sm:pb-10">
        <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-16 bg-gradient-to-r from-[#0b0b0b] to-transparent sm:w-28" />
        <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-16 bg-gradient-to-l from-[#0b0b0b] to-transparent sm:w-28" />
        <div className="landing-marquee">
          <LogoRow />
          <LogoRow ariaHidden />
        </div>
      </div>
    </section>
  );
}
