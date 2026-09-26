"use client";

import { Suspense } from "react";
import { SignUp } from "@clerk/nextjs";
import { useSearchParams } from "next/navigation";
import AuthSplitLayout from "../../components/auth/AuthSplitLayout";
import { authClerkAppearance } from "../../lib/authClerkAppearance";

function SignupPageInner() {
  const searchParams = useSearchParams();
  const redirect = searchParams.get("redirect") || "/dashboard";
  const qs =
    redirect !== "/dashboard"
      ? `?redirect=${encodeURIComponent(redirect)}`
      : "";
  const onboardingUrl = `/onboarding?redirect=${encodeURIComponent(redirect)}`;

  return (
    <AuthSplitLayout>
      <SignUp
        routing="hash"
        fallbackRedirectUrl={onboardingUrl}
        signInUrl={`/login${qs}`}
        appearance={authClerkAppearance}
      />
    </AuthSplitLayout>
  );
}

export default function SignupPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-dvh bg-black flex items-center justify-center text-[13px] text-white/40">
          Loading…
        </div>
      }
    >
      <SignupPageInner />
    </Suspense>
  );
}
