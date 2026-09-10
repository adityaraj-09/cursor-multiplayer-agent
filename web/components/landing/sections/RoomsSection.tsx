import Reveal from "../Reveal";
import MultiplayerRoomView from "../mock/MultiplayerRoomView";

export default function RoomsSection() {
  return (
    <section id="rooms" className="border-t border-white/[0.06] bg-[#101010]">
      <div className="mx-auto max-w-6xl px-5 py-20 sm:px-8 sm:py-28">
        <div className="grid items-center gap-12 md:grid-cols-12 md:gap-14">
          <Reveal variant="left" className="md:col-span-5">
            <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-[#6e6e6e]">
              Multiplayer
            </p>
            <h2 className="landing-serif mt-3 text-[32px] leading-[1.12] tracking-tight text-white sm:text-[40px]">
              The whole team, in one room.
            </h2>
            <p className="mt-4 max-w-md text-[15px] font-light leading-relaxed text-[#a0a0a0]">
              Steer is multiplayer from the first message. Jules steers Startup
              sync. Maya picks up Stale banner. Karri jumps in mid-thread. Andreas
              arrives later and the chat is already the brief. Nobody is watching
              a laptop over someone&apos;s shoulder.
            </p>
            <ul className="mt-6 space-y-2.5 text-[14px] leading-relaxed text-[#c4c4c4]">
              <li>Four people can sit in the same session and talk at once</li>
              <li>Every steer carries a name, so the room knows who asked</li>
              <li>Approvals land in the timeline — Maya can clear what Jules can&apos;t</li>
              <li>Startup sync and Stale banner keep their own threads, in one place</li>
            </ul>
          </Reveal>
          <Reveal variant="right" delay={80} className="md:col-span-7">
            <MultiplayerRoomView />
          </Reveal>
        </div>
      </div>
    </section>
  );
}
