"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "../../../components/AuthProvider";
import { joinViaInvite } from "../../../lib/api";

export default function InvitePage() {
  const params = useParams<{ code: string }>();
  const code = Array.isArray(params.code) ? params.code[0] : params.code;
  const router = useRouter();
  const { user, loading } = useAuth();
  const [status, setStatus] = useState<"loading" | "error" | "success">(
    "loading",
  );
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

  const retry = useCallback(() => {
    setError("");
    setStatus("loading");
    setAttempt((n) => n + 1);
  }, []);

  useEffect(() => {
    if (loading) return;
    if (!code) {
      setError("Invalid invite link");
      setStatus("error");
      return;
    }
    if (!user) {
      router.replace(
        `/login?redirect=${encodeURIComponent(`/invite/${code}`)}`,
      );
      return;
    }

    let cancelled = false;
    setStatus("loading");
    setError("");

    joinViaInvite(code)
      .then(({ roomId }) => {
        if (cancelled) return;
        setStatus("success");
        router.replace(`/room/${roomId}`);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to join");
        setStatus("error");
      });

    return () => {
      cancelled = true;
    };
  }, [code, user, loading, router, attempt]);

  return (
    <div className="min-h-screen bg-[#141414] flex items-center justify-center px-4">
      <div className="text-center">
        {status === "loading" && (
          <p className="text-[#a0a0a0] text-[14px]">Joining session…</p>
        )}
        {status === "error" && (
          <>
            <p className="text-[#f07070] text-[14px] mb-4">{error}</p>
            <div className="flex flex-col sm:flex-row gap-3 items-center justify-center">
              <button
                type="button"
                onClick={retry}
                className="h-8 px-3 rounded-md text-[13px] text-[#e4e4e4] border border-[#2b2b2b] hover:border-[#3c3c3c]"
              >
                Try again
              </button>
              <Link
                href="/dashboard"
                className="text-[13px] text-[#4d9fff] hover:underline"
              >
                Back to dashboard
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
