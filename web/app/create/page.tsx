"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export default function CreateSessionRedirectPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[#141414] flex items-center justify-center">
          <p className="text-[13px] text-[#6e6e6e]">Opening composer…</p>
        </div>
      }
    >
      <RedirectToCompose />
    </Suspense>
  );
}

function RedirectToCompose() {
  const router = useRouter();
  const search = useSearchParams();

  useEffect(() => {
    const org = search.get("org");
    const params = new URLSearchParams({ compose: "1" });
    if (org && org !== "personal") params.set("org", org);
    router.replace(`/dashboard?${params.toString()}`);
  }, [router, search]);

  return (
    <div className="min-h-screen bg-[#141414] flex items-center justify-center">
      <p className="text-[13px] text-[#6e6e6e]">Opening composer…</p>
    </div>
  );
}
