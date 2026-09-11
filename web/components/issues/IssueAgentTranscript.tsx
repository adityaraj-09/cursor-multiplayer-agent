"use client";

import { useEffect, useState } from "react";
import Markdown from "../Markdown";
import { fetchIssueTranscript, type IssueTranscript } from "../../lib/api";
import type { IssueTranscriptItem } from "../../../shared/issueTranscript";

const POLL_MS = 4000;

function userPromptLabel(text: string): string {
  if (/You are fixing Steer issue/i.test(text)) return "Fix prompt";
  if (/markdown note for the issue tracker/i.test(text)) return "Writeup prompt";
  return "Steer";
}

function toolLabel(item: IssueTranscriptItem): string {
  const name = item.toolName || "tool";
  const detail = (item.detail || item.path || item.text || "").trim();
  return detail && detail !== name ? `${name} · ${detail}` : name;
}

function TranscriptItem({ item }: { item: IssueTranscriptItem }) {
  const [open, setOpen] = useState(false);

  if (item.kind === "user") {
    const label = userPromptLabel(item.text);
    const long = item.text.length > 160 || item.text.includes("\n");
    return (
      <div className="flex justify-end">
        <div className="max-w-[92%] rounded-xl border border-[#2b2b2b] bg-[#222] px-3 py-2">
          <p className="text-[11px] text-[#8ec5ff] mb-1">{label}</p>
          {long && !open ? (
            <>
              <p className="text-[13px] text-[#d0d0d0] whitespace-pre-wrap line-clamp-3">
                {item.text}
              </p>
              <button
                type="button"
                onClick={() => setOpen(true)}
                className="mt-1 text-[11px] text-[#8ec5ff]"
              >
                Show full prompt
              </button>
            </>
          ) : (
            <p className="text-[13px] text-[#d0d0d0] whitespace-pre-wrap">
              {item.text}
            </p>
          )}
        </div>
      </div>
    );
  }

  if (item.kind === "assistant") {
    return (
      <div className="rounded-xl border border-[#2b2b2b] bg-[#161616] px-3 py-2 text-[13px] text-[#d8d8d8]">
        <p className="text-[11px] text-[#6e6e6e] mb-1">Agent</p>
        <Markdown content={item.text} />
      </div>
    );
  }

  if (item.kind === "thinking") {
    return (
      <details className="rounded-lg border border-[#242424] bg-[#171717] px-3 py-1.5">
        <summary className="cursor-pointer text-[11px] text-[#6e6e6e]">
          Thinking
        </summary>
        <p className="mt-1 text-[12px] text-[#8a8a8a] whitespace-pre-wrap">
          {item.text}
        </p>
      </details>
    );
  }

  if (item.kind === "error") {
    return (
      <p className="text-[12px] text-[#f07070]">{item.text}</p>
    );
  }

  const tone =
    item.status === "error"
      ? "text-[#f07070]"
      : item.status === "running"
        ? "text-[#e6c07b]"
        : "text-[#a0a0a0]";
  return (
    <div className="flex items-start gap-2 px-1">
      <span className={`mt-0.5 text-[11px] ${tone}`}>
        {item.status === "running" ? "…" : item.status === "error" ? "×" : "·"}
      </span>
      <p className={`text-[12px] font-mono break-all ${tone}`}>
        {toolLabel(item)}
      </p>
    </div>
  );
}

export default function IssueAgentTranscript(props: {
  issueId: string;
  cursorAgentId?: string | null;
  live: boolean;
}) {
  const { issueId, cursorAgentId, live } = props;
  const [transcript, setTranscript] = useState<IssueTranscript | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      fetchIssueTranscript(issueId)
        .then((next) => {
          if (cancelled) return;
          setTranscript(next);
          setError("");
        })
        .catch((err) => {
          if (!cancelled) {
            setError(err instanceof Error ? err.message : "Failed to load transcript");
          }
        });

    void load();
    if (!live) {
      return () => {
        cancelled = true;
      };
    }
    const interval = setInterval(() => {
      void load();
    }, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [issueId, cursorAgentId, live]);

  const items = transcript?.items ?? [];
  const waiting = live && !cursorAgentId;
  const fetching = !transcript && !error && Boolean(cursorAgentId || live);

  return (
    <section className="mt-4 rounded-xl border border-[#2b2b2b] bg-[#1a1a1a] p-4">
      <div className="flex items-center justify-between mb-2">
        <p className="text-[12px] text-[#6e6e6e]">Agent</p>
        {live && (
          <span className="text-[11px] text-[#8ec5ff]">Live from Cursor</span>
        )}
      </div>

      {error && <p className="text-[12px] text-[#f07070]">{error}</p>}
      {!error && transcript?.error && (
        <p className="text-[12px] text-[#f07070]">{transcript.error}</p>
      )}

      {fetching && (
        <p className="text-[13px] text-[#6e6e6e]">Loading Cursor run history…</p>
      )}
      {waiting && !fetching && (
        <p className="text-[13px] text-[#6e6e6e]">
          Waiting for the headless agent to start…
        </p>
      )}
      {!fetching && !waiting && items.length === 0 && !transcript?.error && !error && (
        <p className="text-[13px] text-[#6e6e6e]">
          {cursorAgentId
            ? "No conversation yet from this Cursor agent."
            : "Run the issue to pull the agent transcript from Cursor."}
        </p>
      )}

      {items.length > 0 && (
        <div className="space-y-2.5">
          {items.map((item) => (
            <TranscriptItem key={item.id} item={item} />
          ))}
        </div>
      )}
    </section>
  );
}
