"use client";

import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  FileText,
  GitCompare,
  ListChecks,
  LoaderCircle,
  Sparkles,
  User,
  Wrench,
} from "lucide-react";
import type {
  AgentRunStatus,
  ChatAttachment,
  ChatMessage,
} from "../../shared/events";
import { fetchRoomUploadBlob } from "../lib/api";
import Markdown from "./Markdown";
import InlineDiff from "./InlineDiff";
import TodoCard, { coalesceTodoMessages, messageHasTodos } from "./TodoCard";

interface ChatPanelProps {
  messages: ChatMessage[];
  agentStatus: AgentRunStatus;
  agents?: Array<{ id: string; label: string }>;
  /** When set with multiple agents, only show this agent's messages. */
  filterAgentId?: string | null;
  roomId?: string;
  canApprovePlan?: boolean;
  onApprovePlan?: (messageId: string, agentId?: string) => void;
  onDismissPlan?: (messageId: string) => void;
}

type ChatItem =
  | { type: "message"; message: ChatMessage }
  | { type: "todos"; message: ChatMessage }
  | { type: "tools"; messages: ChatMessage[]; key: string };

function groupMessages(messages: ChatMessage[]): ChatItem[] {
  const items: ChatItem[] = [];
  let toolBuf: ChatMessage[] = [];
  // Collapse stacked TodoWrite cards (2, then 3, then 4…) into the latest.
  const timeline = coalesceTodoMessages(messages);

  const flushTools = () => {
    if (toolBuf.length === 0) return;
    items.push({
      type: "tools",
      messages: toolBuf,
      key: `tools-${toolBuf[0].id}`,
    });
    toolBuf = [];
  };

  for (const msg of timeline) {
    if (msg.role !== "tool") {
      flushTools();
      items.push({ type: "message", message: msg });
      continue;
    }

    // Todos stay first-class; file edits stay inside the Tools group.
    if (messageHasTodos(msg)) {
      flushTools();
      items.push({ type: "todos", message: msg });
      continue;
    }

    toolBuf.push(msg);
  }
  flushTools();
  return items;
}

