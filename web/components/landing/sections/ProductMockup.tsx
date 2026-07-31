import { Circle, GitBranch, Radio, Users } from "lucide-react";
import Reveal from "../Reveal";

const DIFF_LINES = [
  { type: "ctx", text: "  function handleSteer(prompt, agentId) {" },
  { type: "del", text: "-   sendToActiveAgent(prompt);" },
  { type: "add", text: "+   sendToAgent(agentId, prompt, { attributedTo: user.id });" },
  { type: "add", text: "+   room.emit('steer', { agentId, prompt, user });" },
  { type: "ctx", text: "  }" },
] as const;

function DiffPanel() {
  return (
    <div className="rounded-2xl border border-[#2b2b2b] bg-[#1a1a1a] overflow-hidden">
      <div className="flex items-center gap-2 border-b border-[#2b2b2b] bg-[#1e1e1e] px-4 py-2.5">
        <GitBranch className="w-3.5 h-3.5 text-[#6e6e6e]" strokeWidth={1.75} />
        <span className="text-[11px] font-medium text-[#a0a0a0] landing-mono">
          server/room/steer.ts
        </span>
        <span className="ml-auto text-[10px] font-medium text-[#3ecf8e]">+2</span>
        <span className="text-[10px] font-medium text-[#f07070]">-1</span>
      </div>
      <div className="px-4 py-3 font-mono text-[11.5px] leading-[1.9]">
        {DIFF_LINES.map((line, i) => (
          <div
            key={i}
            className={`landing-diff-line whitespace-pre ${
              line.type === "add"
                ? "text-[#3ecf8e] bg-[#3ecf8e]/[0.08]"
                : line.type === "del"
                  ? "text-[#f07070] bg-[#f07070]/[0.08]"
                  : "text-[#6e6e6e]"
            } -mx-4 px-4`}
            style={{ animationDelay: `${i * 90}ms` }}
          >
            {line.text}
          </div>
        ))}
      </div>
    </div>
  );
}

function ChatPanel() {
  return (
    <div className="rounded-2xl border border-[#2b2b2b] bg-[#1a1a1a] overflow-hidden flex flex-col">
      <div className="flex items-center gap-2 border-b border-[#2b2b2b] bg-[#1e1e1e] px-4 py-2.5">
        <Radio className="w-3.5 h-3.5 text-[#3ecf8e]" strokeWidth={2} />
        <span className="text-[11px] font-medium text-[#a0a0a0]">Room chat</span>
        <div className="ml-auto flex items-center -space-x-1.5">
          {["A", "J", "M"].map((initial) => (
            <span
              key={initial}
              className="flex h-5 w-5 items-center justify-center rounded-full border-2 border-[#1e1e1e] bg-[#252525] text-[9px] font-semibold text-[#e4e4e4]"
            >
              {initial}
            </span>
          ))}
        </div>
      </div>
      <div className="flex-1 space-y-3 px-4 py-4">
        <div>
          <div className="flex items-center gap-2 text-[11px]">
            <span className="font-semibold text-[#4d9fff]">Ava</span>
            <span className="text-[#6e6e6e]">→ Cursor</span>
          </div>
          <p className="mt-1 text-[12.5px] leading-relaxed text-[#e4e4e4]/90">
            Attribute every steering prompt to the sender before it reaches the socket layer.
          </p>
        </div>
        <div className="rounded-xl bg-[#252525] px-3 py-2.5">
          <div className="flex items-center gap-2 text-[11px]">
            <span className="font-semibold text-[#e4e4e4]">Cursor agent</span>
            <span className="inline-flex items-center gap-1 rounded-full bg-[#3ecf8e]/15 px-1.5 py-0.5 text-[10px] font-medium text-[#3ecf8e]">
              editing
            </span>
          </div>
          <p className="mt-1.5 text-[12.5px] leading-relaxed text-[#a0a0a0]">
            Updating <code className="text-[#e4e4e4] landing-mono">server/room/steer.ts</code> to
            pass attribution through the emit payload.
          </p>
          <div className="mt-2 flex items-center gap-1">
            <span className="landing-typing-dot h-1.5 w-1.5 rounded-full bg-[#6e6e6e]" />
            <span className="landing-typing-dot h-1.5 w-1.5 rounded-full bg-[#6e6e6e]" style={{ animationDelay: "0.15s" }} />
            <span className="landing-typing-dot h-1.5 w-1.5 rounded-full bg-[#6e6e6e]" style={{ animationDelay: "0.3s" }} />
          </div>
        </div>
        <div>
          <div className="flex items-center gap-2 text-[11px]">
            <span className="font-semibold text-[#f0a850]">Jae</span>
            <span className="text-[#6e6e6e]">→ Claude Code</span>
          </div>
          <p className="mt-1 text-[12.5px] leading-relaxed text-[#e4e4e4]/90">
            Add a test for the emit payload while Ava&rsquo;s change lands.
          </p>
        </div>
      </div>
      <div className="border-t border-[#2b2b2b] px-4 py-3">
        <div className="flex items-center gap-2 rounded-full border border-[#3c3c3c] bg-[#141414] px-3.5 py-2 text-[12px] text-[#6e6e6e]">
          <span>Message any agent…</span>
          <span className="landing-caret text-[#e4e4e4]">|</span>
        </div>
      </div>
    </div>
  );
}

