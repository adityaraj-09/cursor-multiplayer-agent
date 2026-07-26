"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "../../components/AuthProvider";

export default function LoginPage() {
  const router = useRouter();
  const { login, register } = useAuth();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      if (mode === "register") {
        await register(email, name, password);
      } else {
        await login(email, password);
      }
      router.push("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#141414] flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-3 mb-8 justify-center">
          <div className="w-8 h-8 rounded-[6px] bg-[#e4e4e4] flex items-center justify-center">
            <span className="text-[#141414] text-[14px] font-semibold">S</span>
          </div>
          <span className="text-[18px] font-medium text-[#e4e4e4]">
            Shared Agent
          </span>
        </div>

        <div className="border border-[#2b2b2b] rounded-lg bg-[#1a1a1a] p-6">
          <div className="flex gap-2 mb-6">
            <button
              type="button"
              onClick={() => setMode("login")}
              className={`flex-1 h-8 rounded-md text-[13px] font-medium transition-colors ${
                mode === "login"
                  ? "bg-[#252525] text-[#e4e4e4] border border-[#3c3c3c]"
                  : "text-[#6e6e6e] hover:text-[#a0a0a0]"
              }`}
            >
              Sign in
            </button>
            <button
              type="button"
              onClick={() => setMode("register")}
              className={`flex-1 h-8 rounded-md text-[13px] font-medium transition-colors ${
                mode === "register"
                  ? "bg-[#252525] text-[#e4e4e4] border border-[#3c3c3c]"
                  : "text-[#6e6e6e] hover:text-[#a0a0a0]"
              }`}
            >
              Register
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-[12px] text-[#a0a0a0] mb-1.5">
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full h-9 px-3 rounded-md bg-[#252525] border border-[#2b2b2b] text-[13px] text-[#e4e4e4] outline-none focus:border-[#4d9fff] transition-colors"
              />
            </div>

            {mode === "register" && (
              <div>
                <label className="block text-[12px] text-[#a0a0a0] mb-1.5">
                  Name
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  className="w-full h-9 px-3 rounded-md bg-[#252525] border border-[#2b2b2b] text-[13px] text-[#e4e4e4] outline-none focus:border-[#4d9fff] transition-colors"
                />
              </div>
            )}

            <div>
              <label className="block text-[12px] text-[#a0a0a0] mb-1.5">
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                className="w-full h-9 px-3 rounded-md bg-[#252525] border border-[#2b2b2b] text-[13px] text-[#e4e4e4] outline-none focus:border-[#4d9fff] transition-colors"
              />
            </div>

            {error && (
              <p className="text-[12px] text-[#f07070]">{error}</p>
            )}

            <button
              type="submit"
              disabled={busy}
              className="w-full h-9 rounded-md bg-[#e4e4e4] text-[#141414] text-[13px] font-medium hover:bg-white transition-colors disabled:opacity-50"
            >
              {busy
                ? "Please wait…"
                : mode === "login"
                  ? "Sign in"
                  : "Create account"}
            </button>
          </form>
        </div>

        <p className="text-center text-[12px] text-[#6e6e6e] mt-4">
          <Link href="/" className="hover:text-[#a0a0a0] transition-colors">
            Back to dashboard
          </Link>
        </p>
      </div>
    </div>
  );
}
