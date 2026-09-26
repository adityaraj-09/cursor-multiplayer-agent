"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

const AUTH_VIDEO_URL =
  "https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260514_135830_bb6491d1-9b66-4aec-9722-13b4dfe3fb46.mp4";

export default function AuthSplitLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-black text-white md:grid md:grid-cols-2">
      <aside className="relative hidden min-h-dvh overflow-hidden md:block">
        <video
          className="absolute inset-0 h-full w-full object-cover"
          src={AUTH_VIDEO_URL}
          autoPlay
          muted
          loop
          playsInline
          preload="metadata"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black via-black/25 to-black/50" />
        <div className="relative z-10 flex h-full min-h-dvh flex-col justify-between px-8 py-7 xl:px-10">
          <Link href="/" className="inline-flex items-center gap-2.5 w-fit">
            <span className="flex h-7 w-7 items-center justify-center rounded-[6px] bg-white text-[12px] font-semibold text-black">
              S
            </span>
            <span className="text-[18px] font-medium tracking-tight">Steer</span>
          </Link>
          <blockquote className="max-w-md pb-4">
            <p className="text-[17px] font-light leading-relaxed text-white/90">
              “The room stays live. Teammates watch every tool call, steer
              mid-flight, and the agent keeps going after you walk away.”
            </p>
            <footer className="mt-4 text-[13px] text-white/45">
              — Multiplayer Cursor &amp; Claude sessions
            </footer>
          </blockquote>
        </div>
      </aside>

      <section className="relative flex min-h-dvh flex-col overflow-y-auto px-5 py-5 sm:px-10">
        <div className="flex items-center justify-between">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-[13px] text-white/55 transition-colors hover:text-white"
          >
            <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.75} />
            Home
          </Link>
          <Link href="/" className="inline-flex items-center gap-2 md:hidden">
            <span className="flex h-6 w-6 items-center justify-center rounded-[5px] bg-white text-[11px] font-semibold text-black">
              S
            </span>
            <span className="text-[15px] font-medium">Steer</span>
          </Link>
        </div>

        <div className="mx-auto my-auto w-full max-w-[400px] py-10">
          {children}
        </div>
      </section>
    </div>
  );
}
