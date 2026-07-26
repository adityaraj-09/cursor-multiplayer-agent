"use client";

import { useEffect, useRef } from "react";
import type { AgentRunStatus, ChatMessage } from "../../shared/events";
import Markdown from "./Markdown";
import InlineDiff from "./InlineDiff";

interface ChatPanelProps {
  messages: ChatMessage[];
  agentStatus: AgentRunStatus;
}

export default function ChatPanel({ messages, agentStatus }: ChatPanelProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const onScroll = () => {
      const gap = el.scrollHeight - el.scrollTop - el.clientHeight;
      stickToBottom.current = gap < 80;
    };
    el.addEventListener("scroll", onScroll);
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (stickToBottom.current) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, agentStatus]);

  if (messages.length === 0) {
    return (
      <div className="flex-1 min-h-0 flex flex-col items-center justify-center gap-2 px-6">
        <div className="text-[#e4e4e4] text-[14px]">No messages yet</div>
        <div className="text-[#6e6e6e] text-[13px] text-center max-w-sm">
          Send a message below. Anyone in the room can steer the agent — replies
          and tool activity show up here as a normal chat, saved in the database.
        </div>
      </div>
    );
  }

  return (
    <div
      ref={scrollerRef}
      className="flex-1 min-h-0 overflow-y-auto overscroll-contain"
    >
      <div className="max-w-3xl mx-auto px-4 py-4 space-y-4">
        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}
        {agentStatus === "running" && (
          <div className="flex items-center gap-2 text-[12px] text-[#6e6e6e] px-1">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#4d9fff] animate-pulse" />
            Agent is working…
          </div>
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  if (message.role === "tool") {
    return (
      <div className="flex items-start gap-2 px-1 py-1">
        <div className="mt-0.5 text-[#6e6e6e] text-[11px] uppercase tracking-wide w-14 shrink-0">
          Tool
        </div>
        <div className="min-w-0 flex-1 rounded-md border border-[#2b2b2b] bg-[#1a1a1a] px-3 py-2">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-[12px] text-[#a0a0a0] font-medium">
              {message.toolName || "tool"}
            </span>
            <span
              className={`text-[10px] ${
                message.status === "streaming"
                  ? "text-[#4d9fff]"
                  : message.status === "error"
                    ? "text-[#f07070]"
                    : "text-[#3ecf8e]"
              }`}
            >
              {message.status === "streaming"
                ? "running"
                : message.status === "error"
                  ? "error"
                  : "done"}
            </span>
          </div>
          {message.content && (
            <p className="text-[12px] text-[#6e6e6e] font-mono break-all whitespace-pre-wrap">
              {message.content}
            </p>
          )}
          {message.diffPatch && <InlineDiff patch={message.diffPatch} />}
        </div>
      </div>
    );
  }

  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-[#252525] border border-[#2b2b2b] px-3.5 py-2.5">
          <div className="flex items-center gap-2 mb-1">
            <span
              className="w-1.5 h-1.5 rounded-full"
              style={{ backgroundColor: message.senderColor || "#4d9fff" }}
            />
            <span
              className="text-[11px] font-medium"
              style={{ color: message.senderColor || "#a0a0a0" }}
            >
              {message.senderName || "User"}
            </span>
            <span className="text-[10px] text-[#4a4a4a] font-mono">
              {formatTime(message.ts)}
            </span>
          </div>
          <p className="text-[13px] text-[#e4e4e4] leading-relaxed whitespace-pre-wrap break-words">
            {message.content}
          </p>
        </div>
      </div>
    );
  }

  // assistant / system — render markdown
  return (
    <div className="flex justify-start">
      <div className="max-w-[90%] rounded-2xl rounded-bl-md bg-[#1a1a1a] border border-[#2b2b2b] px-3.5 py-2.5">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-[11px] font-medium text-[#a0a0a0]">Agent</span>
          <span className="text-[10px] text-[#4a4a4a] font-mono">
            {formatTime(message.ts)}
          </span>
          {message.status === "streaming" && (
            <span className="text-[10px] text-[#4d9fff]">streaming</span>
          )}
          {message.status === "error" && (
            <span className="text-[10px] text-[#f07070]">error</span>
          )}
        </div>
        {message.content ? (
          <Markdown content={message.content} />
        ) : (
          <span className="text-[13px] text-[#6e6e6e]">Thinking…</span>
        )}
      </div>
    </div>
  );
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}
