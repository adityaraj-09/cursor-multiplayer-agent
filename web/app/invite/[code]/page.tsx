"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "../../../components/AuthProvider";
import { joinViaInvite } from "../../../lib/api";

export default function InvitePage() {
  const { code } = useParams<{ code: string }>();
  const router = useRouter();
  const { user, loading } = useAuth();
  const [status, setStatus] = useState<"loading" | "error" | "success">("loading");
  const [error, setError] = useState("");

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.push(`/login?redirect=/invite/${code}`);
      return;
    }
    joinViaInvite(code)
      .then(({ roomId }) => {
        setStatus("success");
        router.push(`/room/${roomId}`);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Failed to join");
        setStatus("error");
      });
  }, [code, user, loading, router]);

  return (
    <div className="min-h-screen bg-[#141414] flex items-center justify-center px-4">
      <div className="text-center">
        {status === "loading" && (
          <p className="text-[#a0a0a0] text-[14px]">Joining session…</p>
        )}
        {status === "error" && (
          <>
            <p className="text-[#f07070] text-[14px] mb-4">{error}</p>
            <Link
              href="/"
              className="text-[13px] text-[#4d9fff] hover:underline"
            >
              Back to dashboard
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