export default function ProductMockup() {
  return (
    <section className="border-t border-[#191919]/08 bg-white">
      <div className="mx-auto max-w-6xl px-5 sm:px-8 py-20 sm:py-28">
        <Reveal>
          <div className="max-w-xl">
            <p className="text-[11px] sm:text-[12px] font-medium tracking-[0.16em] uppercase text-[#191919]/45">
              Inside a room
            </p>
            <h2 className="mt-3 landing-serif text-[32px] sm:text-[40px] leading-[1.12] tracking-tight">
              One surface for chat, diffs, and control
            </h2>
            <p className="mt-4 text-[15px] leading-relaxed text-[#191919]/65 font-light">
              This is what a live session actually looks like — not a mockup of a mockup. Attributed
              messages, streaming diffs, and driver control, all in the same room.
            </p>
          </div>
        </Reveal>

        <Reveal delay={100} variant="scale">
          <div className="landing-mockup-float mt-14 sm:mt-16 rounded-[1.75rem] border border-[#191919]/10 bg-white p-2.5 sm:p-3 shadow-[0_40px_100px_rgba(25,25,25,0.12)]">
            <div className="rounded-[1.4rem] bg-[#141414] p-3 sm:p-5">
              <div className="flex items-center gap-3 px-1.5 pb-3 sm:pb-4">
                <div className="flex items-center gap-1.5">
                  <Circle className="w-2.5 h-2.5 fill-[#3c3c3c] text-[#3c3c3c]" />
                  <Circle className="w-2.5 h-2.5 fill-[#3c3c3c] text-[#3c3c3c]" />
                  <Circle className="w-2.5 h-2.5 fill-[#3c3c3c] text-[#3c3c3c]" />
                </div>
                <div className="flex-1 rounded-full bg-[#1e1e1e] px-3 py-1 text-center text-[11px] text-[#6e6e6e] landing-mono">
                  steer.app/room/agentic-launch
                </div>
                <div className="hidden sm:flex items-center gap-1.5 rounded-full bg-[#1e1e1e] px-2.5 py-1 text-[10px] font-medium text-[#a0a0a0]">
                  <Users className="w-3 h-3" />
                  3 watching
                </div>
              </div>

              <div className="flex items-center gap-2 px-1.5 pb-3">
                <span className="rounded-full bg-[#252525] px-3 py-1 text-[11px] font-medium text-[#e4e4e4]">
                  Cursor
                </span>
                <span className="rounded-full px-3 py-1 text-[11px] font-medium text-[#6e6e6e]">
                  Claude Code
                </span>
                <span className="ml-auto rounded-full border border-[#3c3c3c] px-2.5 py-1 text-[10px] font-medium text-[#a0a0a0]">
                  Driver: Ava
                </span>
              </div>

              <div className="grid gap-3 sm:gap-4 md:grid-cols-2">
                <ChatPanel />
                <DiffPanel />
              </div>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
