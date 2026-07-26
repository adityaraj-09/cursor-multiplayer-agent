"use client";

import { SignIn } from "@clerk/nextjs";
import Link from "next/link";

export default function LoginPage() {
  return (
    <div className="min-h-screen bg-[#141414] flex items-center justify-center px-4">
      <div className="w-full max-w-md flex flex-col items-center gap-6">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-[6px] bg-[#e4e4e4] flex items-center justify-center">
            <span className="text-[#141414] text-[14px] font-semibold">S</span>
          </div>
          <span className="text-[18px] font-medium text-[#e4e4e4]">Steer</span>
        </div>

        <SignIn
          routing="hash"
          fallbackRedirectUrl="/"
          signUpUrl="/login"
          appearance={{
            elements: {
              rootBox: "w-full",
              card: "bg-[#1a1a1a] border border-[#2b2b2b] shadow-none",
            },
          }}
        />

        <Link
          href="/"
          className="text-[12px] text-[#6e6e6e] hover:text-[#a0a0a0] transition-colors"
        >
          Back to dashboard
        </Link>
      </div>
    </div>
  );
}
