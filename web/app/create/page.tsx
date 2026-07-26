"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createRoom } from "../../lib/api";

export default function CreateSession() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [repoPath, setRepoPath] = useState("");
  const [agentCommand, setAgentCommand] = useState(
    "cursor agent --force --trust",
  );
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError("Session name is required");
      return;
    }

    setCreating(true);
    setError("");

    try {
      const room = await createRoom({
        name: name.trim(),
        repoPath: repoPath.trim() || undefined,
        agentCommand: agentCommand.trim() || undefined,
      });
      router.push(`/room/${room.id}`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to create session");
      setCreating(false);
    }
  };

  const inputClass =
    "w-full h-10 px-3 bg-[#252525] border border-[#2b2b2b] rounded-md text-[13px] text-[#e4e4e4] placeholder:text-[#6e6e6e] outline-none focus:border-[#4d9fff] transition-colors";

  return (
    <div className="min-h-screen bg-[#141414]">
      <header className="border-b border-[#2b2b2b]">
        <div className="max-w-xl mx-auto px-6 h-14 flex items-center gap-3">
          <Link
            href="/"
            className="text-[13px] text-[#6e6e6e] hover:text-[#e4e4e4] transition-colors"
          >
            ← Sessions
          </Link>
          <span className="text-[#2b2b2b]">/</span>
          <span className="text-[13px] text-[#e4e4e4]">New session</span>
        </div>
      </header>

      <main className="max-w-xl mx-auto px-6 py-10">
        <h1 className="text-[22px] font-medium tracking-tight mb-1">
          Create session
        </h1>
        <p className="text-[13px] text-[#6e6e6e] mb-8">
          Start a Cursor Agent in a local repo and share the room.
        </p>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-[12px] text-[#a0a0a0] mb-1.5">
              Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Fix login bugs"
              className={inputClass}
              autoFocus
            />
          </div>

          <div>
            <label className="block text-[12px] text-[#a0a0a0] mb-1.5">
              Repository path
            </label>
            <input
              type="text"
              value={repoPath}
              onChange={(e) => setRepoPath(e.target.value)}
              placeholder="./demo-repo"
              className={`${inputClass} font-mono`}
            />
            <p className="text-[11px] text-[#6e6e6e] mt-1.5">
              Defaults to the demo repo if left empty.
            </p>
          </div>

          <div>
            <label className="block text-[12px] text-[#a0a0a0] mb-1.5">
              Agent command
            </label>
            <input
              type="text"
              value={agentCommand}
              onChange={(e) => setAgentCommand(e.target.value)}
              className={`${inputClass} font-mono`}
            />
          </div>

          {error && (
            <div className="px-3 py-2.5 rounded-md bg-[rgba(240,112,112,0.1)] border border-[rgba(240,112,112,0.25)] text-[#f07070] text-[13px]">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={creating}
            className="h-9 px-4 rounded-md bg-[#e4e4e4] text-[#141414] text-[13px] font-medium hover:bg-white disabled:opacity-40 transition-colors"
          >
            {creating ? "Starting…" : "Create session"}
          </button>
        </form>
      </main>
    </div>
  );
}
