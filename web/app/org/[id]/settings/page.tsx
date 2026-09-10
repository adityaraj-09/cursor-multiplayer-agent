"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { writeSelectedWorkspace } from "../../../../lib/workspace";

export default function OrgSettingsRedirectPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const orgId = Array.isArray(params.id) ? params.id[0] : params.id;

  useEffect(() => {
    if (!orgId) {
      router.replace("/settings");
      return;
    }
    writeSelectedWorkspace(orgId);
    router.replace(`/settings?org=${encodeURIComponent(orgId)}`);
  }, [orgId, router]);

  return (
    <div className="min-h-screen bg-[#141414] flex items-center justify-center">
      <p className="text-[13px] text-[#6e6e6e]">Opening workspace settings…</p>
    </div>
  );
}
