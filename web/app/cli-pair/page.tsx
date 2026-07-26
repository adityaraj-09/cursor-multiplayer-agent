"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { SignInButton } from "@clerk/nextjs";
import { useAuth } from "../../components/AuthProvider";
import { createPairingCode } from "../../lib/api";

export default function CliPairPage() {
  const { user, loading } = useAuth();
  const [code, setCode] = useState("");
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const generate = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const result = await createPairingCode();
      setCode(result.code);
      setExpiresAt(result.expiresAt);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create code");
    } finally {
      setBusy(false);
    }
  }, []);

  return (
    <div className="min-h-screen bg-[#141414] flex items-center justify-center px-4">
      <div className="w-full max-w-md border border-[#2b2b2b] rounded-lg bg-[#1a1a1a] p-6">
        <h1 className="text-[18px] font-medium text-[#e4e4e4] mb-1">
          Pair CLI
        </h1>
        <p className="text-[13px] text-[#6e6e6e] mb-6">
          Generate a one-time code, then run{" "}
          <code className="text-[#a0a0a0]">steer login</code> on your machine.
        </p>

        {loading ? (
          <p className="text-[13px] text-[#6e6e6e]">Loading…</p>
        ) : !user ? (
          <>
            <p className="text-[13px] text-[#a0a0a0] mb-4">
              Sign in to create a pairing code.
            </p>
            <SignInButton mode="modal">
              <button className="h-9 px-4 rounded-md bg-[#e4e4e4] text-[#141414] text-[13px] font-medium hover:bg-white transition-colors">
                Sign in
              </button>
            </SignInButton>
          </>
        ) : (
          <>
            <p className="text-[12px] text-[#6e6e6e] mb-4">
              Signed in as {user.email}
            </p>

            {code ? (
              <div className="mb-4">
                <p className="text-[11px] text-[#6e6e6e] mb-2 uppercase tracking-wide">
                  Pairing code
                </p>
                <div className="font-mono text-[28px] tracking-[0.2em] text-[#e4e4e4] text-center py-4 rounded-md bg-[#252525] border border-[#2b2b2b]">
                  {code}
                </div>
                {expiresAt && (
                  <p className="text-[11px] text-[#6e6e6e] mt-2 text-center">
                    Expires in ~10 minutes
                  </p>
                )}
              </div>
            ) : null}

            {error && (
              <p className="text-[12px] text-[#f07070] mb-3">{error}</p>
            )}

            <button
              type="button"
              onClick={() => void generate()}
              disabled={busy}
              className="w-full h-9 rounded-md bg-[#e4e4e4] text-[#141414] text-[13px] font-medium hover:bg-white transition-colors disabled:opacity-50"
            >
              {busy
                ? "Generating…"
                : code
                  ? "Generate new code"
                  : "Generate pairing code"}
            </button>

            <pre className="mt-5 text-[11px] text-[#6e6e6e] bg-[#121212] rounded-md p-3 overflow-x-auto whitespace-pre-wrap">
{`npm i -g @oblivihon/steer
steer login
# Server URL: http://localhost:3000
# Pairing code: ${code || "XXXX-XXXX"}
steer start`}
            </pre>
          </>
        )}

        <p className="text-center text-[12px] text-[#6e6e6e] mt-6">
          <Link href="/" className="hover:text-[#a0a0a0] transition-colors">
            Back to dashboard
          </Link>
        </p>
      </div>
    </div>
  );
}
