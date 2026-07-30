"use client";

import { useEffect, useRef, useState } from "react";
import type { AgentRunStatus, ChatMessage } from "../../shared/events";
import Markdown from "./Markdown";
import InlineDiff from "./InlineDiff";

interface ChatPanelProps {
  messages: ChatMessage[];
  agentStatus: AgentRunStatus;
  agents?: Array<{ id: string; label: string }>;
  /** When set with multiple agents, only show this agent's messages. */
  filterAgentId?: string | null;
}

type ChatItem =
  | { type: "message"; message: ChatMessage }
  | { type: "tools"; messages: ChatMessage[]; key: string };

function groupMessages(messages: ChatMessage[]): ChatItem[] {
  const items: ChatItem[] = [];
  let toolBuf: ChatMessage[] = [];

  const flushTools = () => {
    if (toolBuf.length === 0) return;
    items.push({
      type: "tools",
      messages: toolBuf,
      key: `tools-${toolBuf[0].id}`,
    });
    toolBuf = [];
  };

  for (const msg of messages) {
    if (msg.role === "tool") {
      toolBuf.push(msg);
    } else {
      flushTools();
      items.push({ type: "message", message: msg });
    }
  }
  flushTools();
  return items;
}

export default function ChatPanel({
  messages,
  agentStatus,
  agents = [],
  filterAgentId = null,
}: ChatPanelProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  const agentLabel = (id?: string) =>
    agents.find((a) => a.id === id)?.label || (id ? id.slice(0, 6) : undefined);

  const filtered =
    filterAgentId && agents.length > 1
      ? messages.filter(
          (m) => !m.agentId || m.agentId === filterAgentId,
        )
      : messages;

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
    const scroller = scrollerRef.current;
    if (!scroller || !stickToBottom.current) return;

    // Keep movement inside the chat scroller. scrollIntoView() may scroll all
    // ancestors, including the document, which shifts the header and composer.
    const frame = requestAnimationFrame(() => {
      scroller.scrollTop = scroller.scrollHeight;
    });
    return () => cancelAnimationFrame(frame);
  }, [filtered, agentStatus]);

  if (filtered.length === 0) {
    return (
      <div className="flex-1 min-h-0 h-full overflow-hidden flex flex-col items-center justify-center gap-2 px-4 sm:px-6">
        <div className="text-[#e4e4e4] text-[14px]">No messages yet</div>
        <div className="text-[#6e6e6e] text-[13px] text-center max-w-sm">
          Send a message below. Anyone in the room can steer the agent — replies
          and tool activity show up here.
        </div>
      </div>
    );
  }

  const items = groupMessages(filtered);

  return (
    <div className="flex-1 min-h-0 h-full overflow-hidden flex flex-col">
      <div
        ref={scrollerRef}
        className="room-chat-scroll flex-1 min-h-0 h-full overflow-y-auto overscroll-contain"
      >
        <div className="max-w-3xl mx-auto px-3 sm:px-4 py-3 sm:py-4 space-y-3 sm:space-y-4">
          {items.map((item) =>
            item.type === "tools" ? (
              <ToolCallGroup
                key={item.key}
                messages={item.messages}
                agentLabel={agentLabel(item.messages[0]?.agentId)}
              />
            ) : (
              <MessageBubble
                key={item.message.id}
                message={item.message}
                agentLabel={agentLabel(item.message.agentId)}
              />
            ),
          )}
          {agentStatus === "running" && (
            <div className="flex items-center gap-2 text-[12px] text-[#6e6e6e] px-1">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#4d9fff] animate-pulse" />
              Agent is working…
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ToolCallGroup({
  messages,
  agentLabel,
}: {
  messages: ChatMessage[];
  agentLabel?: string;
}) {
  const anyStreaming = messages.some((m) => m.status === "streaming");
  // Tool groups stay collapsed by default, including when new tools/diffs arrive.
  const [open, setOpen] = useState(false);

  const doneCount = messages.filter((m) => m.status === "done").length;
  const label =
    messages.length === 1
      ? messages[0].toolName || "tool"
      : `${messages.length} tool calls`;

  return (
    <div className="rounded-lg border border-[#2b2b2b] bg-[#1a1a1a] overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-3 h-9 text-left hover:bg-[#1e1e1e] transition-colors"
      >
        <Chevron open={open} />
        <span className="text-[11px] uppercase tracking-wide text-[#6e6e6e]">
          Tools
        </span>
        {agentLabel && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#252525] text-[#a0a0a0]">
            {agentLabel}
          </span>
        )}
        <span className="text-[12px] text-[#a0a0a0] truncate min-w-0 flex-1">
          {label}
        </span>
        <span
          className={`text-[10px] shrink-0 ${
            anyStreaming ? "text-[#4d9fff]" : "text-[#3ecf8e]"
          }`}
        >
          {anyStreaming ? "running" : `${doneCount}/${messages.length}`}
        </span>
      </button>
      {open && (
        <div className="border-t border-[#2b2b2b] divide-y divide-[#2b2b2b]">
          {messages.map((msg) => (
            <ToolCallRow key={msg.id} message={msg} />
          ))}
        </div>
      )}
    </div>
  );
}

function ToolCallRow({ message }: { message: ChatMessage }) {
  const hasDiff = Boolean(message.diffPatch);
  // Individual tool rows stay collapsed until the user expands them.
  const [open, setOpen] = useState(false);

  return (
    <div className="bg-[#161616]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-start gap-2 px-3 py-2 text-left hover:bg-[#1a1a1a] transition-colors"
      >
        <Chevron open={open} className="mt-0.5" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
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
            {hasDiff && (
              <span className="text-[10px] text-[#4d9fff]">diff</span>
            )}
          </div>
          {!open && message.content && (
            <p className="text-[11px] text-[#6e6e6e] font-mono truncate mt-0.5">
              {message.content}
            </p>
          )}
        </div>
      </button>
      {open && (
        <div className="px-3 pb-2.5 pl-8">
          {message.content && (
            <p className="text-[12px] text-[#6e6e6e] font-mono break-all whitespace-pre-wrap mb-1">
              {message.content}
            </p>
          )}
          {message.diffPatch && (
            <InlineDiff patch={message.diffPatch} defaultOpen />
          )}
        </div>
      )}
    </div>
  );
}

function Chevron({
  open,
  className = "",
}: {
  open: boolean;
  className?: string;
}) {
  return (
    <span
      className={`inline-block text-[#6e6e6e] text-[10px] shrink-0 transition-transform ${
        open ? "rotate-90" : ""
      } ${className}`}
      aria-hidden
    >
      ▸
    </span>
  );
}

function MessageBubble({
  message,
  agentLabel,
}: {
  message: ChatMessage;
  agentLabel?: string;
}) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[92%] sm:max-w-[85%] rounded-2xl rounded-br-md bg-[#252525] border border-[#2b2b2b] px-3 sm:px-3.5 py-2 sm:py-2.5">
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
            {agentLabel && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#1a1a1a] text-[#6e6e6e]">
                → {agentLabel}
              </span>
            )}
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

  return (
    <div className="flex justify-start">
      <div className="max-w-[95%] sm:max-w-[90%] rounded-2xl rounded-bl-md bg-[#1a1a1a] border border-[#2b2b2b] px-3 sm:px-3.5 py-2 sm:py-2.5">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-[11px] font-medium text-[#a0a0a0]">
            {agentLabel || "Agent"}
          </span>
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