export default function ChatPanel({
  messages,
  agentStatus,
  agents = [],
  filterAgentId = null,
  roomId,
  canApprovePlan = false,
  onApprovePlan,
  onDismissPlan,
}: ChatPanelProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const lastMessageCount = useRef(0);
  const touchYRef = useRef<number | null>(null);

  const agentLabel = (id?: string) =>
    agents.find((a) => a.id === id)?.label || (id ? id.slice(0, 6) : undefined);

  const filtered =
    filterAgentId && agents.length > 1
      ? messages.filter(
          (m) => !m.agentId || m.agentId === filterAgentId,
        )
      : messages;

  const updateStickFromScroll = () => {
    const el = scrollerRef.current;
    if (!el) return;
    const gap = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottom.current = gap < 64;
  };

  // Re-bind whenever the scroller mounts (empty-state → timeline) so upward
  // scrolls actually clear the stick-to-bottom flag.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    updateStickFromScroll();
    const onScroll = () => updateStickFromScroll();
    // Unpin immediately on intentional upward gestures — don't wait for the
    // next scroll event after a streaming re-pin race.
    const onWheel = (e: WheelEvent) => {
      if (e.deltaY < 0) stickToBottom.current = false;
    };
    const onTouchStart = (e: TouchEvent) => {
      touchYRef.current = e.touches[0]?.clientY ?? null;
    };
    const onTouchMove = (e: TouchEvent) => {
      const y = e.touches[0]?.clientY;
      if (y == null || touchYRef.current == null) return;
      if (y > touchYRef.current + 2) stickToBottom.current = false;
      touchYRef.current = y;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    el.addEventListener("wheel", onWheel, { passive: true });
    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
    };
  }, [filtered.length > 0]);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;

    const grew = filtered.length >= lastMessageCount.current;
    lastMessageCount.current = filtered.length;

    // Only auto-follow when the user is already near the bottom. Streaming
    // deltas and new posts must not yank the viewport while reading history.
    if (!stickToBottom.current) return;
    if (!grew && agentStatus !== "running") return;

    // Keep movement inside the chat scroller. scrollIntoView() may scroll all
    // ancestors, including the document, which shifts the header and composer.
    const frame = requestAnimationFrame(() => {
      if (!stickToBottom.current || !scrollerRef.current) return;
      scrollerRef.current.scrollTop = scrollerRef.current.scrollHeight;
    });
    return () => cancelAnimationFrame(frame);
  }, [filtered, agentStatus]);

  if (filtered.length === 0) {
    return (
      <div className="flex-1 min-h-0 h-full overflow-hidden flex flex-col items-center justify-center px-4 sm:px-6">
        <div className="max-w-md w-full rounded-2xl border border-[#2b2b2b] bg-[#181818]/90 p-6 shadow-[0_24px_70px_rgba(0,0,0,0.25)]">
          <div className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-xl border border-[#2b2b2b] bg-[#1f1f1f] text-[#e4e4e4]">
            <Sparkles className="h-5 w-5" strokeWidth={1.75} />
          </div>
          <div className="text-center">
            <div className="text-[#e4e4e4] text-[15px] font-medium">
              Start steering the agent
            </div>
            <div className="mt-2 text-[#7d7d7d] text-[13px] leading-relaxed">
              Ask for a task, request a review, or redirect the current plan.
              Replies, tool calls, and file diffs will appear here in a live
              room timeline.
            </div>
          </div>
          <div className="mt-5 grid gap-2 text-[12px] text-[#a0a0a0]">
            {[
              "Summarize the repository architecture",
              "Make this page look like the landing demo",
              "Review the latest diff and suggest fixes",
            ].map((item) => (
              <div
                key={item}
                className="rounded-lg border border-[#2b2b2b] bg-[#141414] px-3 py-2"
              >
                {item}
              </div>
            ))}
          </div>
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
        <div className="max-w-4xl mx-auto px-3 sm:px-5 py-4 sm:py-6 space-y-4">
          {items.map((item) => {
            if (item.type === "todos") {
              return (
                <TodoCard
                  key={item.message.id}
                  message={item.message}
                  agentLabel={agentLabel(item.message.agentId)}
                />
              );
            }
            if (item.type === "tools") {
              return (
                <ToolCallGroup
                  key={item.key}
                  messages={item.messages}
                  agentLabel={agentLabel(item.messages[0]?.agentId)}
                />
              );
            }
            return (
              <MessageBubble
                key={item.message.id}
                message={item.message}
                agentLabel={agentLabel(item.message.agentId)}
                roomId={roomId}
                agentBusy={agentStatus === "running"}
                canApprovePlan={canApprovePlan}
                onApprovePlan={onApprovePlan}
                onDismissPlan={onDismissPlan}
              />
            );
          })}
          {agentStatus === "running" && (
            <div className="inline-flex items-center gap-2 rounded-full border border-[#2b2b2b] bg-[#181818] px-3 py-1.5 text-[12px] text-[#a0a0a0] shadow-sm">
              <LoaderCircle className="h-3.5 w-3.5 animate-spin text-[#4d9fff]" strokeWidth={1.75} />
              Agent is working
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
  // Always collapsed by default — including groups that contain edits.
  const [open, setOpen] = useState(false);

  const doneCount = messages.filter((m) => m.status === "done").length;
  const editCount = messages.filter((m) => Boolean(m.diffPatch)).length;
  const label =
    messages.length === 1
      ? messages[0].toolName || "tool"
      : `${messages.length} tool calls`;

  return (
    <div className="rounded-xl border border-[#2b2b2b] bg-[#181818] overflow-hidden shadow-[0_14px_34px_rgba(0,0,0,0.16)]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2.5 px-3.5 h-10 text-left hover:bg-[#1f1f1f] transition-colors"
      >
        <Chevron open={open} />
        <span className="flex h-6 w-6 items-center justify-center rounded-md bg-[#252525] text-[#a0a0a0]">
          <Wrench className="h-3.5 w-3.5" strokeWidth={1.75} />
        </span>
        <span className="text-[11px] uppercase tracking-[0.12em] text-[#6e6e6e]">
          Tools
        </span>
        {agentLabel && (
          <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-[#252525] text-[#a0a0a0]">
            {agentLabel}
          </span>
        )}
        <span className="text-[12px] text-[#a0a0a0] truncate min-w-0 flex-1">
          {label}
        </span>
        {editCount > 0 && (
          <span className="inline-flex items-center gap-1 text-[10px] shrink-0 rounded-full border border-[#26405d] bg-[#17202a] px-2 py-0.5 text-[#4d9fff]">
            <GitCompare className="h-3 w-3" strokeWidth={1.8} />
            {editCount} edit{editCount === 1 ? "" : "s"}
          </span>
        )}
        <span
          className={`inline-flex items-center gap-1 text-[10px] shrink-0 rounded-full border px-2 py-0.5 ${
            anyStreaming
              ? "border-[#26405d] bg-[#17202a] text-[#4d9fff]"
              : "border-[#234337] bg-[#17251f] text-[#3ecf8e]"
          }`}
        >
          {anyStreaming ? (
            <LoaderCircle className="h-3 w-3 animate-spin" strokeWidth={1.8} />
          ) : (
            <CheckCircle2 className="h-3 w-3" strokeWidth={1.8} />
          )}
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
  // Edit rows stay collapsed until the user opens them.
  const [open, setOpen] = useState(false);

  return (
    <div className="bg-[#151515]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-start gap-2.5 px-3.5 py-2.5 text-left hover:bg-[#1a1a1a] transition-colors"
      >
        <Chevron open={open} className="mt-0.5" />
        {hasDiff ? (
          <span className="mt-0.5 flex h-6 w-6 items-center justify-center rounded-md bg-[#17202a] text-[#4d9fff]">
            <GitCompare className="h-3.5 w-3.5" strokeWidth={1.75} />
          </span>
        ) : (
          <ToolStatusIcon status={message.status} />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[12px] text-[#d0d0d0] font-medium">
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
        <div className="px-3.5 pb-3 pl-12 space-y-2">
          {message.content && (
            <p className="text-[12px] text-[#8a8a8a] font-mono break-all whitespace-pre-wrap">
              {message.content}
            </p>
          )}
          {message.diffPatch && <InlineDiff patch={message.diffPatch} />}
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
  roomId,
  agentBusy,
  canApprovePlan,
  onApprovePlan,
  onDismissPlan,
}: {
  message: ChatMessage;
  agentLabel?: string;
  roomId?: string;
  agentBusy?: boolean;
  canApprovePlan?: boolean;
  onApprovePlan?: (messageId: string, agentId?: string) => void;
  onDismissPlan?: (messageId: string) => void;
}) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end gap-3">
        <div className="max-w-[92%] sm:max-w-[82%] rounded-2xl rounded-br-md bg-[#242424] border border-[#343434] px-3.5 sm:px-4 py-2.5 shadow-[0_14px_35px_rgba(0,0,0,0.18)]">
          <div className="flex items-center gap-2 mb-1.5">
            <span
              className="text-[11px] font-medium inline-flex items-center gap-1.5"
              style={{ color: message.senderColor || "#a0a0a0" }}
            >
              <User className="h-3 w-3" strokeWidth={1.8} />
              {message.senderName || "User"}
            </span>
            {agentLabel && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-[#1a1a1a] text-[#8a8a8a]">
                → {agentLabel}
              </span>
            )}
            <span className="text-[10px] text-[#4a4a4a] font-mono">
              {formatTime(message.ts)}
            </span>
          </div>
          {message.attachments && message.attachments.length > 0 && (
            <MessageAttachments
              roomId={roomId}
              attachments={message.attachments}
            />
          )}
          {message.content && message.content !== "(attached files)" && (
            <p className="text-[13px] text-[#f0f0f0] leading-relaxed whitespace-pre-wrap break-words">
              {message.content}
            </p>
          )}
        </div>
      </div>
    );
  }

  const isPlan = Boolean(message.planStatus);

  return (
    <div className="flex justify-start gap-3">
      <div className="mt-0.5 hidden sm:flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-[#2b2b2b] bg-[#1f1f1f] text-[#a0a0a0]">
        {isPlan ? (
          <ListChecks className="h-4 w-4" strokeWidth={1.75} />
        ) : (
          <Bot className="h-4 w-4" strokeWidth={1.75} />
        )}
      </div>
      <div
        className={`max-w-[95%] sm:max-w-[86%] rounded-2xl rounded-bl-md px-3.5 sm:px-4 py-2.5 shadow-[0_14px_35px_rgba(0,0,0,0.14)] ${
          isPlan
            ? "bg-[#161c24] border border-[#26405d]"
            : "bg-[#191919] border border-[#2b2b2b]"
        }`}
      >
        <div className="flex items-center gap-2 mb-1.5 flex-wrap">
          <span className="text-[11px] font-medium text-[#a0a0a0] inline-flex items-center gap-1.5">
            <Bot className="h-3 w-3 sm:hidden" strokeWidth={1.8} />
            {agentLabel || "Agent"}
          </span>
          {isPlan && <PlanStatusBadge status={message.planStatus} />}
          <span className="text-[10px] text-[#4a4a4a] font-mono">
            {formatTime(message.ts)}
          </span>
          {message.status === "streaming" && (
            <span className="inline-flex items-center gap-1 text-[10px] text-[#4d9fff]">
              <LoaderCircle className="h-3 w-3 animate-spin" strokeWidth={1.8} />
              streaming
            </span>
          )}
          {message.status === "error" && (
            <span className="inline-flex items-center gap-1 text-[10px] text-[#f07070]">
              <AlertTriangle className="h-3 w-3" strokeWidth={1.8} />
              error
            </span>
          )}
        </div>
        {message.content ? (
          <Markdown content={message.content} />
        ) : (
          <span className="text-[13px] text-[#6e6e6e]">Thinking…</span>
        )}
        {message.planStatus && (
          <PlanActions
            message={message}
            agentBusy={agentBusy}
            canApprove={canApprovePlan}
            onApprove={onApprovePlan}
            onDismiss={onDismissPlan}
          />
        )}
      </div>
    </div>
  );
}

function PlanStatusBadge({
  status,
}: {
  status: ChatMessage["planStatus"];
}) {
  if (status === "approved") {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] rounded-full border border-[#234337] bg-[#17251f] px-2 py-0.5 text-[#3ecf8e]">
        <CheckCircle2 className="h-3 w-3" strokeWidth={1.8} />
        Plan approved
      </span>
    );
  }
  if (status === "dismissed") {
    return (
      <span className="text-[10px] rounded-full border border-[#2b2b2b] bg-[#1a1a1a] px-2 py-0.5 text-[#8a8a8a]">
        Plan dismissed
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[10px] rounded-full border border-[#26405d] bg-[#17202a] px-2 py-0.5 text-[#8ec5ff]">
      <ListChecks className="h-3 w-3" strokeWidth={1.8} />
      Plan ready
    </span>
  );
}

function PlanActions({
  message,
  agentBusy,
  canApprove,
  onApprove,
  onDismiss,
}: {
  message: ChatMessage;
  agentBusy?: boolean;
  canApprove?: boolean;
  onApprove?: (messageId: string, agentId?: string) => void;
  onDismiss?: (messageId: string) => void;
}) {
  if (message.planStatus !== "pending") return null;

  return (
    <div className="mt-3 pt-3 border-t border-[#26405d]/70">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12px] text-[#8ec5ff]">
          Review the plan above, then approve to start implementing.
        </p>
        {canApprove ? (
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              disabled={agentBusy}
              onClick={() => onDismiss?.(message.id)}
              className="h-8 px-3 rounded-md border border-[#343434] bg-[#1a1a1a] text-[12px] text-[#c8c8c8] hover:bg-[#242424] disabled:opacity-50"
            >
              Dismiss
            </button>
            <button
              type="button"
              disabled={agentBusy}
              onClick={() => onApprove?.(message.id, message.agentId)}
              className="h-8 px-3 rounded-md border border-[#2a4a35] bg-[#1c2a22] text-[12px] text-[#7ddea8] hover:bg-[#243830] disabled:opacity-50"
            >
              Approve plan
            </button>
          </div>
        ) : (
          <p className="text-[11px] text-[#6e6e6e]">
            You need steer permission to approve this plan.
          </p>
        )}
      </div>
      {agentBusy && canApprove && (
        <p className="mt-2 text-[11px] text-[#6e6e6e]">
          Wait for the agent to finish before approving.
        </p>
      )}
    </div>
  );
}

function MessageAttachments({
  roomId,
  attachments,
}: {
  roomId?: string;
  attachments: ChatAttachment[];
}) {
  return (
    <div className="flex flex-wrap gap-2 mb-2">
      {attachments.map((att) => (
        <AttachmentChip key={att.id} roomId={roomId} attachment={att} />
      ))}
    </div>
  );
}

function AttachmentChip({
  roomId,
  attachment,
}: {
  roomId?: string;
  attachment: ChatAttachment;
}) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    if (!roomId || !attachment.mime.startsWith("image/")) return;
    let revoked = false;
    let objectUrl: string | null = null;
    void fetchRoomUploadBlob(roomId, attachment.id)
      .then((blob) => {
        if (revoked) return;
        objectUrl = URL.createObjectURL(blob);
        setSrc(objectUrl);
      })
      .catch(() => {
        /* keep file chip */
      });
    return () => {
      revoked = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [roomId, attachment.id, attachment.mime]);

  if (src) {
    return (
      <a
        href={src}
        target="_blank"
        rel="noreferrer"
        className="block overflow-hidden rounded-lg border border-[#343434]"
      >
        <img
          src={src}
          alt={attachment.name}
          className="max-h-40 max-w-[220px] object-cover"
        />
      </a>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 rounded-lg border border-[#343434] bg-[#1a1a1a] px-2 py-1 text-[11px] text-[#c8c8c8] max-w-[200px]">
      {attachment.mime.startsWith("image/") ? (
        <Sparkles className="h-3.5 w-3.5 text-[#8ec5ff]" strokeWidth={1.75} />
      ) : (
        <FileText className="h-3.5 w-3.5 text-[#a0a0a0]" strokeWidth={1.75} />
      )}
      <span className="truncate">{attachment.name}</span>
    </span>
  );
}

function ToolStatusIcon({ status }: { status: ChatMessage["status"] }) {
  if (status === "streaming") {
    return (
      <span className="mt-0.5 flex h-6 w-6 items-center justify-center rounded-md bg-[#17202a] text-[#4d9fff]">
        <LoaderCircle className="h-3.5 w-3.5 animate-spin" strokeWidth={1.75} />
      </span>
    );
  }
  if (status === "error") {
    return (
      <span className="mt-0.5 flex h-6 w-6 items-center justify-center rounded-md bg-[#2a1717] text-[#f07070]">
        <AlertTriangle className="h-3.5 w-3.5" strokeWidth={1.75} />
      </span>
    );
  }
  return (
    <span className="mt-0.5 flex h-6 w-6 items-center justify-center rounded-md bg-[#17251f] text-[#3ecf8e]">
      <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={1.75} />
    </span>
  );
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}
