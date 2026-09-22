"use client";

import { useMemo, useState } from "react";
import { Send } from "lucide-react";
import Markdown from "../Markdown";
import { postSwarmDirective, type SwarmAgentInfo, type SwarmPostInfo } from "../../lib/api";
import { RoleBadge, relativeTime } from "./swarmUi";

const CHANNELS = [
  { key: "all", label: "All" },
  { key: "plan", label: "#plan" },
  { key: "findings", label: "#findings" },
  { key: "questions", label: "#questions" },
  { key: "decisions", label: "#decisions" },
  { key: "tasks", label: "Task threads" },
] as const;

const KIND_TONE: Record<string, string> = {
  directive: "text-[#f0c674]",
  decision: "text-[#f0c674]",
  finding: "text-[#8ec5ff]",
  proposal: "text-[#7ee2c4]",
  critique: "text-[#f59e9e]",
  question: "text-[#e6c07b]",
  answer: "text-[#a0a0a0]",
  progress: "text-[#6e6e6e]",
};

function PostCard({ post, agents }: { post: SwarmPostInfo; agents: SwarmAgentInfo[] }) {
  const [expanded, setExpanded] = useState(false);
  const long = post.bodyMd.length > 900;
  const mentioned = post.mentions
    .map((id) => agents.find((a) => a.id === id)?.label)
    .filter(Boolean) as string[];
  return (
    <article className="rounded-lg border border-[#232323] bg-[#171717] px-3.5 py-3">
      <header className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
        <RoleBadge role={post.authorRole} />
        <span className="font-medium text-[#e4e4e4]">
          {post.authorRole === "human" || post.authorRole === "system" ? post.authorLabel : `@${post.authorLabel}`}
        </span>
        <span className={`font-medium ${KIND_TONE[post.kind] ?? "text-[#a0a0a0]"}`}>{post.kind}</span>
        <span className="text-[#4a4a4a]">in</span>
        <span className="text-[#6e6e6e]">#{post.channel}</span>
        {mentioned.length > 0 && <span className="text-[#6e6e6e]">→ {mentioned.map((m) => `@${m}`).join(" ")}</span>}
        <span className="ml-auto text-[#555]" title={new Date(post.createdAt).toLocaleString()}>
          {relativeTime(post.createdAt)}
        </span>
      </header>
      <div className={long && !expanded ? "relative max-h-48 overflow-hidden" : ""}>
        <Markdown content={post.bodyMd} />
        {long && !expanded && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-[#171717] to-transparent" />
        )}
      </div>
      {long && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-1 text-[11px] text-[#8ec5ff] hover:underline"
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      )}
      {post.refs.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {post.refs.slice(0, 8).map((ref) => (
            <span key={ref} className="rounded bg-[#1f1f1f] px-1.5 py-0.5 font-mono text-[10px] text-[#6e6e6e]">
              {ref}
            </span>
          ))}
        </div>
      )}
    </article>
  );
}

export default function SwarmBoard({
  swarmId,
  posts,
  agents,
  canEdit,
  onPosted,
}: {
  swarmId: string;
  posts: SwarmPostInfo[];
  agents: SwarmAgentInfo[];
  canEdit: boolean;
  onPosted: () => void;
}) {
  const [channel, setChannel] = useState<(typeof CHANNELS)[number]["key"]>("all");
  const [draft, setDraft] = useState("");
  const [target, setTarget] = useState<"plan" | "questions">("plan");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const counts = useMemo(() => {
    const out: Record<string, number> = { all: posts.length, tasks: 0 };
    for (const p of posts) {
      if (p.channel.startsWith("task:")) out.tasks += 1;
      else out[p.channel] = (out[p.channel] ?? 0) + 1;
    }
    return out;
  }, [posts]);

  const visible = useMemo(() => {
    const filtered = posts.filter((p) => {
      if (channel === "all") return true;
      if (channel === "tasks") return p.channel.startsWith("task:");
      return p.channel === channel;
    });
    return [...filtered].sort((a, b) => b.createdAt - a.createdAt);
  }, [posts, channel]);

  const send = async () => {
    const body = draft.trim();
    if (!body) return;
    setBusy(true);
    setError("");
    try {
      await postSwarmDirective(swarmId, body, target);
      setDraft("");
      onPosted();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to post");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      {canEdit && (
        <div className="rounded-lg border border-[#2b2b2b] bg-[#161616] p-3">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") void send();
            }}
            rows={2}
            placeholder={
              target === "plan"
                ? "Steer the swarm — e.g. “Drop speculative decoding, go deeper on KV-cache offload.” @mention agents to wake them."
                : "Answer a question from the swarm…"
            }
            className="w-full resize-none bg-transparent text-[13px] leading-6 text-[#e4e4e4] placeholder:text-[#4a4a4a] outline-none"
          />
          <div className="mt-2 flex items-center gap-2">
            <select
              value={target}
              onChange={(e) => setTarget(e.target.value === "questions" ? "questions" : "plan")}
              className="h-7 rounded-md border border-[#2b2b2b] bg-[#1a1a1a] px-2 text-[11px] text-[#a0a0a0] outline-none"
            >
              <option value="plan">Directive → #plan</option>
              <option value="questions">Answer → #questions</option>
            </select>
            {error && <span className="text-[11px] text-[#f07070]">{error}</span>}
            <button
              type="button"
              disabled={busy || !draft.trim()}
              onClick={() => void send()}
              className="ml-auto inline-flex h-7 items-center gap-1.5 rounded-md bg-[#e4e4e4] px-3 text-[12px] font-medium text-[#141414] hover:bg-white disabled:opacity-40"
            >
              <Send className="h-3.5 w-3.5" strokeWidth={1.75} />
              Post
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-1.5">
        {CHANNELS.map((c) => (
          <button
            key={c.key}
            type="button"
            onClick={() => setChannel(c.key)}
            className={`inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[11px] transition-colors ${
              channel === c.key
                ? "border-[#3c3c3c] bg-[#252525] text-[#e4e4e4]"
                : "border-[#2b2b2b] text-[#6e6e6e] hover:text-[#e4e4e4]"
            }`}
          >
            {c.label}
            <span className="tabular-nums text-[#555]">{counts[c.key] ?? 0}</span>
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <p className="rounded-lg border border-dashed border-[#2b2b2b] px-4 py-10 text-center text-[12px] text-[#6e6e6e]">
          Nothing here yet. The orchestrator posts its plan on the first cycle.
        </p>
      ) : (
        <div className="space-y-2">
          {visible.map((post) => (
            <PostCard key={post.id} post={post} agents={agents} />
          ))}
        </div>
      )}
    </div>
  );
}
